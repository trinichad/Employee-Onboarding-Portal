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
