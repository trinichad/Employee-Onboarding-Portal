"""In-place self-update for the single-process deployment.

The portal runs as one uvicorn process (managed by the
``itrequest-backend`` systemd unit) that serves both the API and the
built frontend. This module reproduces what the operator's manual
``update.sh`` does — ``git pull`` → ``npm run build`` → restart — but
triggered from the admin UI.

Restart strategy: once the new code is pulled and the frontend is built,
the worker schedules ``sudo -n systemctl restart itrequest-backend`` —
the same mechanism the existing admin "Restart" button uses, which the
installer enables via a sudoers drop-in. systemd owns the restart once
invoked, so the backend comes back up on the freshly pulled code even
though the invoking process is replaced. On non-systemd (dev) hosts the
build still happens and the UI is told to restart uvicorn manually.

Progress is written to a JSON status file that survives the restart so
the UI can poll across the downtime and show the final result.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

from app import __version__

# Repo layout: <repo>/webapp/backend/app/services/self_update.py
_SERVICE_FILE = Path(__file__).resolve()
BACKEND_DIR = _SERVICE_FILE.parents[2]            # webapp/backend
WEBAPP_DIR = _SERVICE_FILE.parents[3]             # webapp
# Allow an explicit override; otherwise derive the repo root from this file.
REPO_ROOT = Path(os.environ.get("ONBOARDING_REPO_DIR") or _SERVICE_FILE.parents[4])
FRONTEND_DIR = WEBAPP_DIR / "frontend"
STATUS_FILE = BACKEND_DIR / ".update_status.json"
SERVICE_NAME = "itrequest-backend"

_lock = threading.Lock()
_running = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_running() -> bool:
    return _running


def read_status() -> dict:
    try:
        with open(STATUS_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _write_status(**fields) -> None:
    data = read_status()
    data.update(fields)
    data["version"] = __version__
    tmp = STATUS_FILE.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, STATUS_FILE)
    except OSError:
        pass


def _git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=str(REPO_ROOT),
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def current_revision() -> dict:
    return {"version": __version__, "git_sha": _git_sha()}


def _run(cmd: List[str], cwd: Path, timeout: int) -> Tuple[int, str]:
    try:
        proc = subprocess.run(
            cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout,
        )
        return proc.returncode, ((proc.stdout or "") + (proc.stderr or "")).strip()
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"
    except FileNotFoundError as exc:
        return 127, f"command not found: {exc}"
    except Exception as exc:  # pragma: no cover - defensive
        return 1, str(exc)


def _schedule_restart() -> Tuple[bool, str]:
    """Schedule a detached ``systemctl restart`` so systemd brings us back up.

    Returns (scheduled, message). On non-systemd hosts returns (False, ...)
    and the caller leaves the (already rebuilt) app running on the new dist.
    """
    systemctl = shutil.which("systemctl") or next(
        (p for p in ("/usr/bin/systemctl", "/bin/systemctl") if os.path.exists(p)), None,
    )
    if not systemctl or not os.path.exists("/run/systemd/system"):
        return False, "No systemd detected — restart the backend manually to load new code."
    sudo = shutil.which("sudo") or next(
        (p for p in ("/usr/bin/sudo", "/bin/sudo") if os.path.exists(p)), "/usr/bin/sudo",
    )
    try:
        # Detach (new session) so the parent can finish writing status before
        # systemd stops this unit; the restart is owned by systemd once invoked.
        subprocess.Popen(
            ["/bin/sh", "-c", f"sleep 1 && {sudo} -n {systemctl} restart {SERVICE_NAME}"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return True, "Update applied — restarting the backend…"
    except OSError as exc:
        return False, f"Build finished but the restart could not be scheduled: {exc}"


def finalize_after_restart() -> None:
    """Called on startup. If we exited mid-update to restart, mark it done."""
    data = read_status()
    if data.get("state") == "restarting":
        _write_status(
            state="done", ok=True, phase="Up to date",
            message="Update complete — backend restarted on the new build.",
            git_sha=_git_sha(), finished_at=_now_iso(),
        )


def _worker(actor_email: str) -> None:
    global _running
    log: List[str] = []

    def record(cmd: List[str], out: str) -> None:
        log.append(f"$ {' '.join(cmd)}\n{out}".strip())

    try:
        old_sha = _git_sha()

        # 1. Pull latest code (fast-forward only — a deploy checkout shouldn't diverge).
        _write_status(state="running", phase="Pulling latest code", ok=None,
                      log="\n\n".join(log))
        cmd = ["git", "pull", "--ff-only"]
        rc, out = _run(cmd, REPO_ROOT, 120)
        record(cmd, out)
        if rc != 0:
            _write_status(state="failed", ok=False, phase="git pull",
                          message="git pull failed — resolve on the server and retry.",
                          log="\n\n".join(log), finished_at=_now_iso())
            return

        new_sha = _git_sha()
        if new_sha == old_sha:
            _write_status(state="done", ok=True, phase="Already up to date",
                          message="Already up to date — nothing to deploy.",
                          git_sha=new_sha, log="\n\n".join(log), finished_at=_now_iso())
            return

        # 2. If backend dependencies changed, install them so the restart
        #    doesn't crash-loop on a missing import.
        rc_diff, changed = _run(["git", "diff", "--name-only", old_sha, new_sha], REPO_ROOT, 30)
        if rc_diff == 0 and "webapp/backend/requirements.txt" in changed.split():
            _write_status(state="running", phase="Installing backend dependencies",
                          log="\n\n".join(log))
            cmd = ["python", "-m", "pip", "install", "-r", "requirements.txt"]
            rc, out = _run(cmd, BACKEND_DIR, 600)
            record(cmd, out)
            if rc != 0:
                _write_status(state="failed", ok=False, phase="pip install",
                              message="Backend dependency install failed — not restarting.",
                              log="\n\n".join(log), finished_at=_now_iso())
                return

        # 3. Build the frontend (output goes to webapp/frontend/dist).
        _write_status(state="running", phase="Building frontend", log="\n\n".join(log))
        cmd = ["npm", "run", "build"]
        rc, out = _run(cmd, FRONTEND_DIR, 1200)
        record(cmd, out)
        if rc != 0:
            _write_status(state="failed", ok=False, phase="npm build",
                          message="Frontend build failed — not restarting (site stays up on the old build).",
                          log="\n\n".join(log), finished_at=_now_iso())
            return

        # 4. Everything is in place — schedule the restart. The startup hook
        #    flips "restarting" to "done" once the new process is back up.
        scheduled, message = _schedule_restart()
        if scheduled:
            _write_status(state="restarting", ok=True, phase="Restarting backend",
                          message=message, git_sha=new_sha,
                          log="\n\n".join(log), finished_at=_now_iso())
        else:
            # Build is done and dist is updated; we just couldn't auto-restart.
            _write_status(state="done", ok=True, phase="Built — restart pending",
                          message=message, git_sha=new_sha,
                          log="\n\n".join(log), finished_at=_now_iso())
    except Exception as exc:  # pragma: no cover - defensive
        _write_status(state="failed", ok=False, phase="error", message=str(exc),
                      log="\n\n".join(log), finished_at=_now_iso())
    finally:
        _running = False


def start_update(actor_email: str) -> bool:
    """Kick off the update in a background thread. Returns False if one is
    already running."""
    global _running
    with _lock:
        if _running:
            return False
        _running = True
    _write_status(state="running", phase="Starting", ok=None, started_by=actor_email,
                  started_at=_now_iso(), finished_at=None, message="", log="")
    threading.Thread(target=_worker, args=(actor_email,), daemon=True).start()
    return True
