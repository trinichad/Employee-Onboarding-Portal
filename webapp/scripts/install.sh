#!/usr/bin/env bash
# One-shot installer for Linux (Debian/Ubuntu/RHEL family).
#
# Usage from the repo root:
#   sudo bash webapp/scripts/install.sh           # full install + systemd
#   bash webapp/scripts/install.sh --no-systemd   # build only, run manually
#
# Result: a SINGLE process (uvicorn) serving both the API and the built UI on
# one port (default 8000). No reverse proxy, no CORS, no second service.
# Open http://<host>:8000  → the first-run wizard takes you to /admin/setup.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_USER="${SUDO_USER:-${USER}}"
BACKEND_DIR="$APP_DIR/webapp/backend"
FRONTEND_DIR="$APP_DIR/webapp/frontend"

WANT_SYSTEMD=1
for arg in "$@"; do
  case "$arg" in
    --no-systemd) WANT_SYSTEMD=0 ;;
  esac
done

is_root()   { [ "$(id -u)" -eq 0 ]; }
as_user()   { if is_root; then sudo -u "$RUN_USER" bash -lc "$1"; else bash -lc "$1"; fi; }

echo "==> App dir : $APP_DIR"
echo "==> Run as  : $RUN_USER"

# --- 1. system packages -------------------------------------------------------
# We install Python + Node. On Debian/Ubuntu we deliberately skip apt's `npm`
# package because the NodeSource Node 20 repo conflicts with the distro npm.
if is_root; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y python3 python3-venv python3-pip curl ca-certificates
    if ! command -v node >/dev/null 2>&1; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
    fi
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 python3-pip nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    yum install -y python3 python3-pip nodejs npm
  else
    echo "Unsupported distro: install python3 + nodejs (>=20) manually, then re-run." >&2
    exit 1
  fi
fi

# Sanity check
command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 1; }
command -v node    >/dev/null || { echo "node not found"    >&2; exit 1; }
command -v npm     >/dev/null || { echo "npm not found"     >&2; exit 1; }

# --- 2. backend venv ----------------------------------------------------------
as_user "
  set -e
  cd '$BACKEND_DIR'
  [ -d .venv ] || python3 -m venv .venv
  source .venv/bin/activate
  pip install --upgrade pip wheel
  pip install -r requirements.txt
  [ -f .env ] || cp .env.example .env
"

# --- 3. DB init (tables created on app startup; this also runs the seed pass) -
as_user "
  set -e
  cd '$BACKEND_DIR'
  source .venv/bin/activate
  python -m app.seed
"

# --- 4. frontend build (output goes to webapp/frontend/dist) ------------------
as_user "
  set -e
  cd '$FRONTEND_DIR'
  npm install --no-audit --no-fund
  npm run build
"

# --- 5. systemd unit (single backend process serves API + UI) -----------------
if [ "$WANT_SYSTEMD" -eq 1 ] && is_root; then
  RUNTIME_ENV="$APP_DIR/webapp/runtime.env"
  if [ ! -f "$RUNTIME_ENV" ]; then
    sudo -u "$RUN_USER" bash -c "cat > '$RUNTIME_ENV' <<RUNEOF
BACKEND_PORT=8000
PUBLIC_BASE_URL=
RUNEOF"
  fi

  sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__USER__|$RUN_USER|g" \
      "$APP_DIR/webapp/scripts/itrequest-backend.service" \
      > /etc/systemd/system/itrequest-backend.service

  # Tear down the old split-frontend service if a previous install left one.
  systemctl disable --now itrequest-frontend.service 2>/dev/null || true
  rm -f /etc/systemd/system/itrequest-frontend.service

  systemctl daemon-reload
  systemctl enable --now itrequest-backend.service
fi

HOST_HINT="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$HOST_HINT" ] && HOST_HINT="<host>"

cat <<DONE

==> Done.

   Open in your browser:   http://${HOST_HINT}:8000
   First-run wizard:       http://${HOST_HINT}:8000/admin/setup

   API health:             http://${HOST_HINT}:8000/api/health
   Manage service:         systemctl {status|restart|stop} itrequest-backend
   Logs:                   journalctl -u itrequest-backend -f
   Edit secrets:           $BACKEND_DIR/.env   (then: sudo systemctl restart itrequest-backend)

DONE

if [ "$WANT_SYSTEMD" -eq 0 ] || ! is_root; then
  cat <<MANUAL
   (No systemd unit installed — start it manually with:)
     cd $BACKEND_DIR
     source .venv/bin/activate
     uvicorn app.main:app --host 0.0.0.0 --port 8000

MANUAL
fi
