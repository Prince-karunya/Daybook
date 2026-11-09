import hashlib
import hmac
import os
import secrets
import smtplib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from email.utils import parseaddr

from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import jwt
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .email_service import (
    COLLEGE_TIMEZONE,
    MAX_EMAILS_PER_SEND,
    automation_status,
    sender_address,
    send_emails,
)
from .models import AppSetting, EmailAutomationRun, HodUser, MessageLog, Period, Person
from .schemas import (
    BulkImportResult,
    BulkPersonImport,
    CustomMessageRequest,
    LoginRequest,
    LoginResponse,
    MessageOut,
    PeriodCreate,
    PeriodOut,
    PasswordChange,
    ProfileUpdate,
    PersonCreate,
    PersonOut,
    PersonUpdate,
    PreviewRequest,
    PreviewResult,
    SettingOut,
    SettingUpdate,
    TimetableSendRequest,
)

HOD_EMAIL = os.getenv("DAYBOOK_HOD_EMAIL", "hod@daybook.local").strip().lower()
HOD_PASSWORD = os.getenv("DAYBOOK_HOD_PASSWORD", "ChangeMe123!")
JWT_SECRET = os.getenv("DAYBOOK_SECRET_KEY", "local-development-secret-change-before-deploying")
JWT_ALGORITHM = "HS256"
bearer_scheme = HTTPBearer(auto_error=False)

TIMETABLE = [
    [("OR", 1), ("SI", 1), ("SE", 1), ("E-II", 1), ("DL", 1), ("E-I", 1)],
    [("E-II", 1), ("OR", 1), ("SE LAB", 4)],
    [("DL", 1), ("SI", 1), ("E-I", 1), ("IT", 1), ("OR", 1), ("IT", 1)],
    [("E-II", 1), ("SE", 1), ("IT LAB", 4)],
    [("E-I", 1), ("IT", 1), ("E-II", 1), ("SE", 1), ("DL", 1), ("CS/LIB", 1)],
    [("OR", 1), ("E-I", 1), ("DL LAB", 4)],
]
TEACHERS = [
    ["Dr. Meera Nair", "Prof. K. Iyer", "Dr. S. Kumar", "Ms. R. Thomas", "Dr. A. Bose", "Mr. P. Das"],
    ["Prof. K. Iyer", "Dr. V. Menon", "Ms. R. Thomas", "Dr. Meera Nair", "Dr. A. Bose", "Ms. J. Roy"],
    ["Dr. S. Kumar", "Dr. Meera Nair", "Prof. K. Iyer", "Dr. A. Bose", "Dr. V. Menon", "Mr. P. Das"],
    ["Ms. R. Thomas", "Dr. A. Bose", "Dr. V. Menon", "Dr. S. Kumar", "Prof. K. Iyer", "Dr. Meera Nair"],
    ["Dr. V. Menon", "Ms. R. Thomas", "Dr. Meera Nair", "Prof. K. Iyer", "Mr. P. Das", "Dr. S. Kumar"],
    ["Dr. A. Bose", "Dr. S. Kumar", "Ms. R. Thomas", "Dr. V. Menon", "Dr. Meera Nair", "Prof. K. Iyer"],
]
CLASSES = ["II BSc CS", "I BSc CS", "II BSc CS", "I BSc CS", "II BSc CS", "II BSc CS"]
ROOMS = ["Room 204", "Room 108", "Lab 2", "Room 305", "Room 112", "Lab 1"]
LEGACY_SUBJECTS = {
    "Data Structures", "Mathematics II", "Digital Logic", "English",
    "Physics", "Programming Lab", "Database Systems", "Library",
}
SAMPLE_PEOPLE = [
    ("Aditi Sharma", "Student", "AMCA", "student1@example.invalid"),
    ("Rohan Mehta", "Student", "NMCA", "student2@example.invalid"),
    ("Dr. Meera Nair", "Teacher", "Computer Science", "teacher1@example.invalid"),
    ("Prof. K. Iyer", "Teacher", "Mathematics", "teacher2@example.invalid"),
    ("Ananya Iqbal", "Student", "AMCA", "student3@example.invalid"),
    ("Dr. S. Kumar", "Teacher", "Computer Science", "teacher3@example.invalid"),
    ("Kavya Menon", "Student", "NMCA", "student4@example.invalid"),
    ("Ms. R. Thomas", "Teacher", "Languages", "teacher4@example.invalid"),
]
SAMPLE_NAMES = {name for name, _, _, _ in SAMPLE_PEOPLE}
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=64)
    return f"scrypt${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, salt_hex, digest_hex = stored_hash.split("$", 2)
        if algorithm != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt_hex),
            n=2**14,
            r=8,
            p=1,
            dklen=64,
        )
        return hmac.compare_digest(derived.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def make_access_token(user: HodUser) -> str:
    now = datetime.now(COLLEGE_TIMEZONE)
    return jwt.encode(
        {"sub": user.email, "iat": now, "exp": now + timedelta(hours=12)},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def require_hod(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> HodUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Sign in as the department HOD to continue.")
    try:
        claims = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        email = claims.get("sub")
        if not isinstance(email, str):
            raise jwt.InvalidTokenError("Missing subject")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Your session expired. Please sign in again.") from exc
    user = db.scalar(select(HodUser).where(HodUser.email == email))
    if user is None:
        raise HTTPException(status_code=401, detail="HOD account was not found.")
    return user


def current_day_order(setting: AppSetting) -> int:
    today = datetime.now(COLLEGE_TIMEZONE).date()
    days_since_anchor = (today - setting.anchor_date).days
    return (setting.anchor_day_order - 1 + days_since_anchor) % 6 + 1


def eligible_email_people(
    db: Session,
    role: str,
    cohort: str | None = None,
) -> list[Person]:
    query = select(Person).where(
        Person.role == role,
        Person.is_active.is_(True),
        Person.email_opt_in.is_(True),
        Person.is_sample.is_(False),
    )
    if cohort:
        query = query.where(Person.group_name == cohort)
    return [
        person
        for person in db.scalars(query.order_by(Person.name)).all()
        if person.email.lower().endswith((".invalid", ".local")) is False
        and parseaddr(person.email)[1].lower() == person.email.lower()
    ]


def seed_hod_account(db: Session) -> None:
    if os.getenv("DAYBOOK_ENV", "development").lower() == "production" and (
        HOD_PASSWORD == "ChangeMe123!"
        or JWT_SECRET == "local-development-secret-change-before-deploying"
    ):
        raise RuntimeError("Set DAYBOOK_HOD_PASSWORD and DAYBOOK_SECRET_KEY in production.")
    if db.scalar(select(HodUser.id).limit(1)) is None:
        db.add(
            HodUser(
                email=HOD_EMAIL,
                password_hash=hash_password(HOD_PASSWORD),
                name=os.getenv("DAYBOOK_HOD_NAME", "Department HOD"),
            )
        )


def seed_database() -> None:
    with SessionLocal() as db:
        periods = db.scalars(select(Period)).all()
        if periods and len(periods) == 36 and all(
            period.subject in LEGACY_SUBJECTS for period in periods
        ):
            for period in periods:
                db.delete(period)
            periods = []
        if not periods:
            for order, entries in enumerate(TIMETABLE, start=1):
                hour = 1
                for subject, duration_hours in entries:
                    index = hour - 1
                    for cohort in ("AMCA", "NMCA"):
                        db.add(
                            Period(
                                day_order=order,
                                cohort=cohort,
                                period_number=hour,
                                duration_hours=duration_hours,
                                start_time="",
                                end_time="",
                                subject=subject,
                                class_name=cohort,
                                teacher_name=TEACHERS[order - 1][min(index, 5)],
                                room=ROOMS[(index + order - 1) % len(ROOMS)],
                            )
                        )
                    hour += duration_hours
        elif db.scalar(select(Period.id).where(Period.cohort == "NMCA").limit(1)) is None:
            for entry in periods:
                db.add(
                    Period(
                        day_order=entry.day_order,
                        cohort="NMCA",
                        period_number=entry.period_number,
                        duration_hours=entry.duration_hours,
                        start_time=entry.start_time,
                        end_time=entry.end_time,
                        subject=entry.subject,
                        class_name="NMCA",
                        teacher_name=entry.teacher_name,
                        room=entry.room,
                    )
                )
            for entry in periods:
                entry.class_name = "AMCA"
        if not db.scalar(select(Person.id).limit(1)):
            for name, role, group_name, email in SAMPLE_PEOPLE:
                db.add(
                    Person(
                        name=name,
                        role=role,
                        group_name=group_name,
                        email=email,
                        is_active=True,
                        email_opt_in=False,
                        is_sample=True,
                    )
                )
        else:
            sample_cohorts = {
                "Aditi Sharma": "AMCA",
                "Rohan Mehta": "NMCA",
                "Ananya Iqbal": "AMCA",
                "Kavya Menon": "NMCA",
            }
            for person in db.scalars(select(Person)).all():
                if person.name in sample_cohorts:
                    person.group_name = sample_cohorts[person.name]
        for sample in db.scalars(select(Person).where(Person.name.in_(SAMPLE_NAMES))).all():
            sample.is_sample = True
            sample.email_opt_in = False
        settings = db.scalar(select(AppSetting).limit(1))
        if settings is None:
            settings = AppSetting(
                anchor_date=datetime.now(COLLEGE_TIMEZONE).date(),
                anchor_day_order=1,
            )
            db.add(settings)
        seed_hod_account(db)
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    columns = {column["name"] for column in inspect(engine).get_columns("periods")}
    if "duration_hours" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE periods ADD COLUMN duration_hours INTEGER NOT NULL DEFAULT 1"))
    if "cohort" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE periods ADD COLUMN cohort VARCHAR(10) NOT NULL DEFAULT 'AMCA'"))
    settings_columns = {column["name"] for column in inspect(engine).get_columns("settings")}
    if "anchor_date" not in settings_columns:
        today = datetime.now(COLLEGE_TIMEZONE).date().isoformat()
        with engine.begin() as connection:
            connection.execute(
                text(f"ALTER TABLE settings ADD COLUMN anchor_date DATE NOT NULL DEFAULT '{today}'")
            )
    if "anchor_day_order" not in settings_columns:
        with engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE settings ADD COLUMN anchor_day_order INTEGER NOT NULL DEFAULT 1")
            )
    message_columns = {column["name"] for column in inspect(engine).get_columns("message_logs")}
    if "cohort" not in message_columns:
        with engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE message_logs ADD COLUMN cohort VARCHAR(10) NOT NULL DEFAULT 'AMCA'")
            )
    for column, definition in (
        ("sent_count", "INTEGER NOT NULL DEFAULT 0"),
        ("failed_count", "INTEGER NOT NULL DEFAULT 0"),
        ("skipped_count", "INTEGER NOT NULL DEFAULT 0"),
        ("delivery_note", "TEXT"),
        ("subject", "VARCHAR(200) NOT NULL DEFAULT ''"),
    ):
        if column not in message_columns:
            with engine.begin() as connection:
                connection.execute(text(f"ALTER TABLE message_logs ADD COLUMN {column} {definition}"))
            message_columns.add(column)
    people_columns = {column["name"] for column in inspect(engine).get_columns("people")}
    if "email" not in people_columns and "phone" in people_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE people RENAME COLUMN phone TO email"))
            if engine.dialect.name == "postgresql":
                connection.execute(text("ALTER TABLE people ALTER COLUMN email TYPE VARCHAR(254)"))
            connection.execute(
                text("UPDATE people SET email = 'legacy-' || id || '@example.invalid'")
            )
        people_columns.remove("phone")
        people_columns.add("email")
    elif "email" not in people_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE people ADD COLUMN email VARCHAR(254)"))
    if "is_sample" not in people_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE people ADD COLUMN is_sample BOOLEAN NOT NULL DEFAULT FALSE"))
    if "email_opt_in" not in people_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE people ADD COLUMN email_opt_in BOOLEAN NOT NULL DEFAULT FALSE"))
    seed_database()
    yield


app = FastAPI(title="Daybook College API", version="1.0.0", lifespan=lifespan)
cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "DAYBOOK_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(HodUser).where(HodUser.email == payload.email.strip().lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid HOD email or password.")
    return LoginResponse(
        access_token=make_access_token(user),
        hod_name=user.name,
        email=user.email,
    )


api = APIRouter(prefix="/api", dependencies=[Depends(require_hod)])


@api.get("/auth/me")
def get_current_user(user: HodUser = Depends(require_hod)):
    return {"name": user.name, "email": user.email, "role": "HOD"}


@api.put("/auth/profile", response_model=LoginResponse)
def update_profile(
    payload: ProfileUpdate,
    user: HodUser = Depends(require_hod),
    db: Session = Depends(get_db),
):
    user.name = payload.name.strip()
    user.email = payload.email.strip().lower()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That sign-in email is already in use.") from exc
    db.refresh(user)
    return LoginResponse(
        access_token=make_access_token(user),
        hod_name=user.name,
        email=user.email,
    )


@api.post("/auth/change-password", status_code=204)
def change_password(
    payload: PasswordChange,
    user: HodUser = Depends(require_hod),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return None


@api.get("/day-orders/{day_order}", response_model=list[PeriodOut])
def get_day_order(
    day_order: int,
    cohort: str = Query(default="AMCA", pattern=r"^(AMCA|NMCA)$"),
    db: Session = Depends(get_db),
):
    if not 1 <= day_order <= 6:
        raise HTTPException(status_code=404, detail="Day order must be between 1 and 6.")
    return db.scalars(
        select(Period)
        .where(Period.day_order == day_order, Period.cohort == cohort)
        .order_by(Period.period_number)
    ).all()


@api.post("/day-orders/{day_order}/periods", response_model=PeriodOut, status_code=201)
def add_period(day_order: int, payload: PeriodCreate, db: Session = Depends(get_db)):
    if not 1 <= day_order <= 6:
        raise HTTPException(status_code=404, detail="Day order must be between 1 and 6.")
    final_hour = payload.period_number + payload.duration_hours - 1
    if final_hour > 6:
        raise HTTPException(status_code=422, detail="A period cannot extend beyond hour 6.")
    existing_periods = db.scalars(
        select(Period).where(Period.day_order == day_order, Period.cohort == payload.cohort)
    ).all()
    overlaps = any(
        existing.period_number <= final_hour
        and existing.period_number + existing.duration_hours - 1 >= payload.period_number
        for existing in existing_periods
    )
    if overlaps:
        raise HTTPException(status_code=409, detail="That hour overlaps an existing class or lab.")
    period = Period(day_order=day_order, **payload.model_dump())
    db.add(period)
    db.commit()
    db.refresh(period)
    return period


@api.put("/day-orders/{day_order}/periods/{period_id}", response_model=PeriodOut)
def update_period(
    day_order: int,
    period_id: int,
    payload: PeriodCreate,
    db: Session = Depends(get_db),
):
    period = db.scalar(
        select(Period).where(Period.id == period_id, Period.day_order == day_order)
    )
    if period is None:
        raise HTTPException(status_code=404, detail="Timetable entry was not found.")
    final_hour = payload.period_number + payload.duration_hours - 1
    if final_hour > 6:
        raise HTTPException(status_code=422, detail="A period cannot extend beyond hour 6.")
    existing_periods = db.scalars(
        select(Period).where(
            Period.day_order == day_order,
            Period.cohort == payload.cohort,
            Period.id != period_id,
        )
    ).all()
    overlaps = any(
        existing.period_number <= final_hour
        and existing.period_number + existing.duration_hours - 1 >= payload.period_number
        for existing in existing_periods
    )
    if overlaps:
        raise HTTPException(status_code=409, detail="That hour overlaps an existing class or lab.")
    for key, value in payload.model_dump().items():
        setattr(period, key, value)
    db.commit()
    db.refresh(period)
    return period


@api.delete("/day-orders/{day_order}/periods/{period_id}", status_code=204)
def delete_period(day_order: int, period_id: int, db: Session = Depends(get_db)):
    period = db.scalar(
        select(Period).where(Period.id == period_id, Period.day_order == day_order)
    )
    if period is None:
        raise HTTPException(status_code=404, detail="Timetable entry was not found.")
    db.delete(period)
    db.commit()
    return None


@api.get("/people", response_model=list[PersonOut])
def list_people(
    role: str | None = Query(default=None, pattern=r"^(Student|Teacher)$"),
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = select(Person).where(Person.is_active.is_(True)).order_by(Person.name)
    if role:
        query = query.where(Person.role == role)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(
            Person.name.ilike(pattern)
            | Person.group_name.ilike(pattern)
            | Person.email.ilike(pattern)
        )
    return db.scalars(query).all()


@api.post("/people", response_model=PersonOut, status_code=201)
def add_person(payload: PersonCreate, db: Session = Depends(get_db)):
    person = Person(**payload.model_dump(), is_active=True)
    person.email = person.email.strip().lower()
    db.add(person)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That email address is already registered.") from exc
    db.refresh(person)
    return person


@api.post("/people/bulk-import", response_model=BulkImportResult)
def bulk_import_people(payload: BulkPersonImport, db: Session = Depends(get_db)):
    seen: set[str] = set()
    created = 0
    updated = 0
    skipped = 0
    for contact in payload.contacts:
        email = contact.email.strip().lower()
        if email in seen:
            skipped += 1
            continue
        seen.add(email)
        person = db.scalar(select(Person).where(func.lower(Person.email) == email))
        if person is None:
            db.add(Person(**{**contact.model_dump(), "email": email, "email_opt_in": True}, is_active=True))
            created += 1
            continue
        previous_name = person.name
        previous_role = person.role
        person.name = contact.name.strip()
        person.role = contact.role
        person.group_name = contact.group_name.strip()
        person.email_opt_in = True
        person.is_active = True
        person.is_sample = False
        if previous_role == "Teacher" and (previous_name != person.name or person.role != "Teacher"):
            db.query(Period).filter(Period.teacher_name == previous_name).update(
                {Period.teacher_name: person.name if person.role == "Teacher" else "Unassigned"},
                synchronize_session=False,
            )
        updated += 1
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="The roster could not be imported because email addresses must be unique.") from exc
    return BulkImportResult(created=created, updated=updated, skipped=skipped)


@api.put("/people/{person_id}", response_model=PersonOut)
def update_person(person_id: int, payload: PersonUpdate, db: Session = Depends(get_db)):
    person = db.get(Person, person_id)
    if person is None or not person.is_active:
        raise HTTPException(status_code=404, detail="Active contact was not found.")
    previous_name = person.name
    previous_role = person.role
    for key, value in payload.model_dump().items():
        setattr(person, key, value.strip().lower() if key == "email" else value)
    if previous_role == "Teacher" and (previous_name != person.name or person.role != "Teacher"):
        db.query(Period).filter(Period.teacher_name == previous_name).update(
            {Period.teacher_name: person.name if person.role == "Teacher" else "Unassigned"},
            synchronize_session=False,
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That email address is already registered.") from exc
    db.refresh(person)
    return person


@api.delete("/people/{person_id}", status_code=204)
def delete_person(person_id: int, db: Session = Depends(get_db)):
    person = db.get(Person, person_id)
    if person is None or not person.is_active:
        raise HTTPException(status_code=404, detail="Active contact was not found.")
    if person.role == "Teacher":
        db.query(Period).filter(Period.teacher_name == person.name).update(
            {Period.teacher_name: "Unassigned"}, synchronize_session=False
        )
    person.is_active = False
    person.email_opt_in = False
    db.commit()
    return None


@api.get("/settings", response_model=SettingOut)
def get_settings(db: Session = Depends(get_db)):
    setting = db.scalar(select(AppSetting).limit(1))
    if setting is None:
        raise HTTPException(status_code=500, detail="Application settings have not been initialized.")
    return {
        "college_name": setting.college_name,
        "current_day_order": current_day_order(setting),
        "anchor_date": setting.anchor_date,
        "anchor_day_order": setting.anchor_day_order,
        "reminder_time": setting.reminder_time,
        "reminder_enabled": setting.reminder_enabled,
    }


@api.put("/settings", response_model=SettingOut)
def update_settings(payload: SettingUpdate, db: Session = Depends(get_db)):
    setting = db.scalar(select(AppSetting).limit(1))
    if setting is None:
        setting = AppSetting(anchor_date=payload.anchor_date)
        db.add(setting)
    for key, value in payload.model_dump().items():
        setattr(setting, key, value)
    db.commit()
    db.refresh(setting)
    return {
        "college_name": setting.college_name,
        "current_day_order": current_day_order(setting),
        "anchor_date": setting.anchor_date,
        "anchor_day_order": setting.anchor_day_order,
        "reminder_time": setting.reminder_time,
        "reminder_enabled": setting.reminder_enabled,
    }


@api.get("/messages", response_model=list[MessageOut])
def list_messages(db: Session = Depends(get_db)):
    return db.scalars(select(MessageLog).order_by(MessageLog.created_at.desc()).limit(30)).all()


@api.get("/messages/automation")
def get_email_automation_status(db: Session = Depends(get_db)):
    return automation_status(db)


@api.post("/messages/custom", response_model=MessageOut, status_code=201)
def send_custom_message(payload: CustomMessageRequest, db: Session = Depends(get_db)):
    if sender_address() is None:
        raise HTTPException(status_code=503, detail="Gmail sending is not configured.")
    if payload.audience == "students" and payload.cohort is None:
        raise HTTPException(status_code=422, detail="Select a student cohort.")
    recipients = eligible_email_people(
        db,
        "Student" if payload.audience == "students" else "Teacher",
        payload.cohort if payload.audience == "students" else None,
    )
    if len(recipients) > MAX_EMAILS_PER_SEND:
        raise HTTPException(status_code=413, detail=f"Limit each email send to {MAX_EMAILS_PER_SEND} recipients.")
    sent = 0
    failed = 0
    if recipients:
        try:
            sent, failed = send_emails(
                (person, payload.subject, payload.message)
                for person in recipients
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise HTTPException(status_code=502, detail="Gmail could not complete the send. Check Gmail App Password and SMTP access.") from exc
    setting = db.scalar(select(AppSetting).limit(1))
    log = MessageLog(
        day_order=current_day_order(setting) if setting else 1,
        cohort=payload.cohort or "AMCA",
        audience=payload.audience,
        recipient_count=len(recipients),
        sent_count=sent,
        failed_count=failed,
        skipped_count=0,
        delivery_note="Sent with Gmail." if failed == 0 else f"{failed} email(s) were rejected.",
        status="sent" if sent and not failed else "partial" if sent else "failed" if failed else "no_recipients",
        subject=payload.subject,
        student_message=payload.message if payload.audience == "students" else "",
        teacher_message=payload.message if payload.audience == "faculty" else "",
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@api.post("/messages/timetable/send", response_model=MessageOut, status_code=201)
def send_timetable_template(payload: TimetableSendRequest, db: Session = Depends(get_db)):
    if sender_address() is None:
        raise HTTPException(status_code=503, detail="Gmail sending is not configured.")

    periods = db.scalars(
        select(Period)
        .where(Period.day_order == payload.day_order)
        .order_by(Period.cohort, Period.period_number)
    ).all()
    messages: list[tuple[Person, str, str]] = []
    student_message = ""
    teacher_message = ""

    if payload.audience == "students":
        recipients = eligible_email_people(db, "Student", payload.cohort)
        classes = [
            f"{period.period_number}"
            f"{f'-{period.period_number + period.duration_hours - 1}' if period.duration_hours > 1 else ''} Hr "
            f"{period.subject}"
            for period in periods
            if period.cohort == payload.cohort
        ]
        class_list = "; ".join(classes) if classes else "No classes are scheduled"
        student_message = (
            f"Good morning! {payload.cohort} students, today is Day Order {payload.day_order:02d}. "
            f"Your classes: {class_list}. Have a great day!"
        )
        subject = f"Day Order {payload.day_order:02d}"
        messages = [(person, subject, student_message) for person in recipients]
    else:
        faculty = eligible_email_people(db, "Teacher")
        classes_by_teacher: dict[str, list[str]] = {}
        for period in periods:
            classes_by_teacher.setdefault(period.teacher_name.strip().lower(), []).append(
                f"{period.cohort}, hour {period.period_number}"
                f"{f'-{period.period_number + period.duration_hours - 1}' if period.duration_hours > 1 else ''}: "
                f"{period.class_name}, {period.subject} ({period.room})"
            )
        for teacher in faculty:
            classes = classes_by_teacher.get(teacher.name.strip().lower())
            if classes:
                messages.append((
                    teacher,
                    f"Day Order {payload.day_order:02d}",
                    f"Good morning, {teacher.name}! Today is Day Order {payload.day_order:02d}. "
                    f"Your classes: {'; '.join(classes)}.",
                ))
        subject = f"Day Order {payload.day_order:02d}"
        teacher_message = f"Personalized class schedules for Day Order {payload.day_order:02d}."

    if len(messages) > MAX_EMAILS_PER_SEND:
        raise HTTPException(status_code=413, detail=f"Limit each email send to {MAX_EMAILS_PER_SEND} recipients.")

    sent = 0
    failed = 0
    if messages:
        try:
            sent, failed = send_emails(messages)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise HTTPException(
                status_code=502,
                detail="Gmail could not complete the send. Check Gmail App Password and SMTP access.",
            ) from exc

    status = "sent" if sent and not failed else "partial" if sent else "failed" if failed else "no_recipients"
    log = MessageLog(
        day_order=payload.day_order,
        cohort=payload.cohort,
        audience=payload.audience,
        recipient_count=len(messages),
        sent_count=sent,
        failed_count=failed,
        skipped_count=0,
        delivery_note="Sent with Gmail." if failed == 0 else f"{failed} email(s) were rejected.",
        status=status,
        subject=subject,
        student_message=student_message,
        teacher_message=teacher_message,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@api.post("/messages/preview", response_model=PreviewResult, status_code=201)
def create_message_preview(payload: PreviewRequest, db: Session = Depends(get_db)):
    if not 1 <= payload.day_order <= 6:
        raise HTTPException(status_code=422, detail="Day order must be between 1 and 6.")
    schedule = db.scalars(
        select(Period)
        .where(Period.day_order == payload.day_order, Period.cohort == payload.cohort)
        .order_by(Period.period_number)
    ).all()
    if not schedule:
        raise HTTPException(status_code=404, detail="No timetable has been configured for that day order.")
    student_count = len(eligible_email_people(db, "Student", payload.cohort))
    student_classes = "; ".join(
        f"{period.period_number}"
        f"{f'-{period.period_number + period.duration_hours - 1}' if period.duration_hours > 1 else ''} Hr "
        f"{period.subject}"
        for period in schedule
    )
    assignments_by_teacher: dict[str, list[str]] = {}
    faculty_schedule = db.scalars(
        select(Period)
        .where(Period.day_order == payload.day_order)
        .order_by(Period.cohort, Period.period_number)
    ).all()
    for period in faculty_schedule:
        assignments_by_teacher.setdefault(period.teacher_name, []).append(
            f"{period.cohort} {period.period_number}"
            f"{f'-{period.period_number + period.duration_hours - 1}' if period.duration_hours > 1 else ''} Hr: "
            f"{period.class_name}, {period.subject} ({period.room})"
        )
    eligible_teachers = eligible_email_people(db, "Teacher")
    scheduled_teachers = [
        teacher for teacher in eligible_teachers
        if teacher.name in assignments_by_teacher
    ]
    teacher_messages = " | ".join(
        f"Good morning, {teacher.name}. Day Order {payload.day_order:02d} classes: "
        f"{', '.join(assignments_by_teacher[teacher.name])}."
        for teacher in scheduled_teachers
    )
    log = MessageLog(
        day_order=payload.day_order,
        cohort=payload.cohort,
        audience="students_and_teachers",
        recipient_count=student_count + len(scheduled_teachers),
        status="preview",
        subject=f"Day Order {payload.day_order:02d} timetable · {payload.cohort}",
        student_message=f"Good morning! Today is Day Order {payload.day_order:02d}. Your classes: {student_classes}. Have a great day!",
        teacher_message=teacher_messages,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return PreviewResult(
        message=log,
        delivery_note="Preview saved only. No email was sent.",
    )


app.include_router(api)


@app.get("/api/cron/daily-email")
def send_daily_email(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    cron_secret = os.getenv("CRON_SECRET", "")
    if not cron_secret:
        raise HTTPException(status_code=503, detail="Daily email cron is not configured.")
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {cron_secret}"):
        raise HTTPException(status_code=401, detail="Invalid cron authorization.")
    if sender_address() is None:
        raise HTTPException(status_code=503, detail="Gmail sending is not configured.")
    setting = db.scalar(select(AppSetting).limit(1))
    if setting is None:
        raise HTTPException(status_code=500, detail="Application settings have not been initialized.")
    if not setting.reminder_enabled:
        return {"status": "paused"}

    today = datetime.now(COLLEGE_TIMEZONE).date()
    existing_run = db.scalar(select(EmailAutomationRun).where(EmailAutomationRun.run_date == today))
    if existing_run:
        return {"status": "already_sent", "day_order": existing_run.day_order}

    order = current_day_order(setting)
    students_by_cohort = {
        cohort: eligible_email_people(db, "Student", cohort)
        for cohort in ("AMCA", "NMCA")
    }
    faculty = eligible_email_people(db, "Teacher")
    periods = db.scalars(
        select(Period)
        .where(Period.day_order == order)
        .order_by(Period.cohort, Period.period_number)
    ).all()
    faculty_classes: dict[str, list[str]] = {}
    for period in periods:
        faculty_classes.setdefault(period.teacher_name.strip().lower(), []).append(
            f"{period.cohort}, hour {period.period_number}"
            f"{f'-{period.period_number + period.duration_hours - 1}' if period.duration_hours > 1 else ''}: "
            f"{period.subject} ({period.room})"
        )

    messages: list[tuple[Person, str, str]] = []
    student_summaries: list[str] = []
    for cohort, recipients in students_by_cohort.items():
        classes = [
            f"{period.period_number}"
            f"{f'-{period.period_number + period.duration_hours - 1}' if period.duration_hours > 1 else ''} Hr {period.subject}"
            for period in periods
            if period.cohort == cohort
        ]
        body = f"Good morning! Today is Day Order {order:02d}. Your classes: {'; '.join(classes)}. Have a great day!"
        student_summaries.append(f"{cohort}: {', '.join(classes)}")
        messages.extend((person, f"Day Order {order:02d} timetable · {cohort}", body) for person in recipients)

    teacher_count = 0
    for teacher in faculty:
        classes = faculty_classes.get(teacher.name.strip().lower())
        if classes:
            messages.append((
                teacher,
                f"Your classes for Day Order {order:02d}",
                f"Good morning, {teacher.name}. Your classes: {'; '.join(classes)}.",
            ))
            teacher_count += 1
    if len(messages) > MAX_EMAILS_PER_SEND:
        raise HTTPException(status_code=413, detail=f"Daily email is limited to {MAX_EMAILS_PER_SEND} recipients.")

    run = EmailAutomationRun(
        run_date=today,
        day_order=order,
        status="sending",
        recipient_count=len(messages),
    )
    db.add(run)
    db.commit()
    sent = 0
    failed = 0
    try:
        sent, failed = send_emails(messages)
    except (RuntimeError, smtplib.SMTPException, OSError) as exc:
        run.status = "failed"
        run.completed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=502, detail=f"Daily Gmail delivery failed: {exc}") from exc

    run.sent_count = sent
    run.failed_count = failed
    run.status = "sent" if sent and not failed else "partial" if sent else "failed" if failed else "no_recipients"
    run.completed_at = datetime.utcnow()
    db.add(
        MessageLog(
            day_order=order,
            cohort="AMCA",
            audience="daily",
            recipient_count=len(messages),
            sent_count=sent,
            failed_count=failed,
            skipped_count=0,
            delivery_note="Daily Gmail timetable notice.",
            status=run.status,
            subject=f"Day Order {order:02d} morning timetable",
            student_message="; ".join(student_summaries),
            teacher_message=f"Personalized classes delivered to {teacher_count} faculty member(s).",
        )
    )
    db.commit()
    return {"status": run.status, "day_order": order, "sent_count": sent, "failed_count": failed}
