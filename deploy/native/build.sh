#!/usr/bin/env bash
# Build all VelisMail backend services without containers.
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "Building VelisMail backend (release, no Docker)..."
cargo build --release --workspace --locked

echo "Build complete. Binaries are in target/release/."
echo "Service binaries:"
for service in api-gateway auth-service mail-service storage-service tenant-service delivery-engine monolith; do
  if [[ -x "target/release/${service}" || -x "target/release/velismail-${service}" ]]; then
    echo "  - ${service}"
  fi
done