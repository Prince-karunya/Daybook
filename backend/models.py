from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Period(Base):
    __tablename__ = "periods"

    id: Mapped[int] = mapped_column(primary_key=True)
    day_order: Mapped[int] = mapped_column(Integer, index=True)
    cohort: Mapped[str] = mapped_column(String(10), default="AMCA", index=True)
    period_number: Mapped[int] = mapped_column(Integer)
    duration_hours: Mapped[int] = mapped_column(Integer, default=1)
    start_time: Mapped[str] = mapped_column(String(5), default="")
    end_time: Mapped[str] = mapped_column(String(5), default="")
    subject: Mapped[str] = mapped_column(String(100))
    class_name: Mapped[str] = mapped_column(String(100))
    teacher_name: Mapped[str] = mapped_column(String(100))
    room: Mapped[str] = mapped_column(String(40))


class Person(Base):
    __tablename__ = "people"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20), index=True)
    group_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_opt_in: Mapped[bool] = mapped_column(Boolean, default=True)
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)


class AppSetting(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    college_name: Mapped[str] = mapped_column(String(120), default="Northfield College")
    current_day_order: Mapped[int] = mapped_column(Integer, default=3)
    anchor_date: Mapped[date] = mapped_column(Date, nullable=False)
    anchor_day_order: Mapped[int] = mapped_column(Integer, default=1)
    reminder_time: Mapped[str] = mapped_column(String(5), default="07:00")
    reminder_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    amca_lab_rotation_applied: Mapped[bool] = mapped_column(Boolean, default=False)


class HodUser(Base):
    __tablename__ = "hod_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    name: Mapped[str] = mapped_column(String(100), default="Department HOD")


class MessageLog(Base):
    __tablename__ = "message_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    day_order: Mapped[int] = mapped_column(Integer)
    cohort: Mapped[str] = mapped_column(String(10), default="AMCA")
    audience: Mapped[str] = mapped_column(String(30))
    recipient_count: Mapped[int] = mapped_column(Integer)
    sent_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    delivery_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="preview")
    subject: Mapped[str] = mapped_column(String(200), default="")
    student_message: Mapped[str] = mapped_column(Text)
    teacher_message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EmailAutomationRun(Base):
    __tablename__ = "email_automation_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    day_order: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default="sending")
    recipient_count: Mapped[int] = mapped_column(Integer, default=0)
    sent_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
