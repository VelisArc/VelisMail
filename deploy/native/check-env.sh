#!/usr/bin/env bash
# Validate a dotenv file before it is handed to systemd's EnvironmentFile.
#
# systemd treats an unterminated quote as a line continuation. A single bad
# line (for example a truncated DKIM key) then silently swallows every
# following assignment, which is extremely hard to diagnose at runtime.
set -euo pipefail

ENV_FILE="${1:-}"
if [[ -z "${ENV_FILE}" ]]; then
  echo "usage: $0 <env-file>" >&2
  exit 2
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "env file not found: ${ENV_FILE}" >&2
  exit 2
fi

problems=0
declare -A seen=()
count=0

while IFS= read -r line || [[ -n "${line}" ]]; do
  # Normalise a possible trailing carriage return.
  line="${line%$'\r'}"
  if [[ -z "${line}" || "${line}" == \#* ]]; then
    continue
  fi

  if [[ "${line}" != *=* ]]; then
    echo "invalid line (no '='): ${line}" >&2
    problems=$((problems + 1))
    continue
  fi

  key="${line%%=*}"
  value="${line#*=}"

  if [[ ! "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "invalid variable name: ${key}" >&2
    problems=$((problems + 1))
    continue
  fi

  if [[ -n "${seen[${key}]:-}" ]]; then
    echo "duplicate variable: ${key}" >&2
    problems=$((problems + 1))
  fi
  seen["${key}"]=1

  double_quotes=$(printf '%s' "${value}" | tr -cd '"' | wc -c)
  single_quotes=$(printf '%s' "${value}" | tr -cd "'" | wc -c)
  if (( double_quotes % 2 != 0 )); then
    echo "unbalanced double quote in ${key}" >&2
    problems=$((problems + 1))
  fi
  if (( single_quotes % 2 != 0 )); then
    echo "unbalanced single quote in ${key}" >&2
    problems=$((problems + 1))
  fi

  if printf '%s' "${value}" | LC_ALL=C grep -q '[^[:print:][:space:]]'; then
    echo "non-printable character in ${key}" >&2
    problems=$((problems + 1))
  fi

  count=$((count + 1))
done < "${ENV_FILE}"

if (( problems > 0 )); then
  echo "env validation failed: ${problems} problem(s) in ${ENV_FILE}" >&2
  exit 1
fi

echo "env validation passed: ${count} variables in ${ENV_FILE}"
