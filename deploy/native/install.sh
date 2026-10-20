#!/usr/bin/env bash
# VelisMail - native, Docker-free production deployment.
#
# Installs PostgreSQL, Caddy and the VelisMail backend as systemd services.
# Every service runs as an unprivileged user, is sandboxed by systemd, and is
# managed with automatic restart. Caddy terminates TLS and load-balances
# across gateway instances.
#
# Usage:
#   sudo bash deploy/native/install.sh
#   sudo SCALE=2 bash deploy/native/install.sh
#   sudo bash deploy/native/install.sh --skip-build   # reuse existing binaries
set -euo pipefail

SCALE="${SCALE:-1}"
ENV_FILE="${ENV_FILE:-/etc/velismail/velismail.env}"
APP_USER="${APP_USER:-velismail}"
APP_GROUP="${APP_GROUP:-velismail}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/velismail}"
BIN_DIR="${INSTALL_ROOT}/bin"
STATE_DIR="${STATE_DIR:-/var/lib/velismail}"
LOG_DIR="${LOG_DIR:-/var/log/velismail}"
SYSTEMD_DIR="/etc/systemd/system"
CADDY_DIR="/etc/caddy"
API_DOMAIN="${API_DOMAIN:-api.velismail.online}"
ACME_EMAIL="${ACME_EMAIL:-admin@${API_DOMAIN#api.}}"
SKIP_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "install.sh must run as root"
  exit 1
fi

cd "$(dirname "$0")/../.."

log() { echo "[velismail] $*"; }

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------
if [[ "${INSTALL_PACKAGES:-1}" == "1" ]]; then
  log "Installing system packages (PostgreSQL, Caddy, build tools)..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    build-essential pkg-config libssl-dev ca-certificates curl \
    postgresql postgresql-contrib caddy zram-tools
fi

# ---------------------------------------------------------------------------
# 2. Build release binaries
# ---------------------------------------------------------------------------
if [[ "${SKIP_BUILD}" == "0" ]]; then
  log "Building VelisMail backend (release)..."
  # Build as the repository owner so target/ does not become root-owned (which
  # would break later builds by the deploy user). The VM keeps the toolchain in
  # the deploy user's home directory.
  build_user="$(stat -c '%U' . 2>/dev/null || echo root)"
  if [[ "${build_user}" != "root" ]] && id -u "${build_user}" >/dev/null 2>&1; then
    build_home="$(getent passwd "${build_user}" | cut -d: -f6)"
    sudo -u "${build_user}" env \
      PATH="${build_home}/.cargo/bin:/usr/local/bin:/usr/bin:/bin" \
      CARGO_HOME="${build_home}/.cargo" \
      cargo build --release --workspace --locked
  else
    if [[ -x /home/ubuntu/.cargo/bin/cargo ]]; then
      export PATH="/home/ubuntu/.cargo/bin:${PATH}"
      export CARGO_HOME="${CARGO_HOME:-/home/ubuntu/.cargo}"
    fi
    cargo build --release --workspace --locked
  fi
fi

# ---------------------------------------------------------------------------
# 3. Service account and directories
# ---------------------------------------------------------------------------
log "Preparing service account and directories..."
if ! getent group "${APP_GROUP}" >/dev/null; then
  groupadd --system "${APP_GROUP}"
fi
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${APP_GROUP}" --home-dir "${INSTALL_ROOT}" \
    --shell /usr/sbin/nologin "${APP_USER}"
fi
install -d -m 0755 "${INSTALL_ROOT}" "${BIN_DIR}"
install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0750 \
  "${STATE_DIR}" "${STATE_DIR}/storage" "${LOG_DIR}"

log "Installing binaries..."
for binary in \
  velismail-api-gateway \
  velismail-auth-service \
  velismail-mail-service \
  velismail-storage-service \
  velismail-tenant-service \
  velismail-delivery-engine
do
  if [[ -x "target/release/${binary}" ]]; then
    install -m 0755 "target/release/${binary}" "${BIN_DIR}/${binary}"
  else
    log "WARNING: ${binary} not found, skipping"
  fi
done

# ---------------------------------------------------------------------------
# 3b. Memory hardening (storage-as-RAM for small VMs)
# ---------------------------------------------------------------------------
if [[ -f deploy/native/tune-memory.sh ]]; then
  log "Applying memory hardening (zram + swap)..."
  bash deploy/native/tune-memory.sh
fi

# ---------------------------------------------------------------------------
# 4. Environment file
# ---------------------------------------------------------------------------
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f .env ]]; then
    log "Installing .env to ${ENV_FILE}"
    install -d -m 0750 "$(dirname "${ENV_FILE}")"
    install -m 0640 .env "${ENV_FILE}"
  else
    echo "No .env found. Create one and re-run with ENV_FILE=<path>."
    exit 1
  fi
elif [[ "${SYNC_ENV:-0}" == "1" && -f .env ]]; then
  log "SYNC_ENV=1: replacing ${ENV_FILE} with .env"
  install -m 0640 .env "${ENV_FILE}"
elif [[ -f .env ]] && ! cmp -s .env "${ENV_FILE}"; then
  log "WARNING: repo .env differs from ${ENV_FILE}; re-run with SYNC_ENV=1 to update it"
fi
chown root:"${APP_GROUP}" "${ENV_FILE}"
chmod 0640 "${ENV_FILE}"

# Windows checkouts and copied env files often have CRLF endings. A trailing
# carriage return silently corrupts values (for example "velismail\r" becomes
# a different PostgreSQL role), so normalise the file once, in place.
sed -i 's/\r$//' "${ENV_FILE}"

# Reject malformed assignments/unbalanced quotes before systemd parses them.
bash deploy/native/check-env.sh "${ENV_FILE}"

# shellcheck disable=SC1090
dotenv_get() {
  local key="$1"
  local default_value="${2:-}"
  local line
  line=$(grep -E "^${key}=" "${ENV_FILE}" 2>/dev/null | tail -n1 || true)
  if [[ -n "${line}" ]]; then
    line="${line%$'\r'}"
    printf '%s' "${line#*=}"
  else
    printf '%s' "$default_value"
  fi
}

log "Validating required environment variables..."
for required_key in DATABASE_URL JWT_SECRET OTP_SIGNING_SECRET ENCRYPTION_KEY PLATFORM_RESEND_API_KEY; do
  required_value="$(dotenv_get "${required_key}")"
  if [[ -z "${required_value}" ]]; then
    echo "Missing required value ${required_key} in ${ENV_FILE}"
    exit 1
  fi
done

# Service topology belongs to the generated systemd units. Values in the env
# file override Environment= (systemd applies EnvironmentFile last), which
# would make every scaled gateway instance bind the same port.
for forbidden_key in \
  PORT GATEWAY_PORT GATEWAY_HOST \
  AUTH_HOST AUTH_PORT MAIL_HOST MAIL_PORT \
  STORAGE_HOST STORAGE_PORT TENANT_HOST TENANT_PORT \
  DELIVERY_HOST DELIVERY_PORT; do
  if grep -qE "^${forbidden_key}=" "${ENV_FILE}"; then
    echo "Remove ${forbidden_key} from ${ENV_FILE}: service host/ports are managed by systemd"
    exit 1
  fi
done
if grep -Eq 'replace-with|generate-a-long|your-razorpay' "${ENV_FILE}"; then
  echo "Refusing to deploy: ${ENV_FILE} still contains placeholder secrets."
  exit 1
fi

# ---------------------------------------------------------------------------
# 5. PostgreSQL bootstrap
# ---------------------------------------------------------------------------
PG_USER="$(dotenv_get POSTGRES_USER velismail)"
PG_PASSWORD="$(dotenv_get POSTGRES_PASSWORD)"
PG_DB="$(dotenv_get POSTGRES_DB velismail)"

if [[ -z "${PG_PASSWORD}" ]]; then
  echo "POSTGRES_PASSWORD is missing from ${ENV_FILE}"
  exit 1
fi

if (( ${#PG_PASSWORD} < 16 )); then
  echo "POSTGRES_PASSWORD must be at least 16 characters long"
  exit 1
fi

# The password is embedded in DATABASE_URL without percent-encoding, so keep
# it URL-safe. This also keeps the SQL literal below simple and injection-free.
if [[ ! "${PG_PASSWORD}" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "POSTGRES_PASSWORD may only contain letters, digits, '_' and '-'"
  exit 1
fi

# Reject trivially weak passwords such as 64 repetitions of one character.
uniform=1
first_char="${PG_PASSWORD:0:1}"
for ((i = 1; i < ${#PG_PASSWORD}; i++)); do
  if [[ "${PG_PASSWORD:i:1}" != "${first_char}" ]]; then
    uniform=0
    break
  fi
done
if (( uniform )); then
  echo "POSTGRES_PASSWORD is a repeated character; generate a strong password"
  exit 1
fi

case "${PG_PASSWORD}" in
  postgres|password|changeme|velismail|admin|secret)
    echo "POSTGRES_PASSWORD is a well-known default; generate a strong password"
    exit 1
    ;;
esac

if [[ ! "${PG_USER}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "POSTGRES_USER must be a plain identifier (got '${PG_USER}')"
  exit 1
fi
if [[ ! "${PG_DB}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "POSTGRES_DB must be a plain identifier (got '${PG_DB}')"
  exit 1
fi

log "Ensuring PostgreSQL is running..."
systemctl enable --now postgresql >/dev/null 2>&1 || true
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

log "Ensuring role '${PG_USER}' and database '${PG_DB}' exist..."
# Never pass the password on the command line: sudo logs the full command to
# the journal. The SQL goes through a root-only file on stdin instead.
PG_SQL_FILE="$(mktemp)"
chmod 0600 "${PG_SQL_FILE}"
trap 'rm -f "${PG_SQL_FILE}"' EXIT
cat > "${PG_SQL_FILE}" <<SQL
DO \$velismail\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PG_USER}') THEN
    CREATE ROLE "${PG_USER}" LOGIN PASSWORD '${PG_PASSWORD}';
  ELSE
    ALTER ROLE "${PG_USER}" WITH LOGIN PASSWORD '${PG_PASSWORD}';
  END IF;
END
\$velismail\$;
SQL
sudo -u postgres psql -v ON_ERROR_STOP=1 -q < "${PG_SQL_FILE}"
rm -f "${PG_SQL_FILE}"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${PG_DB}'" | grep -q 1; then
  sudo -u postgres createdb --owner="${PG_USER}" "${PG_DB}"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "${PG_DB}" \
  -v role="${PG_USER}" <<'SQL'
GRANT ALL ON SCHEMA public TO :"role";
ALTER SCHEMA public OWNER TO :"role";
SQL

# Conservative tuning for a 2 vCPU / 2 GB instance. These values leave room
# for the six Rust services, Caddy and the OS while avoiding the tiny defaults
# that cause excessive disk I/O under load.
log "Applying PostgreSQL tuning..."
sudo -u postgres psql -q <<'SQL'
ALTER SYSTEM SET max_connections = '100';
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '768MB';
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET wal_compression = 'on';
ALTER SYSTEM SET random_page_cost = '1.1';
ALTER SYSTEM SET checkpoint_completion_target = '0.9';
SQL
systemctl restart postgresql
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# 6. systemd units
# ---------------------------------------------------------------------------
# Base port layout. Additional instances are offset by 100 ports each.
declare -A BASE_PORTS=(
  [api-gateway]=3000
  [auth-service]=3001
  [mail-service]=3002
  [storage-service]=3003
  [tenant-service]=3004
  [delivery-engine]=3005
)

declare -A PORT_VARS=(
  [api-gateway]=GATEWAY_PORT
  [auth-service]=AUTH_PORT
  [mail-service]=MAIL_PORT
  [storage-service]=STORAGE_PORT
  [tenant-service]=TENANT_PORT
  [delivery-engine]=DELIVERY_PORT
)

# Memory ceilings sized for a 2 GB VM. Sum = 1.35 GiB, leaving headroom for
# PostgreSQL, Caddy, the kernel and page cache. Override with MEMORY_MAX.
declare -A SERVICE_MEMORY=(
  [api-gateway]=320M
  [auth-service]=256M
  [mail-service]=256M
  [storage-service]=192M
  [tenant-service]=160M
  [delivery-engine]=192M
)

# Soft limits (MemoryHigh) throttle reclaim *before* the hard cap is reached,
# which prevents abrupt OOM restarts under load.
declare -A SERVICE_MEMORY_HIGH=(
  [api-gateway]=256M
  [auth-service]=200M
  [mail-service]=200M
  [storage-service]=150M
  [tenant-service]=128M
  [delivery-engine]=150M
)

log "Generating systemd units (gateway instances: ${SCALE}; internal services: 1 each)..."
GATEWAY_UPSTREAMS=""
for service in api-gateway auth-service mail-service storage-service tenant-service delivery-engine; do
  binary="velismail-${service}"
  [[ -x "${BIN_DIR}/${binary}" ]] || continue
  base_port="${BASE_PORTS[$service]}"
  port_var="${PORT_VARS[$service]}"

  # Only the stateless gateway is horizontally scaled on a single VM. The
  # internal services are single-instance; a multi-VM deployment scales them
  # by running this installer on additional hosts and pointing the gateway's
  # *_SERVICE_URL values at those hosts (or a private load balancer).
  service_instances=1
  if [[ "${service}" == "api-gateway" ]]; then
    service_instances="${SCALE}"
  fi

  for ((instance=1; instance<=service_instances; instance++)); do
    port=$((base_port + (instance - 1) * 100))
    unit="velismail-${service}-${instance}.service"

    # Keep total gateway memory constant when SCALE > 1 instead of multiplying
    # the 2 GB budget. Never go below 128M per instance.
    mem_max="${MEMORY_MAX:-${SERVICE_MEMORY[$service]}}"
    mem_high="${MEMORY_HIGH:-${SERVICE_MEMORY_HIGH[$service]}}"
    if [[ "${service}" == "api-gateway" ]] && (( SCALE > 1 )); then
      per_instance=$((320 / SCALE))
      (( per_instance < 128 )) && per_instance=128
      mem_max="${per_instance}M"
      mem_high="$((per_instance * 4 / 5))M"
    fi
    cat > "${SYSTEMD_DIR}/${unit}" <<EOF
[Unit]
Description=VelisMail ${service} instance ${instance}
Documentation=https://velismail.online
After=network-online.target postgresql.service
Wants=network-online.target
# A transient database or network outage must not permanently disable a
# service. Keep retrying with a bounded rate (one attempt per ~5s on average).
StartLimitIntervalSec=300
StartLimitBurst=60

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${INSTALL_ROOT}
EnvironmentFile=${ENV_FILE}
Environment=${port_var}=${port}
Environment=GATEWAY_HOST=127.0.0.1
Environment=AUTH_HOST=127.0.0.1
Environment=MAIL_HOST=127.0.0.1
Environment=STORAGE_HOST=127.0.0.1
Environment=TENANT_HOST=127.0.0.1
Environment=DELIVERY_HOST=127.0.0.1
ExecStart=${BIN_DIR}/${binary}
Restart=always
RestartSec=3
TimeoutStartSec=60
TimeoutStopSec=30
KillSignal=SIGTERM

# Hardening
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictNamespaces=true
RestrictRealtime=true
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallArchitectures=native
UMask=0077
ReadWritePaths=${STATE_DIR}
LimitNOFILE=65536
LimitNPROC=8192

# Resource limits tuned for a 2 vCPU / 2 GB instance
CPUQuota=80%
MemoryHigh=${mem_high}
MemoryMax=${mem_max}
TasksMax=256
OOMPolicy=stop

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable "${unit}" >/dev/null 2>&1 || true

    if [[ "${service}" == "api-gateway" ]]; then
      if [[ -z "${GATEWAY_UPSTREAMS}" ]]; then
        GATEWAY_UPSTREAMS="127.0.0.1:${port}"
      else
        GATEWAY_UPSTREAMS="${GATEWAY_UPSTREAMS} 127.0.0.1:${port}"
      fi
    fi
  done
done

# Remove gateway instances left behind by a previous, larger SCALE value.
for unit_file in "${SYSTEMD_DIR}"/velismail-api-gateway-*.service; do
  [[ -e "${unit_file}" ]] || continue
  unit_name="$(basename "${unit_file}")"
  instance="${unit_name#velismail-api-gateway-}"
  instance="${instance%.service}"
  if [[ "${instance}" =~ ^[0-9]+$ ]] && (( instance > SCALE )); then
    systemctl disable --now "${unit_name}" >/dev/null 2>&1 || true
    rm -f "${unit_file}"
    log "Removed stale ${unit_name} (SCALE=${SCALE})"
  fi
done

# ---------------------------------------------------------------------------
# 7. Caddy reverse proxy
# ---------------------------------------------------------------------------
log "Configuring Caddy..."
install -d -m 0755 "${CADDY_DIR}"

# Public IP is used for an HTTP-only verification endpoint. The production API
# still requires api.velismail.online to resolve to this VM for TLS.
PUBLIC_IP="${PUBLIC_IP:-$(curl -fsS --max-time 3 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)}"

cat > "${CADDY_DIR}/Caddyfile" <<EOF
{
    email ${ACME_EMAIL}
    # Pin the production CA explicitly; otherwise some Caddy builds fall back
    # to staging or ZeroSSL when the first order fails.
    acme_ca https://acme-v02.api.letsencrypt.org/directory
    servers {
        timeouts {
            read_body 60s
            read_header 10s
            write 120s
            idle 120s
        }
    }
}

${API_DOMAIN} {
    encode zstd gzip

    # Security headers applied to every response.
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }

    # Legacy /v1 prefix is rewritten to the canonical /api/v1 namespace.
    handle /v1/* {
        uri replace /v1/ /api/v1/
        reverse_proxy ${GATEWAY_UPSTREAMS} {
            lb_policy least_conn
            lb_try_duration 5s
            lb_try_interval 250ms
            fail_duration 30s
            max_fails 3
            unhealthy_status 502 503 504
            health_uri /health
            health_interval 10s
            health_timeout 3s
            transport http {
                keepalive 30s
                keepalive_idle_conns 32
                dial_timeout 5s
                response_header_timeout 60s
            }
        }
    }
    reverse_proxy ${GATEWAY_UPSTREAMS} {
        lb_policy least_conn
        lb_try_duration 5s
        lb_try_interval 250ms
        fail_duration 30s
        max_fails 3
        unhealthy_status 502 503 504
        health_uri /health
        health_interval 10s
        health_timeout 3s
        transport http {
            keepalive 30s
            keepalive_idle_conns 32
            dial_timeout 5s
            response_header_timeout 60s
        }
    }

    log {
        output stdout
        format json
    }
}
EOF

if [[ -n "${PUBLIC_IP}" ]]; then
  cat >> "${CADDY_DIR}/Caddyfile" <<EOF

http://${PUBLIC_IP} {
    encode zstd gzip
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        -Server
    }
    reverse_proxy ${GATEWAY_UPSTREAMS} {
        lb_policy least_conn
        health_uri /health
        health_interval 10s
        health_timeout 3s
    }
    log {
        output stdout
        format json
    }
}
EOF
fi

if command -v caddy >/dev/null 2>&1; then
  caddy fmt --overwrite "${CADDY_DIR}/Caddyfile" >/dev/null 2>&1 || true
  caddy validate --config "${CADDY_DIR}/Caddyfile" >/dev/null
fi

systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy >/dev/null 2>&1 || systemctl restart caddy

# ---------------------------------------------------------------------------
# 7b. Daily PostgreSQL backups
# ---------------------------------------------------------------------------
if [[ "${ENABLE_BACKUPS:-1}" == "1" ]]; then
  log "Configuring daily PostgreSQL backups..."
  install -m 0755 deploy/native/backup.sh /usr/local/sbin/velismail-backup
  install -d -m 0700 -o postgres -g postgres /var/backups/velismail

  cat > "${SYSTEMD_DIR}/velismail-backup.service" <<EOF
[Unit]
Description=VelisMail PostgreSQL backup
After=postgresql.service
Requires=postgresql.service

[Service]
Type=oneshot
User=postgres
Group=postgres
Environment=PGDATABASE=${PG_DB}
Environment=BACKUP_DIR=/var/backups/velismail
Environment=RETENTION_DAYS=7
ExecStart=/usr/local/sbin/velismail-backup
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/backups/velismail
EOF

  cat > "${SYSTEMD_DIR}/velismail-backup.timer" <<'EOF'
[Unit]
Description=Daily VelisMail PostgreSQL backup

[Timer]
OnCalendar=*-*-* 02:30:00 UTC
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now velismail-backup.timer >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
# 8. Start services and verify
# ---------------------------------------------------------------------------
log "Starting backend services..."
# Clear the start-limit state left behind by an earlier failed deployment.
systemctl reset-failed 'velismail-*.service' >/dev/null 2>&1 || true
for unit in "${SYSTEMD_DIR}"/velismail-*.service; do
  [[ -e "${unit}" ]] || continue
  name="$(basename "${unit}")"
  # Backup is a oneshot timer job, not a long-running service.
  [[ "${name}" == "velismail-backup.service" ]] && continue
  systemctl restart "${name}"
done

log "Waiting for services to become healthy..."
HEALTHY=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/health >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [[ "${HEALTHY}" == "1" ]]; then
  log "Gateway is healthy."
else
  log "WARNING: gateway did not become healthy. Check: journalctl -u velismail-api-gateway-1"
fi

log "Deployment complete."
log "  Gateway upstreams : ${GATEWAY_UPSTREAMS}"
log "  Local health      : http://127.0.0.1:3000/health"
log "  Public health     : https://${API_DOMAIN}/health"
log "  Services          : systemctl list-units 'velismail-*'"
