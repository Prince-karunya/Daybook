from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, Field


class PeriodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    day_order: int
    cohort: str
    period_number: int
    duration_hours: int
    subject: str
    class_name: str
    teacher_name: str
    room: str


class PeriodCreate(BaseModel):
    cohort: str = Field(pattern=r"^(AMCA|NMCA)$")
    period_number: int = Field(ge=1, le=6)
    duration_hours: int = Field(default=1, ge=1, le=6)
    subject: str = Field(min_length=1, max_length=100)
    class_name: str = Field(min_length=1, max_length=100)
    teacher_name: str = Field(min_length=1, max_length=100)
    room: str = Field(min_length=1, max_length=40)


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: str
    group_name: str
    phone: str
    is_active: bool
    phone_verified: bool
    sms_consent: bool
    is_sample: bool


class PersonCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    role: str = Field(pattern=r"^(Student|Teacher)$")
    group_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")
    phone_verified: bool = False
    sms_consent: bool = False


class PersonUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    role: str = Field(pattern=r"^(Student|Teacher)$")
    group_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")


class PersonSmsStatus(BaseModel):
    phone_verified: bool
    sms_consent: bool


class SettingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    college_name: str
    current_day_order: int
    anchor_date: date
    anchor_day_order: int
    reminder_time: str
    reminder_enabled: bool


class SettingUpdate(BaseModel):
    college_name: str = Field(min_length=2, max_length=120)
    anchor_date: date
    anchor_day_order: int = Field(ge=1, le=6)
    reminder_time: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    reminder_enabled: bool


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    hod_name: str
    email: str


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=100)
    email: str = Field(
        min_length=3,
        max_length=254,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    )


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    day_order: int
    cohort: str
    audience: str
    recipient_count: int
    sent_count: int
    failed_count: int
    skipped_count: int
    delivery_note: str | None
    status: str
    student_message: str
    teacher_message: str
    created_at: datetime


class PreviewRequest(BaseModel):
    day_order: int = Field(ge=1, le=6)
    cohort: str = Field(pattern=r"^(AMCA|NMCA)$")


class CustomMessageRequest(BaseModel):
    audience: str = Field(pattern=r"^(students|faculty)$")
    cohort: str | None = Field(default=None, pattern=r"^(AMCA|NMCA)$")
    message: str = Field(min_length=1, max_length=1600)


class PreviewResult(BaseModel):
    message: MessageOut
    delivery_note: str
