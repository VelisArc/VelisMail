#!/usr/bin/env bash
# Scale VelisMail on the current node.
#
# Usage:
#   sudo NEW_SCALE=2 bash deploy/native/scale.sh
#
# This delegates to install.sh so that the generated units always match the
# installed binaries, sandboxing and memory limits. Only the stateless gateway
# is replicated on a single VM; internal services stay single-instance.
set -euo pipefail

NEW_SCALE="${NEW_SCALE:-2}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "scale.sh must run as root"
  exit 1
fi

cd "$(dirname "$0")/../.."
SCALE="${NEW_SCALE}" bash deploy/native/install.sh --skip-build
