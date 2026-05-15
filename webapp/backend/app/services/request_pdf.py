"""Build a branded PDF document for an EmployeeRequest.

Extracted so it can be reused by both the org-scoped export endpoint, the
support-submission emails (as an attachment), and the global-admin export
endpoint.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models import EmployeeRequest, Organization, PlatformSetting, User


def _format_local(dt: datetime, tz_name: str) -> str:
    """Format a tz-aware UTC datetime in the platform's local time zone using
    a 12-hour clock, e.g. "June 1, 2026 \u00b7 3:14 PM EDT".

    Falls back to UTC if the configured zone is invalid.
    """
    if dt is None:
        return ""
    # SQLite drops tzinfo; treat naive values as UTC.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    try:
        from zoneinfo import ZoneInfo
        local = dt.astimezone(ZoneInfo(tz_name)) if tz_name else dt.astimezone(timezone.utc)
    except Exception:
        local = dt.astimezone(timezone.utc)
    # %-I is non-portable; build the hour manually for cross-platform safety.
    hour12 = local.hour % 12 or 12
    ampm = "AM" if local.hour < 12 else "PM"
    tz_abbr = local.strftime("%Z") or (tz_name or "UTC")
    return f"{local.strftime('%B %d, %Y')} \u00b7 {hour12}:{local.strftime('%M')} {ampm} {tz_abbr}"


def build_request_pdf(
    db: Session,
    org: Organization,
    row: EmployeeRequest,
    summary_lines: Iterable[str],
    submitter: Optional[User],
) -> bytes:
    """Render a branded letterhead-style PDF for `row` and return the bytes."""
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.platypus import (
        BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    )
    from app.services import branding as branding_svc
    from app.services.runtime import platform_timezone

    summary = list(summary_lines) or ["(no fields filled in)"]
    tz_name = platform_timezone(db)

    def _local_date(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        try:
            from zoneinfo import ZoneInfo
            return dt.astimezone(ZoneInfo(tz_name)) if tz_name else dt.astimezone(timezone.utc)
        except Exception:
            return dt.astimezone(timezone.utc)

    buf = io.BytesIO()
    page_w, page_h = LETTER
    margin = 0.75 * inch
    header_h = 1.0 * inch

    # Resolve logo (org first, fall back to platform).
    logo_path: Optional[str] = None
    if org.logo_ext:
        found = branding_svc.find_logo(f"org-{org.id}", org.logo_ext)
        if found:
            logo_path = str(found[0])
    if not logo_path:
        ps = db.query(PlatformSetting).first()
        if ps and ps.logo_ext:
            found = branding_svc.find_logo("platform", ps.logo_ext)
            if found:
                logo_path = str(found[0])

    styles = getSampleStyleSheet()
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, leading=15, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#0f172a"))
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=10, leading=14, textColor=colors.HexColor("#1f2937"))

    def _draw_header(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#0f172a"))
        canvas.setFont("Helvetica-Bold", 16)
        text_x = margin
        if logo_path:
            try:
                from reportlab.lib.utils import ImageReader
                img = ImageReader(logo_path)
                iw, ih = img.getSize()
                target_h = 0.55 * inch
                target_w = iw * (target_h / ih)
                canvas.drawImage(img, margin, page_h - margin - target_h + 6, width=target_w, height=target_h, mask="auto", preserveAspectRatio=True)
                text_x = margin + target_w + 12
            except Exception:
                pass
        canvas.drawString(text_x, page_h - margin - 8, org.name)
        canvas.setFont("Helvetica", 9)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(text_x, page_h - margin - 22, "IT / Onboarding Request")
        canvas.setFont("Helvetica-Bold", 11)
        canvas.setFillColor(colors.HexColor("#0f172a"))
        canvas.drawRightString(page_w - margin, page_h - margin - 8, f"Request #{row.id}")
        canvas.setFont("Helvetica", 9)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawRightString(page_w - margin, page_h - margin - 22, _local_date(row.created_at).strftime("%B %d, %Y"))
        canvas.setStrokeColor(colors.HexColor("#cbd5e1"))
        canvas.setLineWidth(0.75)
        canvas.line(margin, page_h - margin - 32, page_w - margin, page_h - margin - 32)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#94a3b8"))
        canvas.drawString(margin, 0.5 * inch, f"{org.name} \u00b7 Request #{row.id}")
        canvas.drawRightString(page_w - margin, 0.5 * inch, f"Page {doc.page}")
        canvas.restoreState()

    frame = Frame(margin, 0.75 * inch, page_w - 2 * margin, page_h - margin - header_h - 0.75 * inch, showBoundary=0)
    doc = BaseDocTemplate(buf, pagesize=LETTER, leftMargin=margin, rightMargin=margin, topMargin=margin, bottomMargin=margin, title=f"Request {row.id} - {org.name}")
    doc.addPageTemplates([PageTemplate(id="letterhead", frames=[frame], onPage=_draw_header)])

    story: list = []

    submitter_label = f"{submitter.full_name} <{submitter.email}>" if submitter else "Unknown"
    meta_rows = [
        ["Request type", row.request_type or ""],
        ["Subject", row.subject or ""],
        ["Status", (row.status.value if hasattr(row.status, "value") else str(row.status)).replace("_", " ").title()],
        ["Submitted", _format_local(row.created_at, tz_name)],
        ["Submitted by", submitter_label],
    ]
    mt = Table(meta_rows, colWidths=[1.5 * inch, page_w - 2 * margin - 1.5 * inch])
    mt.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#475569")),
        ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#0f172a")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#e2e8f0")),
    ]))
    story.append(mt)
    story.append(Spacer(1, 12))

    story.append(Paragraph("Request details", h2))
    # Color the prior-access decision tokens so reviewers can spot REMOVE vs
    # keep at a glance in the rendered PDF. Tokens come from _summary_lines
    # in api/v1/requests.py. reportlab's Paragraph accepts a small inline
    # markup subset including <font color="#xxxxxx">…</font>.
    _RED = "#dc2626"
    _GREEN = "#16a34a"
    _PRIOR_TAGS = (
        ("[REMOVE PREVIOUS ACCESS]", _RED),
        ("[REMOVE]", _RED),
        ("[keep previous]", _GREEN),
        ("[keep prior]", _GREEN),
    )

    def _colorize_tags(s: str) -> str:
        out = s
        for token, color in _PRIOR_TAGS:
            out = out.replace(
                token,
                f'<font color="{color}"><b>{token}</b></font>',
            )
        return out

    sum_rows = []
    for ln in summary:
        if ": " in ln:
            label, _, value = ln.partition(": ")
        else:
            label, value = ln, ""
        sum_rows.append([
            Paragraph(f"<b>{label}</b>", body),
            Paragraph(_colorize_tags(value) or "&nbsp;", body),
        ])
    if sum_rows:
        st = Table(sum_rows, colWidths=[2.0 * inch, page_w - 2 * margin - 2.0 * inch])
        st.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#e2e8f0")),
        ]))
        story.append(st)

    if row.support_message:
        story.append(Spacer(1, 14))
        story.append(Paragraph("Message to support", h2))
        for para in str(row.support_message).split("\n\n"):
            story.append(Paragraph(para.replace("\n", "<br/>"), body))
            story.append(Spacer(1, 4))

    # Internal notes are intentionally NOT rendered in the PDF: the PDF is
    # shared with support recipients and the submitter, while notes are an
    # in-app reviewer-only field.

    doc.build(story)
    pdf = buf.getvalue()
    buf.close()
    return pdf


def pdf_filename_for(row: EmployeeRequest) -> str:
    """Default filename used for both download Content-Disposition and email attachment."""
    from datetime import datetime
    return f"request-{row.id}-{datetime.utcnow().strftime('%Y%m%d')}.pdf"
