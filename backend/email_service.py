import os
import smtplib
from email.message import EmailMessage
from typing import Iterable
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import EmailAutomationRun, Person

COLLEGE_TIMEZONE = ZoneInfo("Asia/Kolkata")
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
MAX_EMAILS_PER_SEND = 100


def sender_address() -> str | None:
    address = os.getenv("GMAIL_ADDRESS", "").strip()
    password = os.getenv("GMAIL_APP_PASSWORD", "").replace(" ", "")
    return address if address and password else None


def automation_status(db: Session) -> dict:
    latest_run = db.scalar(
        select(EmailAutomationRun)
        .order_by(EmailAutomationRun.run_date.desc())
        .limit(1)
    )
    run_summary = None
    if latest_run:
        run_summary = {
            "date": latest_run.run_date,
            "day_order": latest_run.day_order,
            "status": latest_run.status,
            "recipient_count": latest_run.recipient_count,
            "sent_count": latest_run.sent_count,
            "failed_count": latest_run.failed_count,
        }
    configured = sender_address() is not None
    daily_configured = configured and bool(os.getenv("CRON_SECRET"))
    return {
        "enabled": configured,
        "daily_enabled": daily_configured,
        "configured": configured,
        "ready": configured,
        "custom_ready": configured,
        "daily_ready": daily_configured,
        "sender_type": "gmail" if configured else None,
        "sender_address": os.getenv("GMAIL_ADDRESS", "").strip() if configured else None,
        "time_zone": "Asia/Kolkata",
        "last_run": run_summary,
    }


def send_emails(messages: Iterable[tuple[Person, str, str]]) -> tuple[int, int]:
    items = list(messages)
    if not items:
        return 0, 0
    if len(items) > MAX_EMAILS_PER_SEND:
        raise ValueError(f"A single send is limited to {MAX_EMAILS_PER_SEND} recipients.")

    address = os.getenv("GMAIL_ADDRESS", "").strip()
    password = os.getenv("GMAIL_APP_PASSWORD", "").replace(" ", "")
    if not address or not password:
        raise RuntimeError("Gmail is not configured. Set GMAIL_ADDRESS and GMAIL_APP_PASSWORD.")

    sent = 0
    failed = 0
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(address, password)
        for person, subject, body in items:
            message = EmailMessage()
            message["From"] = address
            message["To"] = person.email
            message["Subject"] = subject
            message.set_content(body)
            try:
                refused = server.send_message(message)
            except (smtplib.SMTPException, OSError):
                failed += 1
            else:
                if refused:
                    failed += 1
                else:
                    sent += 1
    return sent, failed
