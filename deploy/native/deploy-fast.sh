#!/usr/bin/env bash
# Fast, binary-only deployment. Use this when binaries are already built.
# It avoids recompiling Rust and is the recommended path for routine updates.
set -euo pipefail

SCALE="${SCALE:-1}"
ENV_FILE="${ENV_FILE:-/etc/velismail/velismail.env}"
APP_USER="${APP_USER:-velismail}"
APP_GROUP="${APP_GROUP:-velismail}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/velismail}"
BIN_DIR="${INSTALL_ROOT}/bin"
SYSTEMD_DIR="/etc/systemd/system"
CADDY_DIR="/etc/caddy"

if [[ "${EUID}" -ne 0 ]]; then
  echo "deploy-fast.sh must run as root"
  exit 1
fi

cd "$(dirname "$0")/../.."

if [[ ! -d target/release ]]; then
  echo "target/release not found. Run deploy/native/build.sh first."
  exit 1
fi

echo "Installing pre-built binaries..."
install -d -m 0755 "${BIN_DIR}"
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
  fi
done

echo "Validating environment file..."
bash deploy/native/check-env.sh "${ENV_FILE}"

echo "Restarting services..."
systemctl daemon-reload
systemctl reset-failed 'velismail-*.service' >/dev/null 2>&1 || true
for unit in "${SYSTEMD_DIR}"/velismail-*-*.service; do
  [[ -e "${unit}" ]] || continue
  systemctl restart "$(basename "${unit}")"
done

echo "Reloading Caddy..."
systemctl restart caddy || true

echo "Waiting for the gateway to become healthy..."
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/health >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "${healthy}" != "1" ]]; then
  echo "Gateway health check failed. Recent logs:"
  journalctl -u velismail-api-gateway-1 --no-pager -n 60 || true
  exit 1
fi

for unit in velismail-api-gateway-1 velismail-auth-service-1 \
  velismail-mail-service-1 velismail-storage-service-1 \
  velismail-tenant-service-1 velismail-delivery-engine-1; do
  if ! systemctl is-active --quiet "${unit}.service"; then
    echo "${unit} is not active"
    journalctl -u "${unit}.service" --no-pager -n 60 || true
    exit 1
  fi
done

# Report readiness separately: a failing dependency should be visible without
# making the rollout fail outright (DNS/cert issues are external).
curl -fsS --max-time 5 http://127.0.0.1:3000/health/ready || true
echo

echo "Fast deployment complete."