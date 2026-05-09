# IT Request Platform — Web SaaS

Multi-tenant SaaS platform converted from the original desktop **IT Request Form** application.
The original Tkinter app (in the project root) is **not modified**; this `webapp/` folder is fully self-contained.

## Architecture

- **Backend:** FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2
- **Frontend:** React 18 + Vite + TypeScript + TailwindCSS + React Router
- **Database:** PostgreSQL in production, SQLite for zero-config local dev
- **Multi-tenancy:** Shared DB / shared schema with `organization_id` scoping enforced in every query (RLS-style guard in dependencies)
- **Auth:** JWT access + refresh tokens, bcrypt password hashing, email invitations, password reset tokens
- **URL model:** path-based — `https://yourdomain.com/{org-slug}` (sub-domain routing can be added later without breaking changes)

## Roles

| Role           | Scope                | Highlights                                                       |
|----------------|----------------------|------------------------------------------------------------------|
| `global_admin` | Platform-wide        | Create/edit/delete orgs, manage all users, view all data         |
| `client_admin` | Single organization  | Edit org form, manage org users, view org requests, file tickets |
| `user`         | Single organization  | Submit & view own requests, manage own profile                   |

## Quick start (local dev)

### 1. Backend

```bash
cd webapp/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
python -m app.seed      # creates initial Global Admin
uvicorn app.main:app --reload --port 8000
```

The seed script prints credentials for the bootstrap Global Admin (default: `admin@example.com` / `ChangeMe!123`).

### 2. Frontend

```bash
cd webapp/frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

- Global admin console: <http://localhost:5173/admin>
- Organization portal: <http://localhost:5173/{org-slug}>

### 3. Try it

1. Log in at `/admin/login` as the seeded Global Admin.
2. Create an organization (you can seed it with the legacy IT Request Form template).
3. Create a Client Admin for it.
4. Visit `/{org-slug}` and log in as the Client Admin.
5. Invite users, customize the form, submit requests.

## Linux install (production-ish, single host)

Tested on Ubuntu 22.04+/Debian 12 and RHEL/Rocky 9. Requires `sudo`.

### One-shot install

```bash
git clone https://github.com/trinichad/Employee-Onboarding-Portal.git
cd Employee-Onboarding-Portal
sudo bash webapp/scripts/install.sh
```

That script:

1. installs `python3`, `python3-venv`, `nodejs`, `npm`,
2. creates the Python venv and installs backend deps,
3. copies `webapp/backend/.env.example` → `.env` (only if missing),
4. seeds the bootstrap Global Admin (prints the email/password — change it after first login),
5. builds the frontend (`npm run build`),
6. installs and enables two systemd units so the app comes up on boot:
   - `itrequest-backend.service`  → uvicorn on `127.0.0.1:8000`
   - `itrequest-frontend.service` → vite preview on `0.0.0.0:5173`

After install, edit `webapp/backend/.env` (set `JWT_SECRET`, `JWT_REFRESH_SECRET`,
`PUBLIC_BASE_URL`, `CORS_ORIGINS`, SMTP, etc.) and restart:

```bash
sudo systemctl restart itrequest-backend
```

> For real production put nginx/Caddy in front of `:5173` and `:8000` with TLS.
> The included frontend service uses `vite preview` for simplicity.

### First-run: create the platform admin

The first time anyone opens `http://<host>:5173/admin/login`, the page detects
that no admin exists yet and redirects to a one-time setup wizard where you
type your email + password. After that the wizard endpoint is permanently
disabled.

You can also create the first (or any extra) Global Admin from the CLI:

```bash
# interactive prompt for password
webapp/scripts/itrequest.sh create-admin you@example.com

# or specify a password inline
webapp/scripts/itrequest.sh create-admin you@example.com 'Strong!Pass1'
```

If you'd rather seed non-interactively (e.g. for an automated provisioner),
set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in `.env` before
running the installer; the seed step will create that admin and the web wizard
won't show up.

### Start / stop / restart

A small wrapper is provided:

```bash
webapp/scripts/itrequest.sh start
webapp/scripts/itrequest.sh stop
webapp/scripts/itrequest.sh restart
webapp/scripts/itrequest.sh status
webapp/scripts/itrequest.sh logs        # follow backend+frontend journal
webapp/scripts/itrequest.sh logs 500    # last 500 lines, then follow
```

Or talk to systemd directly:

```bash
sudo systemctl start    itrequest-backend itrequest-frontend
sudo systemctl stop     itrequest-backend itrequest-frontend
sudo systemctl restart  itrequest-backend itrequest-frontend
sudo systemctl status   itrequest-backend
sudo journalctl -u itrequest-backend -f
```

### Reset a password from the command line

If a user (including a Global Admin) is locked out, reset their password without
needing email delivery:

```bash
# auto-generate a strong password and print it
webapp/scripts/itrequest.sh reset-password user@example.com

# or set a specific password
webapp/scripts/itrequest.sh reset-password user@example.com 'NewPass!2026'
```

Other admin CLI commands (run from `webapp/backend` with the venv active):

```bash
source .venv/bin/activate
python -m app.cli create-admin you@example.com   # create a Global Admin
python -m app.cli list-admins
python -m app.cli activate   user@example.com
python -m app.cli deactivate user@example.com
python -m app.cli promote    user@example.com   # make global_admin
```

### Updating to a new version

```bash
cd /path/to/Employee-Onboarding-Portal
git pull
cd webapp/backend && source .venv/bin/activate && pip install -r requirements.txt && deactivate
cd ../frontend && npm install && npm run build
sudo systemctl restart itrequest-backend itrequest-frontend
```

## Project layout

```
webapp/
├─ backend/
│  ├─ app/
│  │  ├─ api/v1/                 # FastAPI routers (auth, orgs, users, forms, requests, tickets, admin)
│  │  ├─ core/                   # config, security, deps, errors
│  │  ├─ db/                     # SQLAlchemy session, base
│  │  ├─ models/                 # ORM models
│  │  ├─ schemas/                # Pydantic schemas
│  │  ├─ services/               # business logic (rbac, email, audit)
│  │  ├─ main.py                 # FastAPI app factory
│  │  └─ seed.py                 # bootstrap Global Admin
│  ├─ alembic/                   # migrations
│  ├─ requirements.txt
│  └─ .env.example
└─ frontend/
   ├─ src/
   │  ├─ api/                    # axios client + endpoints
   │  ├─ auth/                   # auth context, guards, role gating
   │  ├─ components/             # design system + shared components
   │  ├─ pages/
   │  │  ├─ admin/               # global admin console
   │  │  ├─ org/                 # client admin + standard user portal
   │  │  └─ public/              # login, password reset, invite accept
   │  ├─ lib/                    # utilities, form renderer
   │  ├─ App.tsx
   │  └─ main.tsx
   ├─ index.html
   ├─ tailwind.config.cjs
   └─ vite.config.ts
```

## Security highlights

- bcrypt password hashing (cost 12)
- JWT with separate access/refresh secrets, short-lived access tokens
- Per-request tenant guard: every org-scoped endpoint asserts the authenticated user's `organization_id` matches the route's `:org_slug`
- Global Admin endpoints require `global_admin` role and live under `/api/v1/admin/*`
- All write endpoints write to an `audit_log` table
- Org deletion requires typed confirmation of org name and is gated to Global Admin only
- Input validation via Pydantic; CORS limited to configured origins
- Uses parameterized queries everywhere (SQLAlchemy ORM) — no SQL injection surface
