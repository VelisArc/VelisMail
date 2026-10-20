#!/usr/bin/env bash
# VelisMail memory hardening for small VMs (2 GB class).
#
# "Storage as RAM": compressed RAM swap (zram) is used first, backed by disk
# swap. This keeps a 2 GB VM stable without an EC2 instance-type change.
# The script is idempotent and safe to re-run after reboots/deploys.
set -euo pipefail

INSTALL_PACKAGES="${INSTALL_PACKAGES:-1}"
DISK_SWAP_FILE="${DISK_SWAP_FILE:-/swapfile2}"
DISK_SWAP_SIZE="${DISK_SWAP_SIZE:-4G}"
SWAP_PRIORITY="${SWAP_PRIORITY:-100}"

log() { echo "[velismail-memory] $*"; }

# 1. zram-tools (compressed RAM swap)
if [[ "${INSTALL_PACKAGES}" == "1" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq zram-tools
fi

if command -v zramctl >/dev/null 2>&1 || [[ -f /usr/lib/systemd/system/zramswap.service ]]; then
  cat > /etc/default/zramswap <<'EOF'
# Compressed RAM swap. zstd compresses ~2-3x, so 1 GB of zram behaves like
# ~2-3 GB of extra working memory and is far faster than disk swap.
ALGO=zstd
PERCENT=50
PRIORITY=100
EOF
  systemctl enable zramswap >/dev/null 2>&1 || true
  systemctl restart zramswap || true
fi

# 2. Additional disk swap (safety net, lowest priority)
if [[ ! -f "${DISK_SWAP_FILE}" ]]; then
  log "Creating ${DISK_SWAP_SIZE} disk swap at ${DISK_SWAP_FILE}"
  if ! fallocate -l "${DISK_SWAP_SIZE}" "${DISK_SWAP_FILE}" 2>/dev/null; then
    dd if=/dev/zero of="${DISK_SWAP_FILE}" bs=1M count=4096 status=none
  fi
  chmod 600 "${DISK_SWAP_FILE}"
  mkswap "${DISK_SWAP_FILE}" >/dev/null
fi

if ! swapon --show=NAME | grep -q "${DISK_SWAP_FILE}"; then
  swapon "${DISK_SWAP_FILE}" || true
fi

# Persist every active swap file across reboots. A VM created before VelisMail
# was installed can already have /swapfile, so handle both files explicitly.
for swap_file in /swapfile /swapfile2 "${DISK_SWAP_FILE}"; do
  [[ -f "${swap_file}" ]] || continue
  if ! swapon --show=NAME | grep -Fqx "${swap_file}"; then
    swapon "${swap_file}" 2>/dev/null || true
  fi
  if ! grep -qE "^[[:space:]]*${swap_file}[[:space:]]" /etc/fstab; then
    printf '%s none swap sw 0 0\n' "${swap_file}" >> /etc/fstab
  fi
done

# 3. Kernel memory tuning
cat > /etc/sysctl.d/99-velismail-memory.conf <<'EOF'
# Prefer compressed zram swap over dropping page cache. zram reads are cheap,
# so a high swappiness prevents OOM kills on a 2 GB instance.
vm.swappiness = 100
# zram is random-access; read-ahead clusters waste CPU and memory.
vm.page-cluster = 0
vm.vfs_cache_pressure = 50
# Reserved free memory headroom so the kernel reclaims before OOM.
vm.min_free_kbytes = 65536
# Predictable overcommit behaviour for long-running services.
vm.overcommit_memory = 0
EOF
sysctl --system >/dev/null 2>&1 || true

# 4. Protect shared services from the OOM killer
mkdir -p /etc/systemd/system/postgresql.service.d
cat > /etc/systemd/system/postgresql.service.d/velismail-oom.conf <<'EOF'
[Service]
OOMScoreAdjust=-900
EOF

mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/velismail-oom.conf <<'EOF'
[Service]
OOMScoreAdjust=-500
EOF
systemctl daemon-reload

# 5. Keep Rust builds from spiking memory on 2 vCPU machines
for cargo_home_dir in "${CARGO_HOME:-${HOME}/.cargo}" /root/.cargo /home/*/.cargo; do
  [[ -d "${cargo_home_dir}" ]] || continue
  cargo_config="${cargo_home_dir}/config.toml"
  if ! grep -q '^jobs' "${cargo_config}" 2>/dev/null; then
    printf '[build]\njobs = 2\n' >> "${cargo_config}"
    owner="$(stat -c '%U' "${cargo_home_dir}" 2>/dev/null || echo root)"
    chown "${owner}:" "${cargo_config}" 2>/dev/null || true
  fi
done

log "Memory state:"
free -h
swapon --show || true
