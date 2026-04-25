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
APP_SERVICES=(
  api-gateway
  auth-service
  mail-service
  storage-service
  tenant-service
  delivery-engine
)

dotenv_get() {
  local key="$1"
  local default_value="${2:-}"
  local line
  line=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 || true)
  if [[ -n "$line" ]]; then
    printf '%s' "${line#*=}"
  else
    printf '%s' "$default_value"
  fi
}

ensure_service_databases() {
  local postgres_user postgres_password auth_db mail_db storage_db tenant_db delivery_db
  postgres_user=$(dotenv_get POSTGRES_USER "velismail")
  postgres_password=$(dotenv_get POSTGRES_PASSWORD "")
  auth_db=$(dotenv_get AUTH_POSTGRES_DB "velismail_auth")
  mail_db=$(dotenv_get MAIL_POSTGRES_DB "velismail_mail")
  storage_db=$(dotenv_get STORAGE_POSTGRES_DB "velismail_storage")
  tenant_db=$(dotenv_get TENANT_POSTGRES_DB "velismail_tenant")
  delivery_db=$(dotenv_get DELIVERY_POSTGRES_DB "velismail_delivery")

  echo "Ensuring service PostgreSQL databases exist..."
  for db_name in "$auth_db" "$mail_db" "$storage_db" "$tenant_db" "$delivery_db"; do
    if ! $COMPOSE exec -T -e PGPASSWORD="$postgres_password" postgres \
      psql -U "$postgres_user" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'" | grep -q 1; then
      $COMPOSE exec -T -e PGPASSWORD="$postgres_password" postgres \
        psql -U "$postgres_user" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${db_name}\";"
      echo "  Created database: ${db_name}"
    else
      echo "  Database already exists: ${db_name}"
    fi
  done
}

prepare_build_space() {
  local available_mb
  available_mb=$(df -Pm . | awk 'NR==2 {print $4}')

  echo "Inspecting Docker disk usage..."
  docker system df || true

  if [[ "${available_mb}" -lt 6144 ]]; then
    echo "Low disk detected (${available_mb}MB free). Running aggressive Docker cleanup..."
    docker builder prune -af >/dev/null 2>&1 || true
    docker image prune -af >/dev/null 2>&1 || true
    docker container prune -f >/dev/null 2>&1 || true
  else
    echo "Sufficient disk detected (${available_mb}MB free). Keeping build cache for faster deploys."
    docker builder prune -f --filter until=240h >/dev/null 2>&1 || true
    docker image prune -f >/dev/null 2>&1 || true
  fi

  echo "Docker disk usage after cleanup:"
  docker system df || true
}

build_services_sequentially() {
  for service in "${APP_SERVICES[@]}"; do
    echo "Building ${service}..."
    $COMPOSE build "$service"
  done
}

cmd=${1:-up}

case "$cmd" in
  up)
    [[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }
    prepare_build_space
    build_services_sequentially
    $COMPOSE up -d postgres redis nats
    ensure_service_databases
    $COMPOSE up -d
    echo
    echo "VelisMail backend running."
    echo "  Local API Gateway: http://127.0.0.1:${GATEWAY_PORT:-3000}"
    echo "  Public API: https://api.velismail.online"
    ;;
  pull)
    git pull --ff-only
    prepare_build_space
    build_services_sequentially
    $COMPOSE up -d postgres redis nats
    ensure_service_databases
    $COMPOSE up -d
    ;;
  logs)  $COMPOSE logs -f --tail=200 ;;
  down)  $COMPOSE down ;;
  ps)    $COMPOSE ps ;;
  *)     echo "Unknown command: $cmd"; exit 2 ;;
esac
