#!/usr/bin/env bash
# VelisMail - one-shot VM deploy script (Linux VM / VPS).
#
# Prerequisites on the VM:
#   - Docker + Docker Compose v2
#   - Ports 80/443 free (if you terminate TLS here) or behind a reverse proxy
#   - .env file present
#
# Usage:  bash deploy-vm.sh            # build + start
#         bash deploy-vm.sh pull       # pull latest git + rebuild
#         bash deploy-vm.sh logs       # tail logs
#         bash deploy-vm.sh down       # stop everything

set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env"
COMPOSE="docker compose --env-file ${ENV_FILE} -f docker-compose.prod.yml"

cmd=${1:-up}

case "$cmd" in
  up)
    [[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }
    $COMPOSE build
    $COMPOSE up -d
    echo
    echo "VelisMail backend running."
    echo "  API Gateway: http://$(hostname -I | awk '{print $1}'):${GATEWAY_PORT:-3000}"
    echo "  Point Cloudflare Pages VITE_API_URL to this host over HTTPS."
    ;;
  pull)
    git pull --ff-only
    $COMPOSE build
    $COMPOSE up -d
    ;;
  logs)  $COMPOSE logs -f --tail=200 ;;
  down)  $COMPOSE down ;;
  ps)    $COMPOSE ps ;;
  *)     echo "Unknown command: $cmd"; exit 2 ;;
esac
