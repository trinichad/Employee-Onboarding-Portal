#!/usr/bin/env bash
# Lifecycle wrapper around the systemd units.
#
# Usage:
#   itrequest.sh start          # start both services
#   itrequest.sh stop           # stop both services
#   itrequest.sh restart        # restart both services
#   itrequest.sh status         # show status
#   itrequest.sh logs [N]       # tail backend+frontend journal logs (default 100)
#   itrequest.sh reset-password user@example.com [NEWPASS]
set -euo pipefail

SERVICES=(itrequest-backend.service itrequest-frontend.service)
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$APP_DIR/webapp/backend"

cmd="${1:-}"
case "$cmd" in
  start|stop|restart)
    sudo systemctl "$cmd" "${SERVICES[@]}"
    ;;
  status)
    systemctl status --no-pager "${SERVICES[@]}" || true
    ;;
  logs)
    n="${2:-100}"
    sudo journalctl -u itrequest-backend.service -u itrequest-frontend.service -n "$n" -f
    ;;
  reset-password)
    email="${2:-}"; pw="${3:-}"
    if [ -z "$email" ]; then
      echo "usage: itrequest.sh reset-password EMAIL [NEWPASS]" >&2
      exit 2
    fi
    cd "$BACKEND_DIR"
    # shellcheck disable=SC1091
    source .venv/bin/activate
    if [ -n "$pw" ]; then
      python -m app.cli reset-password "$email" --password "$pw"
    else
      python -m app.cli reset-password "$email"
    fi
    ;;
  create-admin)
    email="${2:-}"; pw="${3:-}"
    if [ -z "$email" ]; then
      echo "usage: itrequest.sh create-admin EMAIL [PASSWORD]" >&2
      exit 2
    fi
    cd "$BACKEND_DIR"
    # shellcheck disable=SC1091
    source .venv/bin/activate
    if [ -n "$pw" ]; then
      python -m app.cli create-admin "$email" --password "$pw"
    else
      python -m app.cli create-admin "$email"
    fi
    ;;
  *)
    cat <<EOF
usage: $(basename "$0") {start|stop|restart|status|logs [N]|reset-password EMAIL [NEWPASS]|create-admin EMAIL [PASSWORD]}
EOF
    exit 2
    ;;
esac
