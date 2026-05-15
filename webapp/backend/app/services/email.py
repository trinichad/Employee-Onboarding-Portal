from __future__ import annotations

import base64
import json
import smtplib
import urllib.error
import urllib.request
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Optional, Sequence, Tuple

from app.core.config import settings

# An attachment is a tuple (filename, mimetype, content_bytes). e.g.
# ("request-42.pdf", "application/pdf", b"...")
EmailAttachment = Tuple[str, str, bytes]


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
    attachments: Optional[Sequence[EmailAttachment]] = None,
    html_body: Optional[str] = None,
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
    if html_body:
        payload["html_body"] = html_body
    if attachments:
        payload["attachments"] = [
            {
                "filename": filename,
                "fileblob": base64.b64encode(content).decode("ascii"),
                "mimetype": mimetype or "application/octet-stream",
            }
            for (filename, mimetype, content) in attachments
        ]
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
    attachments: Optional[Sequence[EmailAttachment]] = None,
    html_body: Optional[str] = None,
) -> None:
    """Send via SMTP if configured; otherwise print to stdout (dev mode).

    By default failures are logged but not raised so user-facing flows aren't
    interrupted. Pass raise_on_error=True (e.g. from the SMTP test endpoint)
    to surface the underlying exception.
    """
    cfg = smtp or resolve_default_smtp()
    sender = _format_from(from_addr, from_name)
    attach_summary = (
        " [+" + ", ".join(f"{n} ({len(c)} bytes)" for (n, _m, c) in attachments) + "]"
        if attachments else ""
    )
    if not cfg.usable:
        print(
            f"\n--- DEV EMAIL ---\nFrom: {sender}\nTo: {to}\nSubject: {subject}{attach_summary}\n\n{body}\n-----------------\n",
            flush=True,
        )
        return
    # HTTP API transport (SMTP2GO) — sidesteps SMTP entirely.
    if (cfg.security or "").lower() == "http_api":
        # SMTP2GO requires a bare email in `sender`, not "Name <addr>".
        bare_sender = parseaddr(sender)[1] or sender
        try:
            _send_via_smtp2go_api(
                cfg, to=to, subject=subject, body=body, sender=bare_sender,
                attachments=attachments, html_body=html_body,
            )
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
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    for filename, mimetype, content in attachments or ():
        maintype, _, subtype = (mimetype or "application/octet-stream").partition("/")
        msg.add_attachment(content, maintype=maintype or "application", subtype=subtype or "octet-stream", filename=filename)
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


def _html_escape(s: str) -> str:
    import html as _html
    return _html.escape(s or "", quote=True)


# Shared inline styles for transactional emails. Email clients require inline
# CSS, so each tag carries its own `style=` attribute.
_EMAIL_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
_COL_TEXT = "#0f172a"
_COL_MUTED = "#64748b"
_COL_BORDER = "#e2e8f0"
_COL_BG = "#f8fafc"
_COL_ACCENT = "#2563eb"
_COL_WARN_BG = "#fef3c7"
_COL_WARN_BORDER = "#f59e0b"
_COL_WARN_TEXT = "#92400e"


def _html_shell(*, title: str, inner: str) -> str:
    """Wrap inner HTML in an email-safe centered card layout."""
    return f"""<!doctype html>
<html><head><meta charset=\"utf-8\"><title>{_html_escape(title)}</title></head>
<body style=\"margin:0;padding:24px;background:{_COL_BG};font-family:{_EMAIL_FONT};color:{_COL_TEXT};\">
  <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"max-width:640px;margin:0 auto;background:#ffffff;border:1px solid {_COL_BORDER};border-radius:8px;\">
    <tr><td style=\"padding:24px 28px;\">{inner}</td></tr>
  </table>
  <div style=\"max-width:640px;margin:12px auto 0;font-family:{_EMAIL_FONT};color:{_COL_MUTED};font-size:12px;text-align:center;\">
    Sent by the Employee Onboarding Portal
  </div>
</body></html>"""


def _summary_table_html(payload_text: str) -> str:
    """Render lines of `Label: value` into a two-column table."""
    # Color tokens emitted by _summary_lines for prior-access decisions.
    # We map each token to a colored span AFTER html-escaping the value so
    # user content stays safe but the tags pop visually for reviewers.
    _RED = "#dc2626"
    _GREEN = "#16a34a"
    _TAG_STYLES = {
        "[REMOVE PREVIOUS ACCESS]": _RED,
        "[REMOVE]": _RED,
        "[keep previous]": _GREEN,
        "[keep prior]": _GREEN,
    }

    def _colorize(escaped: str) -> str:
        out = escaped
        for token, color in _TAG_STYLES.items():
            out = out.replace(
                token,
                f"<span style=\"color:{color};font-weight:700;\">{token}</span>",
            )
        return out

    rows_html: list[str] = []
    for ln in (payload_text or "").splitlines():
        if not ln.strip():
            continue
        if ": " in ln:
            label, _, value = ln.partition(": ")
        else:
            label, value = ln, ""
        rows_html.append(
            f"<tr>"
            f"<td style=\"padding:8px 12px;border-bottom:1px solid {_COL_BORDER};color:{_COL_MUTED};font-size:13px;font-weight:600;vertical-align:top;width:38%;\">{_html_escape(label)}</td>"
            f"<td style=\"padding:8px 12px;border-bottom:1px solid {_COL_BORDER};color:{_COL_TEXT};font-size:13px;vertical-align:top;\">{_colorize(_html_escape(value)) or '&nbsp;'}</td>"
            f"</tr>"
        )
    if not rows_html:
        return f"<p style=\"color:{_COL_MUTED};font-size:13px;\">(no fields filled in)</p>"
    return (
        f"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
        f"style=\"border-collapse:collapse;border:1px solid {_COL_BORDER};border-radius:6px;overflow:hidden;\">"
        + "".join(rows_html)
        + "</table>"
    )


def invite_email(to: str, org_name: Optional[str], invite_url: str,
                 from_addr: Optional[str] = None, from_name: Optional[str] = None,
                 smtp: Optional[SmtpConfig] = None,
                 raise_on_error: bool = False) -> None:
    org = f" to {org_name}" if org_name else ""
    text = (
        f"You've been invited{org} on the Employee Onboarding Portal.\n\n"
        f"Click the link below to set your password and activate your account:\n{invite_url}\n\n"
        f"This link expires in 7 days."
    )
    html = _html_shell(
        title=f"You've been invited{org}",
        inner=(
            f"<h1 style=\"margin:0 0 12px;font-size:20px;color:{_COL_TEXT};\">You've been invited{_html_escape(org)}</h1>"
            f"<p style=\"margin:0 0 16px;font-size:14px;line-height:1.5;\">You've been invited to the Employee Onboarding Portal. Click the button below to set your password and activate your account.</p>"
            f"<p style=\"margin:16px 0;\"><a href=\"{_html_escape(invite_url)}\" style=\"display:inline-block;background:{_COL_ACCENT};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;\">Activate your account</a></p>"
            f"<p style=\"margin:16px 0 0;font-size:12px;color:{_COL_MUTED};\">Or paste this link into your browser:<br><span style=\"word-break:break-all;\">{_html_escape(invite_url)}</span></p>"
            f"<p style=\"margin:12px 0 0;font-size:12px;color:{_COL_MUTED};\">This link expires in 7 days.</p>"
        ),
    )
    send_email(
        to=to,
        subject=f"You've been invited{org}",
        body=text,
        html_body=html,
        from_addr=from_addr,
        from_name=from_name,
        smtp=smtp,
        raise_on_error=raise_on_error,
    )


def reset_email(to: str, reset_url: str,
                from_addr: Optional[str] = None, from_name: Optional[str] = None,
                smtp: Optional[SmtpConfig] = None,
                raise_on_error: bool = False) -> None:
    text = (
        f"A password reset was requested for your account.\n\n"
        f"Click the link below to choose a new password:\n{reset_url}\n\n"
        f"If you didn't request this, you can ignore this email. The link expires in 1 hour."
    )
    html = _html_shell(
        title="Password reset",
        inner=(
            f"<h1 style=\"margin:0 0 12px;font-size:20px;color:{_COL_TEXT};\">Password reset</h1>"
            f"<p style=\"margin:0 0 16px;font-size:14px;line-height:1.5;\">A password reset was requested for your account. Click the button below to choose a new password.</p>"
            f"<p style=\"margin:16px 0;\"><a href=\"{_html_escape(reset_url)}\" style=\"display:inline-block;background:{_COL_ACCENT};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;\">Choose a new password</a></p>"
            f"<p style=\"margin:16px 0 0;font-size:12px;color:{_COL_MUTED};\">If you didn't request this, you can ignore this email. The link expires in 1 hour.</p>"
        ),
    )
    send_email(
        to=to,
        subject="Password reset",
        body=text,
        html_body=html,
        from_addr=from_addr,
        from_name=from_name,
        smtp=smtp,
        raise_on_error=raise_on_error,
    )


def approval_request_email(to: str, org_name: str, request_id: int, subject: str, submitter: str, link: str,
                           from_addr: Optional[str] = None, from_name: Optional[str] = None,
                           smtp: Optional[SmtpConfig] = None) -> None:
    text = (
        f"A new employee request has been submitted and is awaiting approval.\n\n"
        f"Request: #{request_id} — {subject}\n"
        f"Submitted by: {submitter}\n\n"
        f"Review and approve here:\n{link}\n"
    )
    html = _html_shell(
        title=f"Request #{request_id} awaiting approval",
        inner=(
            f"<div style=\"font-size:12px;color:{_COL_MUTED};letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px;\">{_html_escape(org_name)}</div>"
            f"<h1 style=\"margin:0 0 8px;font-size:20px;color:{_COL_TEXT};\">Request awaiting approval</h1>"
            f"<p style=\"margin:0 0 16px;font-size:14px;line-height:1.5;\">A new employee request has been submitted and is awaiting your approval.</p>"
            f"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"border-collapse:collapse;border:1px solid {_COL_BORDER};border-radius:6px;overflow:hidden;margin:0 0 16px;\">"
            f"<tr><td style=\"padding:8px 12px;border-bottom:1px solid {_COL_BORDER};color:{_COL_MUTED};font-size:13px;font-weight:600;width:38%;\">Request</td><td style=\"padding:8px 12px;border-bottom:1px solid {_COL_BORDER};font-size:13px;\">#{request_id} &mdash; {_html_escape(subject)}</td></tr>"
            f"<tr><td style=\"padding:8px 12px;color:{_COL_MUTED};font-size:13px;font-weight:600;\">Submitted by</td><td style=\"padding:8px 12px;font-size:13px;\">{_html_escape(submitter)}</td></tr>"
            f"</table>"
            f"<p style=\"margin:16px 0;\"><a href=\"{_html_escape(link)}\" style=\"display:inline-block;background:{_COL_ACCENT};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;\">Review &amp; approve</a></p>"
        ),
    )
    send_email(
        to=to,
        subject=f"[{org_name}] New employee request awaiting approval — #{request_id}",
        body=text,
        html_body=html,
        from_addr=from_addr,
        from_name=from_name,
        smtp=smtp,
    )


def approved_notification_email(to: str, org_name: str, request_id: int, subject: str, approver: str, link: str,
                                from_addr: Optional[str] = None, from_name: Optional[str] = None,
                                smtp: Optional[SmtpConfig] = None) -> None:
    text = (
        f"Your request has been approved and is ready to be sent to support.\n\n"
        f"Request: #{request_id} — {subject}\n"
        f"Approved by: {approver}\n\n"
        f"Open it here:\n{link}\n"
    )
    html = _html_shell(
        title=f"Request #{request_id} approved",
        inner=(
            f"<div style=\"font-size:12px;color:{_COL_MUTED};letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px;\">{_html_escape(org_name)}</div>"
            f"<h1 style=\"margin:0 0 8px;font-size:20px;color:{_COL_TEXT};\">Request approved &mdash; ready to send</h1>"
            f"<p style=\"margin:0 0 16px;font-size:14px;line-height:1.5;\">Your request has been approved and is ready to be sent to support.</p>"
            f"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"border-collapse:collapse;border:1px solid {_COL_BORDER};border-radius:6px;overflow:hidden;margin:0 0 16px;\">"
            f"<tr><td style=\"padding:8px 12px;border-bottom:1px solid {_COL_BORDER};color:{_COL_MUTED};font-size:13px;font-weight:600;width:38%;\">Request</td><td style=\"padding:8px 12px;border-bottom:1px solid {_COL_BORDER};font-size:13px;\">#{request_id} &mdash; {_html_escape(subject)}</td></tr>"
            f"<tr><td style=\"padding:8px 12px;color:{_COL_MUTED};font-size:13px;font-weight:600;\">Approved by</td><td style=\"padding:8px 12px;font-size:13px;\">{_html_escape(approver)}</td></tr>"
            f"</table>"
            f"<p style=\"margin:16px 0;\"><a href=\"{_html_escape(link)}\" style=\"display:inline-block;background:{_COL_ACCENT};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;\">Open request</a></p>"
        ),
    )
    send_email(
        to=to,
        subject=f"[{org_name}] Request #{request_id} approved — ready to send",
        body=text,
        html_body=html,
        from_addr=from_addr,
        from_name=from_name,
        smtp=smtp,
    )


def support_submission_email(to: str, org_name: str, request_id: int, subject: str, request_type: str,
                             submitter: str, payload_text: str, message: Optional[str],
                             from_addr: Optional[str] = None, from_name: Optional[str] = None,
                             smtp: Optional[SmtpConfig] = None,
                             *, is_resubmission: bool = False, revision: int = 1,
                             attachments: Optional[Sequence[EmailAttachment]] = None) -> None:
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
    rt_label_map = {
        "new hire": "New Hire Request",
        "rehire": "Rehire Request",
        "promotion": "Promotion Request",
        "termination": "Termination Request",
    }
    rt_key = (request_type or "").strip().lower()
    rt_label = rt_label_map.get(rt_key) or (f"{request_type.strip()} Request" if request_type and request_type.strip() else "Employee Request")

    # HTML version
    if is_resubmission:
        banner = (
            f"<div style=\"background:{_COL_WARN_BG};border-left:4px solid {_COL_WARN_BORDER};color:{_COL_WARN_TEXT};"
            f"padding:10px 14px;border-radius:4px;font-size:13px;margin:0 0 16px;\">"
            f"<strong>Updated version (revision {revision}).</strong> Please use this copy and disregard "
            f"the previously sent request."
            f"</div>"
        )
        heading = f"{_html_escape(rt_label)} &mdash; updated"
    else:
        banner = ""
        heading = _html_escape(rt_label)

    message_block = ""
    if message:
        msg_html = _html_escape(message).replace("\n", "<br>")
        message_block = (
            f"<h2 style=\"margin:20px 0 8px;font-size:14px;color:{_COL_TEXT};text-transform:uppercase;letter-spacing:0.04em;\">Message to support</h2>"
            f"<div style=\"background:{_COL_BG};border:1px solid {_COL_BORDER};border-radius:6px;padding:12px 14px;font-size:13px;line-height:1.5;\">{msg_html}</div>"
        )

    pdf_note = ""
    if attachments:
        pdf_note = (
            f"<p style=\"margin:16px 0 0;font-size:12px;color:{_COL_MUTED};\">A formatted PDF copy of this request is attached for your records.</p>"
        )

    inner = (
        f"<div style=\"font-size:12px;color:{_COL_MUTED};letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px;\">{_html_escape(org_name)}</div>"
        f"<h1 style=\"margin:0 0 4px;font-size:22px;color:{_COL_TEXT};\">{heading}</h1>"
        f"<div style=\"font-size:14px;color:{_COL_MUTED};margin:0 0 16px;\">Request #{request_id} &middot; {_html_escape(subject)}</div>"
        f"{banner}"
        f"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"border-collapse:collapse;border:1px solid {_COL_BORDER};border-radius:6px;overflow:hidden;margin:0 0 8px;\">"
        f"<tr><td style=\"padding:8px 12px;border-bottom:1px solid {_COL_BORDER};color:{_COL_MUTED};font-size:13px;font-weight:600;width:38%;\">Request</td><td style=\"padding:8px 12px;border-bottom:1px solid {_COL_BORDER};font-size:13px;\">#{request_id}</td></tr>"
        f"<tr><td style=\"padding:8px 12px;border-bottom:1px solid {_COL_BORDER};color:{_COL_MUTED};font-size:13px;font-weight:600;\">Type</td><td style=\"padding:8px 12px;border-bottom:1px solid {_COL_BORDER};font-size:13px;\">{_html_escape(rt_label)}</td></tr>"
        f"<tr><td style=\"padding:8px 12px;{'border-bottom:1px solid ' + _COL_BORDER + ';' if is_resubmission else ''}color:{_COL_MUTED};font-size:13px;font-weight:600;\">Submitter</td><td style=\"padding:8px 12px;{'border-bottom:1px solid ' + _COL_BORDER + ';' if is_resubmission else ''}font-size:13px;\">{_html_escape(submitter)}</td></tr>"
        + (f"<tr><td style=\"padding:8px 12px;color:{_COL_MUTED};font-size:13px;font-weight:600;\">Revision</td><td style=\"padding:8px 12px;font-size:13px;\">{revision}</td></tr>" if is_resubmission else "")
        + f"</table>"
        f"{message_block}"
        f"<h2 style=\"margin:20px 0 8px;font-size:14px;color:{_COL_TEXT};text-transform:uppercase;letter-spacing:0.04em;\">Request details</h2>"
        f"{_summary_table_html(payload_text)}"
        f"{pdf_note}"
    )
    html = _html_shell(title=f"{rt_label} #{request_id}", inner=inner)

    send_email(
        to=to,
        subject=f"{subj_prefix}[{org_name}] {rt_label} #{request_id} — {subject}",
        body="\n".join(body_lines),
        html_body=html,
        from_addr=from_addr,
        from_name=from_name,
        smtp=smtp,
        attachments=attachments,
    )
