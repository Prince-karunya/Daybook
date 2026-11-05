from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import SmsAutomationRun

COLLEGE_TIMEZONE = ZoneInfo("Asia/Kolkata")


def automation_status(db: Session) -> dict:
    latest_run = db.scalar(
        select(SmsAutomationRun).order_by(SmsAutomationRun.run_date.desc()).limit(1)
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
            "skipped_count": latest_run.skipped_count,
        }
    return {
        "enabled": False,
        "daily_enabled": False,
        "configured": False,
        "ready": False,
        "custom_ready": False,
        "daily_ready": False,
        "sender_type": None,
        "time_zone": "Asia/Kolkata",
        "last_run": run_summary,
    }
