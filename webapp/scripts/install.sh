#!/usr/bin/env bash
# One-shot installer for Linux (Debian/Ubuntu/RHEL family).
#
# Usage (from the repo root):
#   sudo bash webapp/scripts/install.sh
#
# What it does:
#   1. Installs system packages (python3, venv, nodejs, npm)
#   2. Creates the backend Python venv and installs requirements
#   3. Copies .env.example -> .env (if missing)
#   4. Runs DB migrations + seeds the bootstrap Global Admin
#   5. Builds the frontend (npm install + npm run build)
#   6. Installs systemd units so the app starts on boot
#
# Idempotent: safe to re-run.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_USER="${SUDO_USER:-${USER}}"
BACKEND_DIR="$APP_DIR/webapp/backend"
FRONTEND_DIR="$APP_DIR/webapp/frontend"

echo "==> App dir : $APP_DIR"
echo "==> Run as  : $RUN_USER"

# --- 1. system packages -------------------------------------------------------
if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y python3 python3-venv python3-pip nodejs npm
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y python3 python3-pip nodejs npm
elif command -v yum >/dev/null 2>&1; then
  yum install -y python3 python3-pip nodejs npm
else
  echo "Unsupported distro: install python3 + nodejs + npm manually, then re-run." >&2
  exit 1
fi

# --- 2. backend venv ----------------------------------------------------------
sudo -u "$RUN_USER" bash <<EOF
set -e
cd "$BACKEND_DIR"
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
[ -f .env ] || cp .env.example .env
EOF

# --- 3. DB init + (optional) seed --------------------------------------------
# By default leaves the install in "needs-bootstrap" state so the operator can
# create the first admin via the web wizard at /admin/login. If they set
# BOOTSTRAP_ADMIN_PASSWORD in .env, app.seed will create that admin instead.
sudo -u "$RUN_USER" bash <<EOF
set -e
cd "$BACKEND_DIR"
source .venv/bin/activate
python -m app.seed
EOF

# --- 4. frontend build --------------------------------------------------------
sudo -u "$RUN_USER" bash <<EOF
set -e
cd "$FRONTEND_DIR"
npm install
npm run build
EOF

# --- 5. systemd units ---------------------------------------------------------
# Seed runtime.env if missing — systemd EnvironmentFile reads BACKEND_PORT,
# FRONTEND_PORT, PUBLIC_BASE_URL from this file. The admin UI rewrites it.
RUNTIME_ENV="$APP_DIR/webapp/runtime.env"
if [ ! -f "$RUNTIME_ENV" ]; then
  sudo -u "$RUN_USER" bash -c "cat > '$RUNTIME_ENV' <<RUNEOF
BACKEND_PORT=8000
FRONTEND_PORT=5173
PUBLIC_BASE_URL=
RUNEOF"
fi

install_unit() {
  local src="$1" name="$2"
  sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__USER__|$RUN_USER|g" \
      "$src" > "/etc/systemd/system/$name"
}
install_unit "$APP_DIR/webapp/scripts/itrequest-backend.service"  "itrequest-backend.service"
install_unit "$APP_DIR/webapp/scripts/itrequest-frontend.service" "itrequest-frontend.service"

systemctl daemon-reload
systemctl enable --now itrequest-backend.service itrequest-frontend.service

echo
echo "==> Installed."
echo "    Backend  : http://127.0.0.1:8000  (systemctl status itrequest-backend)"
echo "    Frontend : http://<host>:5173     (systemctl status itrequest-frontend)"
echo
echo "    First-run: open  http://<host>:5173/admin/login  in a browser."
echo "    The first admin is created via the on-screen setup wizard."
echo "    (Or run:  $APP_DIR/webapp/scripts/itrequest.sh create-admin you@example.com)"
echo
echo "    Edit secrets in:  $BACKEND_DIR/.env"
echo "    Then restart   :  sudo systemctl restart itrequest-backend"
echo
echo "    Manage with    :  $APP_DIR/webapp/scripts/itrequest.sh {start|stop|restart|status|logs}"
