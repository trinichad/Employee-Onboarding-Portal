# IT Request / Employee Onboarding Platform

This repository contains **two related applications** that share the same domain model (an IT request form for new hire / termination / promotion / rehire workflows):

1. **Desktop app** (`app.py`, repository root) — a single-user Windows desktop tool written in Python/Tkinter. Distributed as a signed `.exe` via PyInstaller + Inno Setup.
2. **Web SaaS platform** (`webapp/`) — a multi-tenant FastAPI + React application that hosts the same workflow for many organizations, with admin consoles, RBAC, email, audit logging, and Linux/systemd packaging.

Both apps are self-contained and can be developed independently. The desktop app is **not** modified by anything under `webapp/`.

---

## Table of contents

- [Repository layout](#repository-layout)
- [Desktop app](#desktop-app)
  - [Technology stack](#desktop-technology-stack)
  - [How it works](#desktop-how-it-works)
  - [Run from source](#desktop-run-from-source)
  - [Build EXE](#build-exe-windows)
  - [Build installer](#build-installer-windows)
  - [Code signing](#code-signing)
- [Web SaaS platform](#web-saas-platform)
  - [Technology stack](#web-technology-stack)
  - [Runtime architecture](#runtime-architecture)
  - [Roles & multi-tenancy](#roles--multi-tenancy)
  - [Authentication & 2FA](#authentication--2fa)
  - [Data model](#data-model)
  - [API surface](#api-surface)
  - [Frontend structure](#frontend-structure)
  - [Local development](#local-development)
  - [Linux production install](#linux-production-install)
  - [Operations (CLI & systemd)](#operations-cli--systemd)
  - [Configuration reference](#configuration-reference)
  - [Security model](#security-model)
- [Documentation](#documentation)

---

## Repository layout

```
.
├─ app.py                       # Desktop Tkinter application (single file)
├─ requirements.txt             # Desktop runtime/build deps (PyInstaller, ttkbootstrap, tkcalendar)
├─ IT Request Form.spec         # PyInstaller spec file
├─ build_exe.ps1                # PowerShell: build signed/unsigned EXE
├─ build_installer.ps1          # PowerShell: build Inno Setup installer
├─ build_release_note.ps1       # PowerShell: emit release-note.txt with SHA256s
├─ build_signed_release.ps1     # PowerShell: end-to-end signed release pipeline
├─ installer/
│  └─ IT Request Form.iss       # Inno Setup script
├─ signing/                     # (gitignored) code-signing materials
├─ config/                      # Default config shipped with the desktop app
│  ├─ bootstrap_settings.json   #   storage root pointer
│  ├─ settings.json             #   user preferences
│  ├─ form_schema.json          #   editable form definition
│  └─ custom_fields.json        #   user-added fields
├─ data/requests/               # Saved requests (JSON + TXT) for desktop app
├─ docs/
│  └─ IT_Request_Form_User_Guide.md
└─ webapp/                      # Self-contained web platform (see below)
   ├─ backend/                  # FastAPI service
   ├─ frontend/                 # React + Vite SPA
   └─ scripts/                  # install.sh, itrequest.sh, systemd unit
```

---

## Desktop app

A standalone Windows desktop form for filling out and saving IT onboarding/offboarding requests. Useful for IT teams that need a structured, editable form without standing up a server.

### Desktop technology stack

| Component | Library / Tool | Purpose |
|-----------|----------------|---------|
| Language | Python 3.9+ | Single-file app ([app.py](app.py)) |
| GUI toolkit | Tkinter (stdlib) | Native widgets, layout, dialogs |
| GUI theme | [`ttkbootstrap`](https://ttkbootstrap.readthedocs.io/) `1.14.1` | Modern Bootstrap-style themes for Tk |
| Date picker | [`tkcalendar`](https://pypi.org/project/tkcalendar/) `1.6.1` | `DateEntry` calendar widget for `Effective Date` |
| Persistence | JSON + plain text files on disk | One pair of files per saved request |
| Packaging | [`PyInstaller`](https://pyinstaller.org/) `6.15.0` | One-file Windows EXE |
| Installer | [Inno Setup 6](https://jrsoftware.org/isdl.php) | `.exe` installer with Start Menu shortcuts |
| Signing | `signtool.exe` (Windows SDK) | Authenticode signing of EXE + installer |
| Build orchestration | PowerShell 5.1+ | `.ps1` scripts in repo root |

### Desktop how it works

- **Single-file architecture.** All logic lives in [app.py](app.py): config loading, form rendering, validation, file I/O, and the menu/edit dialogs.
- **Form definition is data-driven.** The form (request types, sections, field labels, descriptions, group items) is defined in [config/form_schema.json](config/form_schema.json) and is editable from the **Form Setup** dialog inside the app. Custom fields are stored separately in [config/custom_fields.json](config/custom_fields.json).
- **Storage root resolution.** On launch the app calls `resolve_storage_root_dir()` in [app.py](app.py) to decide where to read/write data:
  - In dev (running from source): the repo folder.
  - When frozen (installed EXE): prefers `<install-dir>/AppData/` if writable, otherwise `%APPDATA%/ITRequestForm/`. The chosen path is persisted in `config/bootstrap_settings.json`.
- **Saving a request.** Submitting writes two files to `data/requests/`:
  - `Name - RequestType - EffectiveDate.json` — machine-readable payload
  - `Name - RequestType - EffectiveDate.txt` — human-readable summary
- **Re-opening a previous employee.** The "Load previous employee" feature scans saved JSON files by employee name so a Termination request can be pre-filled from the original New Hire submission.
- **Access groups.** Editable groups (System/Web Access, Email Groups, Shared Mailboxes, SharePoint Sites, Google Drives, Property Network/Mailbox Access) can be toggled on/off and re-labelled in Form Setup.

### Desktop run from source

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

### Build EXE (Windows)

```powershell
.\build_exe.ps1
# or with a version tag
.\build_exe.ps1 -Version 1.0.1
```

Outputs:

- `dist/IT Request Form.exe`
- `dist/checksums.txt` (SHA256)
- `dist/release-note.txt`

### Build installer (Windows)

Install [Inno Setup 6](https://jrsoftware.org/isdl.php), then:

```powershell
.\build_installer.ps1 -Version 1.0.1
```

Outputs:

- `dist/IT_Request_Form_Installer.exe`
- `dist/IT Request Form.zip` — deploy bundle with installer + release note + update instructions

### Code signing

Either an installed cert (by subject) or a PFX file is supported:

```powershell
# Cert store
.\build_installer.ps1 -Sign -CertSubject "Your Company Name"

# PFX
$env:SIGN_PFX_PASSWORD = "<your-pfx-password>"
.\build_installer.ps1 -Sign -PfxPath "C:\certs\codesign.pfx"
```

For a repeatable, end-to-end signed release pipeline:

```powershell
.\build_signed_release.ps1 -Version 1.0.1
# or, to store the PFX password in Windows Credential Manager:
.\build_signed_release.ps1 -PromptForPassword -PersistPassword
```

Default PFX path: `dist\signing\ITRequestForm-InternalCodeSign.pfx`. `signtool.exe` must be on `PATH` (install Windows SDK Signing Tools).

---

## Web SaaS platform

A multi-tenant web version of the same workflow, lives under [webapp/](webapp/). One process (`uvicorn`) serves both the JSON API and the pre-built React SPA on a single port — no reverse proxy or separate frontend service required for a basic deployment.

### Web technology stack

#### Backend — Python ([webapp/backend/](webapp/backend))

| Component | Version | Role |
|-----------|---------|------|
| [**FastAPI**](https://fastapi.tiangolo.com/) | `0.115.0` | HTTP framework, routing, OpenAPI/Swagger (`/api/docs`), dependency injection |
| [**Uvicorn**](https://www.uvicorn.org/) `[standard]` | `0.30.6` | ASGI server (uvloop + httptools); the actual process binding `0.0.0.0:8000` |
| [**SQLAlchemy 2**](https://www.sqlalchemy.org/) | `>=2.0.43,<2.1` | ORM + connection pool, parameterized queries |
| [**Alembic**](https://alembic.sqlalchemy.org/) | `>=1.14,<2` | Schema migrations (`alembic upgrade head`) |
| [**Pydantic v2**](https://docs.pydantic.dev/) + `pydantic-settings` | `>=2.11`, `>=2.7` | Request/response models, typed settings loaded from `.env` |
| [**python-jose**](https://github.com/mpdavis/python-jose) `[cryptography]` | `3.3.0` | JWT signing/verification (HS256) |
| [**passlib**](https://passlib.readthedocs.io/) `[bcrypt]` + `bcrypt` | `1.7.4` / `4.0.1` | Password hashing (bcrypt, cost 12) |
| [**python-multipart**](https://andrew-d.github.io/python-multipart/) | `0.0.9` | Multipart form parsing (file uploads / logos) |
| [**email-validator**](https://pypi.org/project/email-validator/) | `2.2.0` | RFC-compliant email validation |
| [**python-slugify**](https://pypi.org/project/python-slugify/) | `8.0.4` | Org slug generation |
| [**pyotp**](https://pyauth.github.io/pyotp/) | `2.9.0` | TOTP 2FA codes |
| [**qrcode**](https://pypi.org/project/qrcode/) `[pil]` | `7.4.2` | QR codes for TOTP enrolment |

Stdlib `smtplib` + `email` are used for outbound mail (no external mailer SDK).

#### Frontend — Node/TypeScript ([webapp/frontend/](webapp/frontend))

| Component | Version | Role |
|-----------|---------|------|
| [**React**](https://react.dev/) | `^18.3.1` | UI library |
| [**Vite**](https://vitejs.dev/) | `^5.4.8` | Dev server + production bundler (outputs static assets to `frontend/dist`) |
| [**TypeScript**](https://www.typescriptlang.org/) | `^5.6.2` | Static typing |
| [**React Router**](https://reactrouter.com/) | `^6.27.0` | Path-based routing (`/admin/*`, `/{org-slug}/*`, public pages) |
| [**TanStack Query**](https://tanstack.com/query) | `^5.59.0` | Server-state caching for API calls |
| [**Axios**](https://axios-http.com/) | `^1.7.7` | HTTP client with auth/refresh interceptors |
| [**TailwindCSS**](https://tailwindcss.com/) | `^3.4.13` | Utility-first styling (+ PostCSS + autoprefixer) |
| [**lucide-react**](https://lucide.dev/) | `^0.453.0` | Icon set |
| [**react-hot-toast**](https://react-hot-toast.com/) | `^2.4.1` | Toast notifications |
| [**clsx**](https://github.com/lukeed/clsx) | `^2.1.1` | Conditional className composition |

#### Database

- **PostgreSQL** in production (set `DATABASE_URL=postgresql+psycopg://...`)
- **SQLite** by default for zero-config dev (`sqlite:///./dev.db`)

#### Deployment

- **systemd** unit [webapp/scripts/itrequest-backend.service](webapp/scripts/itrequest-backend.service) (one process, `ExecStart=.../uvicorn app.main:app --host 0.0.0.0 --port ${BACKEND_PORT}`)
- **Shell installer** [webapp/scripts/install.sh](webapp/scripts/install.sh) (Debian/Ubuntu/RHEL families; installs Python, Node 20, builds venv + SPA, wires the service)
- **Operator helper** [webapp/scripts/itrequest.sh](webapp/scripts/itrequest.sh) (start/stop/restart/logs/CLI passthrough)
- Optional reverse proxy: **nginx** or **Caddy** in front of `:8000` for TLS (not required to run, recommended for production)

### Runtime architecture

```
                       ┌──────────────────────────────────────────────┐
                       │              Uvicorn (single process)        │
   Browser ──HTTP──▶   │  FastAPI app (webapp/backend/app/main.py)    │
                       │                                              │
                       │  /api/v1/*    →  Routers (JSON API)          │
                       │  /api/docs    →  Swagger UI                  │
                       │  /api/health  →  liveness probe              │
                       │  /static/*    →  built SPA assets            │
                       │  / (catch-all)→  index.html (SPA fallback)   │
                       └────────────┬─────────────────────────────────┘
                                    │  SQLAlchemy
                                    ▼
                       ┌──────────────────────────────────────────────┐
                       │   PostgreSQL (prod)  /  SQLite (dev)         │
                       └──────────────────────────────────────────────┘
                                    │
                                    ▼  smtplib (TLS/STARTTLS)
                       ┌──────────────────────────────────────────────┐
                       │   SMTP relay (invites, password reset, etc.) │
                       └──────────────────────────────────────────────┘
```

Key implementation notes (see [webapp/backend/app/main.py](webapp/backend/app/main.py)):

- A FastAPI **lifespan** hook calls `Base.metadata.create_all()` on startup so the app boots on an empty database. Production deployments should still run `alembic upgrade head`.
- A `_ensure_dev_schema()` helper performs lightweight **in-place `ALTER TABLE`** migrations for SQLite dev databases so columns added after the initial create can land without a full Alembic run.
- After `/api/*` routes are mounted, the app mounts `webapp/frontend/dist/` and serves `index.html` for any non-API path — this is what makes the single-port deployment work.
- **CORS** is enabled only for origins listed in the `CORS_ORIGINS` env var.

### Roles & multi-tenancy

| Role | Scope | Highlights |
|------|-------|------------|
| `global_admin` | Platform-wide | Create/edit/delete orgs, manage all users, view all data, platform settings, branding |
| `client_admin` | Single organization | Edit org form, manage org users, view org requests, configure SMTP/branding |
| `user` | Single organization | Submit & view own requests, manage profile |

Multi-tenancy is **shared DB / shared schema** with `organization_id` scoping enforced in dependency-injected guards on every org-scoped endpoint. The URL model is **path-based** (`/{org-slug}/...`); sub-domain routing can be added later without a schema change.

### Authentication & 2FA

- **Password hashing:** bcrypt via `passlib` (cost 12).
- **JWT:** separate `JWT_SECRET` and `JWT_REFRESH_SECRET`, HS256, short-lived access tokens (default 30 min) and longer refresh tokens (default 30 days).
- **TOTP 2FA** (optional per user): secret generated with `pyotp`, QR code rendered server-side with `qrcode`, secret encrypted at rest in `users.totp_secret_enc`.
- **Invitations & password reset:** signed, time-limited tokens delivered by SMTP.
- **First-run wizard:** if no `global_admin` exists, hitting `/admin/login` redirects to a one-time `/admin/setup` page; the wizard endpoint disables itself after first use.

### Data model

Core tables (see auto-managed schema in [webapp/backend/app/main.py](webapp/backend/app/main.py)):

- `organizations` — tenant; branding (`logo_ext`), SMTP overrides, dashboard column config, from-email/from-name, support email.
- `users` — `email`, `password_hash`, `role`, `organization_id`, `can_approve_requests`, TOTP fields, `theme`.
- `platform_settings` — singleton row for platform-wide SMTP, timezone, ports (`backend_port`, `frontend_port`), `public_base_url`, platform logo.
- `employee_requests` — submission data + workflow state (`status`, `submitted_at`, `first_submitted_at`, `approved_by_id`, `approved_at`, `submission_count`, `edited_after_submit`, `support_message`).
- `audit_log` — append-only record of writes (who, when, what).
- Plus form schema, custom fields, resources, and invitation/reset token tables.

### API surface

All endpoints are mounted under `/api/v1/` (see [webapp/backend/app/api/v1/__init__.py](webapp/backend/app/api/v1/__init__.py)):

| Router | File | Responsibility |
|--------|------|----------------|
| `auth` | [auth.py](webapp/backend/app/api/v1/auth.py) | Login, refresh, logout, password reset, accept invite |
| `me` | [me.py](webapp/backend/app/api/v1/me.py) | Current user profile, password change, TOTP enrol/verify |
| `config` | [config.py](webapp/backend/app/api/v1/config.py) | Platform settings (global admin) |
| `branding` | [branding.py](webapp/backend/app/api/v1/branding.py) | Logo upload/serve for platform + per-org |
| `admin` | [admin.py](webapp/backend/app/api/v1/admin.py) | Global admin: orgs, users, audit, restart, setup wizard |
| `orgs` | [orgs.py](webapp/backend/app/api/v1/orgs.py) | Per-org settings, SMTP overrides |
| `users` | [users.py](webapp/backend/app/api/v1/users.py) | Org user management, invites |
| `forms` | [forms.py](webapp/backend/app/api/v1/forms.py) | Per-org form schema (data-driven form) |
| `resources` | [resources.py](webapp/backend/app/api/v1/resources.py) | Reusable resource lists (groups, mailboxes, drives) |
| `employees` | [employees.py](webapp/backend/app/api/v1/employees.py) | Employee directory / history lookups |
| `requests` | [requests.py](webapp/backend/app/api/v1/requests.py) | Submit, list, view, approve, edit employee requests |

Interactive API docs: `http://<host>:8000/api/docs`.

### Frontend structure

```
webapp/frontend/src/
├─ App.tsx                          # Router + providers
├─ main.tsx                         # ReactDOM entry, QueryClient, ThemeProvider
├─ api/                             # Axios client + typed endpoint wrappers
├─ auth/
│  ├─ AuthContext.tsx               # JWT storage, refresh, role state
│  ├─ Protected.tsx                 # Route guard
│  └─ ThemeContext.tsx              # Light/dark theme
├─ components/                      # FormRenderer, Modal, SmtpForm, TwoFactorCard, ui.tsx, ...
├─ pages/
│  ├─ admin/                        # Global admin console (orgs, users, audit, settings, profile)
│  ├─ org/                          # Tenant portal (dashboard, requests, form builder, users, resources)
│  └─ public/                       # Login, password reset, invite accept, setup wizard
└─ lib/platform.ts                  # Shared helpers
```

Build output goes to `webapp/frontend/dist/` and is served by uvicorn in production.

### Local development

#### Backend

```bash
cd webapp/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
python -m app.seed                     # creates initial Global Admin
uvicorn app.main:app --reload --port 8000
```

The seed script prints credentials for the bootstrap Global Admin (default `admin@example.com` / `ChangeMe!123` — change on first login).

#### Frontend

```bash
cd webapp/frontend
npm install
npm run dev                            # http://localhost:5173
```

- Global admin console: <http://localhost:5173/admin>
- Organization portal:  <http://localhost:5173/{org-slug}>

### Linux production install

Tested on Ubuntu 22.04+/Debian 12 and RHEL/Rocky 9. Requires `sudo`.

```bash
git clone https://github.com/trinichad/Employee-Onboarding-Portal.git
cd Employee-Onboarding-Portal
sudo bash webapp/scripts/install.sh
```

The installer (see [webapp/scripts/install.sh](webapp/scripts/install.sh)):

1. installs `python3`, `python3-venv`, `nodejs` (NodeSource 20.x on Debian/Ubuntu), `npm`,
2. creates the Python venv and installs backend deps,
3. copies `webapp/backend/.env.example` → `.env` if missing,
4. runs `python -m app.seed` to create the bootstrap Global Admin,
5. builds the frontend with `npm run build` (output: `webapp/frontend/dist/`),
6. renders [webapp/scripts/itrequest-backend.service](webapp/scripts/itrequest-backend.service) into `/etc/systemd/system/`, enables and starts it,
7. drops a narrow sudoers rule allowing the run-user to `systemctl restart itrequest-backend` (so the in-app "Restart server" button works).

Edit `webapp/backend/.env` to set production values (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `PUBLIC_BASE_URL`, `CORS_ORIGINS`, SMTP, `DATABASE_URL`) and restart:

```bash
sudo systemctl restart itrequest-backend
```

> For real production put nginx or Caddy in front of `:8000` to terminate TLS.

### Operations (CLI & systemd)

Wrapper script — [webapp/scripts/itrequest.sh](webapp/scripts/itrequest.sh):

```bash
webapp/scripts/itrequest.sh start | stop | restart | status
webapp/scripts/itrequest.sh logs            # follow journal
webapp/scripts/itrequest.sh logs 500        # last 500 lines, then follow

webapp/scripts/itrequest.sh create-admin    you@example.com
webapp/scripts/itrequest.sh reset-password  user@example.com 'NewPass!2026'
```

Direct systemd:

```bash
sudo systemctl {start|stop|restart|status} itrequest-backend
sudo journalctl -u itrequest-backend -f
```

Admin CLI (from `webapp/backend` with the venv active) — [webapp/backend/app/cli.py](webapp/backend/app/cli.py):

```bash
python -m app.cli create-admin you@example.com
python -m app.cli list-admins
python -m app.cli activate   user@example.com
python -m app.cli deactivate user@example.com
python -m app.cli promote    user@example.com
```

Updating to a new version:

```bash
git pull
cd webapp/backend && source .venv/bin/activate && pip install -r requirements.txt && deactivate
cd ../frontend && npm install && npm run build
sudo systemctl restart itrequest-backend
```

### Configuration reference

Backend settings are loaded by Pydantic from `webapp/backend/.env` (see [webapp/backend/app/core/config.py](webapp/backend/app/core/config.py)):

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./dev.db` | SQLAlchemy URL. Use `postgresql+psycopg://user:pw@host/db` in prod |
| `JWT_SECRET` | `dev-secret-change-me` | HS256 access-token secret |
| `JWT_REFRESH_SECRET` | `dev-refresh-secret-change-me` | HS256 refresh-token secret |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm |
| `ACCESS_TOKEN_TTL_MINUTES` | `30` | Access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh-token lifetime |
| `PUBLIC_BASE_URL` | `http://localhost:5173` | Used in invite/reset links |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allow-list |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM` / `SMTP_TLS` | — | Outbound mail (overridable per-org and at the platform level via DB) |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` / `BOOTSTRAP_ADMIN_NAME` | `admin@example.com` / `ChangeMe!123` / `Platform Admin` | Seed Global Admin used by `python -m app.seed` |

A second file, `webapp/runtime.env`, is written by the admin UI at runtime (currently `BACKEND_PORT`, `PUBLIC_BASE_URL`) and is loaded by systemd via `EnvironmentFile=-...`.

### Security model

- **Password hashing:** bcrypt (cost 12) via `passlib`; passwords never stored or logged in plaintext.
- **JWT:** separate access and refresh secrets, short-lived access tokens.
- **Tenant guard:** every org-scoped endpoint asserts the authenticated user's `organization_id` matches the route's `:org_slug` (RLS-style guard in dependencies).
- **Global Admin endpoints** require the `global_admin` role and live under `/api/v1/admin/*`.
- **Audit log:** all write endpoints append to `audit_log` (see [webapp/backend/app/services/audit.py](webapp/backend/app/services/audit.py)).
- **Org deletion** requires typed confirmation of the org name and is gated to Global Admin only.
- **Input validation** via Pydantic v2 on every request body / query model.
- **SQL injection:** SQLAlchemy ORM with parameterized queries everywhere.
- **CORS** restricted to `CORS_ORIGINS`.
- **2FA:** optional TOTP per user; secrets encrypted at rest.
- **Secrets:** JWT secrets and SMTP credentials are read from `.env` / `runtime.env`, never committed.

---

## Documentation

- Desktop user guide: [docs/IT_Request_Form_User_Guide.md](docs/IT_Request_Form_User_Guide.md)
- Web platform README (additional operator notes): [webapp/README.md](webapp/README.md)
- Interactive API docs (when running): `http://<host>:8000/api/docs`
