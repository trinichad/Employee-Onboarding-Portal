"""Logo / branding asset storage on disk.

Logos are stored outside the database under ``<repo>/data/logos/`` so they
survive backups and can be backed up separately. File names are deterministic:

  - Platform logo:      ``platform.<ext>``
  - Per-organization:   ``org-<id>.<ext>``

The ``logo_ext`` column on PlatformSetting / Organization records which
extension is currently active. Empty string = no custom logo.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, Tuple

# Mapping of accepted MIME types -> filesystem extension we store.
ALLOWED: dict[str, str] = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/gif": "gif",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
}

# Max upload size (2 MiB). Logos should be small.
MAX_BYTES = 2 * 1024 * 1024


def logos_dir() -> Path:
    """Resolve <repo>/data/logos/, creating it if missing."""
    here = Path(__file__).resolve()
    # .../webapp/backend/app/services/branding.py -> repo root is parents[4]
    repo_root = here.parents[4]
    d = repo_root / "data" / "logos"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _content_type_for(ext: str) -> str:
    return {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "svg": "image/svg+xml",
        "gif": "image/gif",
        "ico": "image/x-icon",
    }.get(ext.lower(), "application/octet-stream")


def _ext_for_content_type(content_type: str) -> Optional[str]:
    if not content_type:
        return None
    return ALLOWED.get(content_type.split(";", 1)[0].strip().lower())


def save_logo(stem: str, content_type: str, data: bytes) -> str:
    """Persist a logo, removing any prior file with the same stem.

    Returns the new extension on success. Raises ValueError on validation
    failure (bad MIME type or too large).
    """
    ext = _ext_for_content_type(content_type)
    if not ext:
        raise ValueError(
            "Unsupported image type. Allowed: PNG, JPEG, WebP, SVG, GIF, ICO."
        )
    if len(data) > MAX_BYTES:
        raise ValueError(f"Logo too large (max {MAX_BYTES // 1024} KiB).")

    d = logos_dir()
    # Remove any prior file for this stem regardless of extension.
    for old in d.glob(f"{stem}.*"):
        try:
            old.unlink()
        except OSError:
            pass
    target = d / f"{stem}.{ext}"
    target.write_bytes(data)
    return ext


def delete_logo(stem: str) -> None:
    d = logos_dir()
    for old in d.glob(f"{stem}.*"):
        try:
            old.unlink()
        except OSError:
            pass


def find_logo(stem: str, ext: str) -> Optional[Tuple[Path, str]]:
    """Locate a logo file for the given stem/ext, returning (path, mime).

    Falls back to any file matching ``stem.*`` if the recorded extension is
    missing (handles old uploads / hand-replaced files).
    """
    if not ext:
        return None
    d = logos_dir()
    p = d / f"{stem}.{ext}"
    if p.is_file():
        return p, _content_type_for(ext)
    # Fall back to any file matching the stem.
    for candidate in d.glob(f"{stem}.*"):
        return candidate, _content_type_for(candidate.suffix.lstrip("."))
    return None
