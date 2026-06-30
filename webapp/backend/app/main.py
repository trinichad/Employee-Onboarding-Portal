from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.v1 import api_router
from app.core.config import settings
from app.db.session import Base, engine
import app.models  # noqa: F401  ensures models are registered on metadata


# webapp/backend/app/main.py -> webapp/frontend/dist
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def _ensure_dev_schema() -> None:
    """Lightweight in-place migration for dev SQLite databases.

    Adds new columns introduced after initial create_all and removes any stale
    CHECK constraint on employee_requests.status that would reject new enum
    values. No-op for non-SQLite engines (use Alembic in production).
    """
    if not engine.url.drivername.startswith("sqlite"):
        return
    import re

    with engine.begin() as conn:
        def has_col(table: str, col: str) -> bool:
            rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
            return any(r[1] == col for r in rows)

        def table_exists(name: str) -> bool:
            r = conn.exec_driver_sql(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
            ).fetchone()
            return bool(r)

        # Drop legacy ticket tables (feature removed). Their FKs to users(id)
        # were blocking user deletes. ticket_messages must go first (FK to
        # support_tickets).
        if table_exists("ticket_messages"):
            conn.exec_driver_sql("DROP TABLE ticket_messages")
        if table_exists("support_tickets"):
            conn.exec_driver_sql("DROP TABLE support_tickets")

        if table_exists("users") and not has_col("users", "can_approve_requests"):
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN can_approve_requests BOOLEAN NOT NULL DEFAULT 0"
            )
        if table_exists("users") and not has_col("users", "totp_secret_enc"):
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN totp_secret_enc VARCHAR(512)"
            )
        if table_exists("users") and not has_col("users", "totp_pending_secret_enc"):
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN totp_pending_secret_enc VARCHAR(512)"
            )
        if table_exists("users") and not has_col("users", "totp_enrolled_at"):
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN totp_enrolled_at DATETIME"
            )
        if table_exists("users") and not has_col("users", "theme"):
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN theme VARCHAR(16) NOT NULL DEFAULT 'light'"
            )
        if table_exists("organizations") and not has_col("organizations", "support_email"):
            conn.exec_driver_sql(
                "ALTER TABLE organizations ADD COLUMN support_email VARCHAR(255) NOT NULL DEFAULT ''"
            )
        if table_exists("organizations") and not has_col("organizations", "from_email"):
            conn.exec_driver_sql(
                "ALTER TABLE organizations ADD COLUMN from_email VARCHAR(255) NOT NULL DEFAULT ''"
            )
        if table_exists("organizations") and not has_col("organizations", "from_name"):
            conn.exec_driver_sql(
                "ALTER TABLE organizations ADD COLUMN from_name VARCHAR(120) NOT NULL DEFAULT ''"
            )
        if table_exists("organizations") and not has_col("organizations", "dashboard_columns"):
            conn.exec_driver_sql(
                "ALTER TABLE organizations ADD COLUMN dashboard_columns JSON"
            )
        if table_exists("organizations") and not has_col("organizations", "require_approval"):
            conn.exec_driver_sql(
                "ALTER TABLE organizations ADD COLUMN require_approval BOOLEAN NOT NULL DEFAULT 1"
            )
        if table_exists("platform_settings") and not has_col("platform_settings", "default_from_email"):
            conn.exec_driver_sql(
                "ALTER TABLE platform_settings ADD COLUMN default_from_email VARCHAR(255) NOT NULL DEFAULT ''"
            )
        if table_exists("platform_settings") and not has_col("platform_settings", "default_from_name"):
            conn.exec_driver_sql(
                "ALTER TABLE platform_settings ADD COLUMN default_from_name VARCHAR(120) NOT NULL DEFAULT ''"
            )
        if table_exists("platform_settings") and not has_col("platform_settings", "timezone"):
            conn.exec_driver_sql(
                "ALTER TABLE platform_settings ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'UTC'"
            )

        # Network / runtime settings
        if table_exists("platform_settings"):
            for col, ddl in [
                ("backend_port", "ALTER TABLE platform_settings ADD COLUMN backend_port INTEGER NOT NULL DEFAULT 8000"),
                ("frontend_port", "ALTER TABLE platform_settings ADD COLUMN frontend_port INTEGER NOT NULL DEFAULT 5173"),
                ("public_base_url", "ALTER TABLE platform_settings ADD COLUMN public_base_url VARCHAR(512) NOT NULL DEFAULT ''"),
                ("logo_ext", "ALTER TABLE platform_settings ADD COLUMN logo_ext VARCHAR(8) NOT NULL DEFAULT ''"),
            ]:
                if not has_col("platform_settings", col):
                    conn.exec_driver_sql(ddl)

        # Org logo column
        if table_exists("organizations") and not has_col("organizations", "logo_ext"):
            conn.exec_driver_sql(
                "ALTER TABLE organizations ADD COLUMN logo_ext VARCHAR(8) NOT NULL DEFAULT ''"
            )

        # SMTP override columns on organizations + platform_settings
        smtp_cols = [
            ("smtp_host", "VARCHAR(255) NOT NULL DEFAULT ''"),
            ("smtp_port", "INTEGER NOT NULL DEFAULT 0"),
            ("smtp_security", "VARCHAR(20) NOT NULL DEFAULT ''"),
            ("smtp_auth", "VARCHAR(20) NOT NULL DEFAULT ''"),
            ("smtp_username", "VARCHAR(255) NOT NULL DEFAULT ''"),
            ("smtp_password", "VARCHAR(512) NOT NULL DEFAULT ''"),
        ]
        for table in ("organizations", "platform_settings"):
            if table_exists(table):
                for col, ddl in smtp_cols:
                    if not has_col(table, col):
                        conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
        if table_exists("employee_requests"):
            for col, ddl in [
                ("approved_by_id", "ALTER TABLE employee_requests ADD COLUMN approved_by_id INTEGER REFERENCES users(id)"),
                ("approved_at", "ALTER TABLE employee_requests ADD COLUMN approved_at DATETIME"),
                ("submitted_at", "ALTER TABLE employee_requests ADD COLUMN submitted_at DATETIME"),
                ("first_submitted_at", "ALTER TABLE employee_requests ADD COLUMN first_submitted_at DATETIME"),
                ("submitted_by_id", "ALTER TABLE employee_requests ADD COLUMN submitted_by_id INTEGER REFERENCES users(id)"),
                ("support_message", "ALTER TABLE employee_requests ADD COLUMN support_message TEXT"),
                ("edited_after_submit", "ALTER TABLE employee_requests ADD COLUMN edited_after_submit BOOLEAN NOT NULL DEFAULT 0"),
                ("submission_count", "ALTER TABLE employee_requests ADD COLUMN submission_count INTEGER NOT NULL DEFAULT 0"),
            ]:
                if not has_col("employee_requests", col):
                    conn.exec_driver_sql(ddl)

            # Backfill: rows submitted before first_submitted_at existed should
            # treat their submitted_at as the first send.
            if has_col("employee_requests", "first_submitted_at"):
                conn.exec_driver_sql(
                    "UPDATE employee_requests SET first_submitted_at = submitted_at "
                    "WHERE first_submitted_at IS NULL AND submitted_at IS NOT NULL"
                )

            row = conn.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='employee_requests'"
            ).fetchone()
            if row and row[0] and "pending_approval" not in row[0]:
                cleaned = re.sub(
                    r",\s*CHECK\s*\(\s*status\s+IN\s*\([^)]*\)\s*\)",
                    "",
                    row[0],
                    flags=re.IGNORECASE,
                )
                if cleaned != row[0]:
                    conn.exec_driver_sql("PRAGMA writable_schema = 1")
                    conn.exec_driver_sql(
                        "UPDATE sqlite_master SET sql=? WHERE type='table' AND name='employee_requests'",
                        (cleaned,),
                    )
                    conn.exec_driver_sql("PRAGMA writable_schema = 0")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-create tables on startup so the app runs without manually invoking Alembic.
    # In production, use `alembic upgrade head` instead.
    Base.metadata.create_all(bind=engine)
    _ensure_dev_schema()
    # If we exited mid-update to restart, mark the self-update as complete now
    # that we're back up on the new build.
    try:
        from app.services.self_update import finalize_after_restart
        finalize_after_restart()
    except Exception:  # pragma: no cover - never block startup on this
        pass
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Employee Onboarding Portal",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Total-Count"],
    )
    app.include_router(api_router)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "version": __version__}

    # ---- Serve the built frontend (single-port deployment) ------------------
    # If webapp/frontend/dist exists, mount its static assets and SPA-fallback
    # any non-/api path to index.html. This makes `uvicorn app.main:app` the
    # only process needed in production: one port, no reverse proxy, no CORS.
    if FRONTEND_DIST.is_dir() and (FRONTEND_DIST / "index.html").is_file():
        assets_dir = FRONTEND_DIST / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        index_html = FRONTEND_DIST / "index.html"

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str, request: Request):
            # Never shadow API or docs routes.
            if full_path.startswith("api/") or full_path in {"api", "api/docs", "api/openapi.json"}:
                raise HTTPException(status_code=404)
            # Serve a real file from dist if it exists (favicon, robots.txt, etc.)
            candidate = (FRONTEND_DIST / full_path).resolve() if full_path else None
            if candidate and FRONTEND_DIST in candidate.parents and candidate.is_file():
                return FileResponse(str(candidate))
            # Otherwise fall through to the SPA — React Router takes it from there.
            return FileResponse(str(index_html))

    return app


app = create_app()
