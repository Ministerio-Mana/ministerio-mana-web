#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://ministeriomana.org}"
SECRET="${DONATION_REMINDER_CRON_SECRET:-}"

if [[ -z "$SECRET" ]]; then
  echo "Falta DONATION_REMINDER_CRON_SECRET"
  exit 1
fi

curl -sS -X POST "$BASE_URL/api/donations/reminders/run?token=$SECRET" \
  -H "Origin: $BASE_URL"
