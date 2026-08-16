#!/usr/bin/env bash
#
# Unseelie Workshop — local development
#
# Nothing here touches anything deployed. The local database is a file
# under .wrangler/state; it is not the production one.

set -euo pipefail

cd "$(dirname "$0")"

DB_NAME="unseelie_reviews"
PORT=8787
WEBHOOK_ROUTE="/api/hooks/stripe"

usage() {
    cat <<EOF
Usage: ./dev.sh [command]

  serve     Site and API on http://localhost:${PORT}   (default)
  db        Apply migrations to the local database
  reset     Delete all local data, then re-apply migrations
  stripe    Forward real Stripe webhooks to the local server
  trigger   Fire a test checkout.session.completed event
  cron      Run the scheduled handler once
  emails    Render every email template to .preview/emails.html
  check     Bundle the Worker without deploying

Typical first run:

  ./dev.sh db          once the D1 block in wrangler.toml is uncommented
  ./dev.sh serve       leave running
  ./dev.sh stripe      in a second terminal, leave running
  ./dev.sh trigger     in a third, to send an order through
EOF
}

# The D1 block in wrangler.toml stays commented out until the database
# exists. Say so plainly rather than failing somewhere inside wrangler.
require_d1_binding() {
    if grep -qE '^[[:space:]]*\[\[d1_databases\]\]' wrangler.toml; then
        return
    fi

    cat >&2 <<EOF
The D1 binding in wrangler.toml is still commented out.

  npx wrangler d1 create ${DB_NAME}

then paste the id into wrangler.toml and uncomment the block.
EOF
    exit 1
}

require_dev_vars() {
    if [ -f .dev.vars ]; then
        return
    fi

    cat >&2 <<EOF
No .dev.vars found. Create one alongside wrangler.toml:

  STRIPE_SECRET_KEY=sk_test_...
  STRIPE_WEBHOOK_SECRET=whsec_...

The whsec_ value is the one './dev.sh stripe' prints, which is not the
same as the live endpoint's secret. It is gitignored.
EOF
    exit 1
}

serve() {
    echo "Site and API   http://localhost:${PORT}"
    echo "Scheduled      http://localhost:${PORT}/__scheduled  (./dev.sh cron)"
    echo
    npx wrangler dev --port "$PORT" --test-scheduled
}

apply_migrations() {
    require_d1_binding
    npx wrangler d1 migrations apply "$DB_NAME" --local
}

# Local D1 lives under .wrangler/state, so deleting it is the reset. The
# schema is then rebuilt from db/migrations, which is how schema changes
# are meant to happen here — throwaway local data is never migrated.
reset_database() {
    require_d1_binding

    read -r -p "Delete all local database data? [y/N] " reply
    case "$reply" in
        [yY]) ;;
        *) echo "Left alone."; return ;;
    esac

    rm -rf .wrangler/state
    apply_migrations
    echo "Local database rebuilt from db/migrations."
}

forward_stripe() {
    if ! command -v stripe >/dev/null 2>&1; then
        echo "The Stripe CLI is not installed: https://docs.stripe.com/stripe-cli" >&2
        exit 1
    fi
    require_dev_vars

    echo "Forwarding to http://localhost:${PORT}${WEBHOOK_ROUTE}"
    echo "If the whsec_ below differs from .dev.vars, update it and restart ./dev.sh serve."
    echo
    stripe listen --forward-to "localhost:${PORT}${WEBHOOK_ROUTE}"
}

trigger_checkout() {
    if ! command -v stripe >/dev/null 2>&1; then
        echo "The Stripe CLI is not installed: https://docs.stripe.com/stripe-cli" >&2
        exit 1
    fi

    echo "Sending checkout.session.completed. './dev.sh stripe' must be running."
    stripe trigger checkout.session.completed
}

run_cron() {
    local url="http://localhost:${PORT}/__scheduled"

    if ! curl -fsS "$url"; then
        echo >&2
        echo "Could not reach ${url} — is './dev.sh serve' running elsewhere?" >&2
        exit 1
    fi

    echo "Scheduled handler ran."
}

preview_emails() {
    node tools/preview-emails.js
    echo
    echo "Open:  file://$(pwd)/.preview/emails.html"
}

check_bundle() {
    npx wrangler deploy --dry-run
}

case "${1:-serve}" in
    serve)          serve ;;
    db)             apply_migrations ;;
    reset)          reset_database ;;
    stripe)         forward_stripe ;;
    trigger)        trigger_checkout ;;
    cron)           run_cron ;;
    emails)         preview_emails ;;
    check)          check_bundle ;;
    -h|--help|help) usage ;;
    *)
        echo "Unknown command: $1" >&2
        echo >&2
        usage >&2
        exit 1
        ;;
esac
