from __future__ import annotations

import json
import smtplib
import urllib.error
import urllib.request
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Optional, Tuple

from app.core.config import settings


@dataclass
class SmtpConfig:
    """Resolved SMTP configuration used to actually send mail."""
    host: str = ""
    port: int = 0
    security: str = "starttls"   # none|starttls|ssl|http_api
    auth: str = "auto"           # none|auto|plain|login|cram_md5
    username: str = ""
    password: str = ""

    @property
    def usable(self) -> bool:
        if (self.security or "").lower() == "http_api":
            return bool(self.password)
        return bool(self.host)


def resolve_default_smtp() -> SmtpConfig:
    """Fallback SMTP config from env (backwards compatibility)."""
    return SmtpConfig(
        host=settings.SMTP_HOST or "",
        port=settings.SMTP_PORT or 0,
        security="starttls" if settings.SMTP_TLS else "none",
        auth="auto" if settings.SMTP_USERNAME else "none",
        username=settings.SMTP_USERNAME or "",
        password=settings.SMTP_PASSWORD or "",
    )


def _format_from(from_addr: Optional[str], from_name: Optional[str]) -> str:
    addr = (from_addr or settings.SMTP_FROM or "").strip()
    name = (from_name or "").strip()
    if name and addr:
        return formataddr((name, addr))
    return addr


def _do_auth(s: smtplib.SMTP, cfg: SmtpConfig) -> None:
    method = (cfg.auth or "").lower()
    if not cfg.username or method in ("", "none"):
        return
    # Make sure EHLO has been issued so the server has advertised AUTH;
    # otherwise SMTP2GO/Postfix reply "503 AUTH command used when not advertised"
    # and we'd silently proceed unauthenticated, hitting 550 at RCPT TO.
    s.ehlo_or_helo_if_needed()
    s.user = cfg.username
    s.password = cfg.password
    if method == "plain":
        s.auth("PLAIN", s.auth_plain)
    elif method == "login":
        s.auth("LOGIN", s.auth_login)
    elif method in ("cram_md5", "cram-md5", "crammd5"):
        s.auth("CRAM-MD5", s.auth_cram_md5)
    else:
        # "auto" — let smtplib pick the strongest method the server supports
        s.login(cfg.username, cfg.password)


def _open_smtp(cfg: SmtpConfig) -> smtplib.SMTP:
    security = (cfg.security or "").lower()
    port = cfg.port or (465 if security == "ssl" else 587 if security == "starttls" else 25)
    if security == "ssl":
        s = smtplib.SMTP_SSL(cfg.host, port, timeout=15)
        s.ehlo()
        return s
    s = smtplib.SMTP(cfg.host, port, timeout=15)
    s.ehlo()
    if security == "starttls":
        s.starttls()
        s.ehlo()
    return s


# ---------- SMTP2GO HTTP API transport ----------
# Uses stdlib urllib so we don't pull in a new dependency.

SMTP2GO_API_URL = "https://api.smtp2go.com/v3/email/send"


def _send_via_smtp2go_api(
    cfg: SmtpConfig,
    *,
    to: str,
    subject: str,
    body: str,
    sender: str,
) -> None:
    """Send a single message via SMTP2GO's HTTP API.

    Uses cfg.password as the api_key. Raises on any non-200 response or
    transport error so callers can surface the real reason.
    """
    if not cfg.password:
        raise RuntimeError("HTTP API selected but no API key is configured")
    payload = {
        "api_key": cfg.password,
        "to": [to],
        "sender": sender,
        "subject": subject,
        "text_body": body,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        SMTP2GO_API_URL,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            try:
                parsed = json.loads(raw.decode("utf-8") or "{}")
            except ValueError:
                parsed = {}
    except urllib.error.HTTPError as e:
        # SMTP2GO returns JSON with a useful "data.error" string even on 4xx.
        try:
            parsed = json.loads(e.read().decode("utf-8") or "{}")
        except Exception:  # noqa: BLE001
            parsed = {}
        err = (parsed.get("data") or {}).get("error") or e.reason or str(e)
        raise RuntimeError(f"SMTP2GO API HTTP {e.code}: {err}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"SMTP2GO API network error: {e.reason}") from e
    data_block = parsed.get("data") or {}
    succeeded = int(data_block.get("succeeded") or 0)
    failed = int(data_block.get("failed") or 0)
    if succeeded < 1 or failed > 0:
        err = data_block.get("error") or data_block.get("error_code") or "unknown"
        failures = data_block.get("failures") or []
        raise RuntimeError(
            f"SMTP2GO API rejected the message: {err}"
            + (f" — failures: {failures}" if failures else "")
        )


def _smtp2go_api_test(cfg: SmtpConfig) -> Tuple[bool, str]:
    """Lightweight check that the API key is valid by hitting a no-send endpoint.

    SMTP2GO's API doesn't have a true ping, but /v3/stats/email_history with no
    range returns 200 + {"success": true} when the key is valid, and 4xx with
    a JSON error otherwise.
    """
    if not cfg.password:
        return False, "No API key configured"
    payload = {"api_key": cfg.password}
    req = urllib.request.Request(
        "https://api.smtp2go.com/v3/stats/email_summary",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            parsed = json.loads(resp.read().decode("utf-8") or "{}")
        if parsed.get("data", {}).get("succeeded") is not None or parsed.get("data") is not None:
            return True, "SMTP2GO HTTP API key accepted"
        return False, f"Unexpected SMTP2GO response: {parsed}"
    except urllib.error.HTTPError as e:
        try:
            parsed = json.loads(e.read().decode("utf-8") or "{}")
            err = (parsed.get("data") or {}).get("error") or e.reason
        except Exception:  # noqa: BLE001
            err = e.reason
        return False, f"HTTP {e.code}: {err}"
    except urllib.error.URLError as e:
        return False, f"network error: {e.reason}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def send_email(
    *,
    to: str,
    subject: str,
    body: str,
    from_addr: Optional[str] = None,
    from_name: Optional[str] = None,
    smtp: Optional[SmtpConfig] = None,
    raise_on_error: bool = False,
) -> None:
    """Send via SMTP if configured; otherwise print to stdout (dev mode).

    By default failures are logged but not raised so user-facing flows aren't
    interrupted. Pass raise_on_error=True (e.g. from the SMTP test endpoint)
    to surface the underlying exception.
    """
    cfg = smtp or resolve_default_smtp()
    sender = _format_from(from_addr, from_name)
    if not cfg.usable:
        print(
            f"\n--- DEV EMAIL ---\nFrom: {sender}\nTo: {to}\nSubject: {subject}\n\n{body}\n-----------------\n",
            flush=True,
        )
        return
    # HTTP API transport (SMTP2GO) — sidesteps SMTP entirely.
    if (cfg.security or "").lower() == "http_api":
        # SMTP2GO requires a bare email in `sender`, not "Name <addr>".
        bare_sender = parseaddr(sender)[1] or sender
        try:
            _send_via_smtp2go_api(cfg, to=to, subject=subject, body=body, sender=bare_sender)
        except Exception as exc:
            print(f"[email] http_api failed: {exc}", flush=True)
            if raise_on_error:
                raise
        return
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with _open_smtp(cfg) as s:
            _do_auth(s, cfg)
            refused = s.send_message(msg)
            if refused:
                # Per smtplib, send_message returns a dict of recipients the
                # server refused. Treat that as an error.
                raise smtplib.SMTPRecipientsRefused(refused)
    except Exception as exc:
        print(f"[email] failed: {exc}", flush=True)
        if raise_on_error:
            raise


def smtp_test(cfg: SmtpConfig) -> Tuple[bool, str]:
    """Verify SMTP / HTTP API connectivity. Returns (ok, message)."""
    if (cfg.security or "").lower() == "http_api":
        return _smtp2go_api_test(cfg)
    if not cfg.usable:
        return False, "No SMTP host configured"
    try:
        with _open_smtp(cfg) as s:
            method = (cfg.auth or "").lower()
            if cfg.username and method not in ("", "none"):
                _do_auth(s, cfg)
                authed = "authenticated"
            elif cfg.username and method in ("", "none"):
                authed = "WARNING: username set but auth method is 'none' — server will refuse relay"
            else:
                authed = "no auth attempted (no username configured)"
            s.noop()
        return True, f"Connected to {cfg.host}:{cfg.port or '?'} ({authed})"
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}: {exc}"


def invite_email(to: str, org_name: Optional[str], invite_url: str,
                 from_addr: Optional[str] = None, from_name: Optional[str] = None,
                 smtp: Optional[SmtpConfig] = None,
                 raise_on_error: bool = False) -> None:
    org = f" to {org_name}" if org_name else ""
    send_email(
        to=to,
        subject=f"You've been invited{org}",
        body=(
            f"You've been invited{org} on the Employee Onboarding Portal.\n\n"
            f"Click the link below to set your password and activate your account:\n{invite_url}\n\n"
            f"This link expires in 7 days."
        ),
        from_addr=from_addr,
        from_name=from_name,
        smtp=smtp,
        raise_on_error=raise_on_error,
    )


def reset_email(to: str, reset_url: str,
                from_addr: Optional[str] = None, from_name: Optional[str] = None,
                smtp: Optional[SmtpConfig] = None,
                raise_on_error: bool = False) -> None:
    send_email(
        to=to,
        subject="Password reset",
        body=(
            f"A password reset was requested for your account.\n\n"
            f"Click the link below to choose a new password:\n{reset_url}\n\n"
            f"If you didn't request this, you can ignore this email. The link expires in 1 hour."
        ),
        from_addr=from_addr,
        from_name=from_name,
        smtp=smtp,
        raise_on_error=raise_on_error,
    )


def approval_request_email(to: str, org_name: str, request_id: int, subject: str, submitter: str, link: str,
                           from_addr: Optional[str] = None, from_name: Optional[str] = None,
                           smtp: Optional[SmtpConfig] = None) -> None:
    send_email(
        to=to,
        subject=f"[{org_name}] New employee request awaiting approval — #{request_id}",
        body=(
            f"A new employee request has been submitted and is awaiting approval.\n\n"
            f"Request: #{request_id} — {subject}\n"
            f"Submitted by: {submitter}\n\n"
            f"Review and approve here:\n{link}\n"
        ),
        from_addr=from_addr,
        from_name=from_name,
        smtp=smtp,
    )


def approved_notification_email(to: str, org_name: str, request_id: int, subject: str, approver: str, link: str,
                                from_addr: Optional[str] = None, from_name: Optional[str] = None,
                                smtp: Optional[SmtpConfig] = None) -> None:
    send_email(
        to=to,
        subject=f"[{org_name}] Request #{request_id} approved — ready to send",
        body=(
            f"Your request has been approved and is ready to be sent to support.\n\n"
            f"Request: #{request_id} — {subject}\n"
            f"Approved by: {approver}\n\n"
            f"Open it here:\n{link}\n"
        ),
        from_addr=from_addr,
        from_name=from_name,
        smtp=smtp,
    )


def support_submission_email(to: str, org_name: str, request_id: int, subject: str, request_type: str,
                             submitter: str, payload_text: str, message: Optional[str],
                             from_addr: Optional[str] = None, from_name: Optional[str] = None,
                             smtp: Optional[SmtpConfig] = None,
                             *, is_resubmission: bool = False, revision: int = 1) -> None:
    if is_resubmission:
        intro = (
            f"UPDATED employee setup request from {org_name}. "
            f"This is an edited version of a previously sent request — please use this version "
            f"and disregard prior copies."
        )
        subj_prefix = f"[UPDATED rev {revision}] "
    else:
        intro = f"New employee setup request from {org_name}."
        subj_prefix = ""
    body_lines = [
        intro,
        "",
        f"Request: #{request_id}",
        f"Submitter: {submitter}",
    ]
    if is_resubmission:
        body_lines.append(f"Revision: {revision}")
    if message:
        body_lines += ["", "--- Message to support ---", message]
    body_lines += [
        "",
        "--- Summary ---",
        payload_text,
    ]
    send_email(
        to=to,
        subject=f"{subj_prefix}[{org_name}] New Hire Request #{request_id} — {subject}",
        body="\n".join(body_lines),
        from_addr=from_addr,
        from_name=from_name,
        smtp=smtp,
    )
