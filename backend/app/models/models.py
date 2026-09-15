"""
Quiter — SQLAlchemy ORM Models
================================
SECURITY NOTE: Every query built against these models MUST go through the
SQLAlchemy ORM query API (session.query(), db.select(), model.filter_by(),
relationship loaders, etc.) or MUST use bound parameters via text() with
`.bindparams()`. Raw string interpolation into SQL (f-strings, % formatting,
`.format()`) is FORBIDDEN anywhere in this codebase — that is the single
biggest SQL-injection foot-gun and this schema is designed so nothing should
ever need it (every lookup has an indexed, typed column to filter on).

All timestamps are stored UTC. All monetary/streak counters are integers to
avoid floating point drift. All foreign keys cascade sensibly so an account
deletion (GDPR "right to erasure") cleanly removes dependent rows.
"""
import uuid
import enum
from datetime import datetime, date

from sqlalchemy import (
    Column, String, Boolean, Integer, Date, DateTime, ForeignKey,
    Enum, Text, UniqueConstraint, CheckConstraint, Index, func
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, validates
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def gen_uuid():
    """UUIDv4 primary keys instead of sequential ints.

    Sequential integer IDs leak business metrics (user count, growth rate)
    and make user/plan/squad enumeration attacks trivial (?id=1, ?id=2...).
    UUIDs close that side-channel entirely at zero extra query cost since
    Postgres indexes UUID columns natively.
    """
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# ENUMS — constrained at the database level, not just app-level, so a bug
# or a raw admin query can never insert an invalid state.
# ---------------------------------------------------------------------------

class HabitDirection(str, enum.Enum):
    BREAK = "break"      # quitting smoking, alcohol, doomscrolling...
    BUILD = "build"       # working out, meditating, journaling...


class PlanLength(int, enum.Enum):
    SEVEN = 7
    FIFTEEN = 15
    THIRTY = 30


class LogStatus(str, enum.Enum):
    COMPLETED = "completed"
    MISSED = "missed"
    RELAPSED = "relapsed"     # explicit relapse acknowledgement (BREAK plans)
    PARTIAL = "partial"


# ---------------------------------------------------------------------------
# USERS
# ---------------------------------------------------------------------------

class User(db.Model):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)

    # Auth fields — never store plaintext or reversibly-encrypted passwords.
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)   # Argon2id hash, see security/passwords.py

    # Anonymous-by-design: squads show a display_name + avatar seed only,
    # never the email, in any API response.
    display_name = Column(String(40), nullable=False)
    avatar_seed = Column(String(64), nullable=False, default=gen_uuid)

    is_active = Column(Boolean, nullable=False, default=True)
    is_verified = Column(Boolean, nullable=False, default=False)
    is_admin = Column(Boolean, nullable=False, default=False)

    # Email verification (sent via Resend on registration).
    verification_token = Column(String(64), nullable=True, index=True)
    verification_token_expires_at = Column(DateTime, nullable=True)

    # Password reset (sent via Resend on request).
    reset_token = Column(String(64), nullable=True, index=True)
    reset_token_expires_at = Column(DateTime, nullable=True)

    # Account lockout support (paired with Flask-Limiter) to blunt credential
    # stuffing even if an attacker rotates source IPs.
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    plans = relationship("UserPlan", back_populates="user", cascade="all, delete-orphan")
    logs = relationship("DailyLog", back_populates="user", cascade="all, delete-orphan")

    @validates("email")
    def _normalize_email(self, key, value):
        # Defensive normalization — lowercase + strip prevents duplicate
        # accounts via case variance and stray whitespace.
        return value.strip().lower()

    def __repr__(self):
        return f"<User {self.id} {self.display_name}>"


# ---------------------------------------------------------------------------
# PLAN TEMPLATES (the catalog of identity-based programs)
# ---------------------------------------------------------------------------

class PlanTemplate(db.Model):
    """A reusable template, e.g. 'Becoming Sober — 30 Day', that many users
    can adopt. User-specific state lives in UserPlan, never here."""
    __tablename__ = "plan_templates"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    slug = Column(String(80), unique=True, nullable=False, index=True)

    title = Column(String(120), nullable=False)                  # "Becoming an Athlete"
    identity_statement = Column(String(160), nullable=False)     # "I am someone who moves every day."
    direction = Column(Enum(HabitDirection, name="habit_direction"), nullable=False)
    category = Column(String(60), nullable=False)                # smoking, alcohol, digital, fitness, mindfulness
    length_days = Column(Integer, nullable=False)

    description = Column(Text, nullable=True)
    photo_url = Column(String(500), nullable=True)
    price_cents = Column(Integer, nullable=True)
    trial_days = Column(Integer, nullable=True)
    tagline = Column(String(120), nullable=True)
    cta_text = Column(String(40), nullable=True)
    age_rating = Column(String(10), nullable=True)
    is_included = Column(Boolean, nullable=False, default=True)
    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    days = relationship("PlanDay", back_populates="template", cascade="all, delete-orphan",
                         order_by="PlanDay.day_number")

    __table_args__ = (
        CheckConstraint(
            "length_days BETWEEN 3 AND 365",
            name="ck_plan_length_valid",
),
    )


class PlanDay(db.Model):
    """One row per day of a template — the micro-goal + identity framing."""
    __tablename__ = "plan_days"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    template_id = Column(UUID(as_uuid=False), ForeignKey("plan_templates.id", ondelete="CASCADE"), nullable=False)

    day_number = Column(Integer, nullable=False)
    micro_goal = Column(String(280), nullable=False)          # "Drink 500ml water before your first coffee."
    identity_cue = Column(String(200), nullable=True)         # "Athletes hydrate before they caffeinate."
    reward_tier = Column(Integer, nullable=False, default=1)  # drives which Three.js bloom stage fires

    template = relationship("PlanTemplate", back_populates="days")

    __table_args__ = (
        UniqueConstraint("template_id", "day_number", name="uq_plan_day_unique"),
    )


# ---------------------------------------------------------------------------
# USER PLANS (a user's live instance of a template)
# ---------------------------------------------------------------------------

class UserPlan(db.Model):
    __tablename__ = "user_plans"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    template_id = Column(UUID(as_uuid=False), ForeignKey("plan_templates.id", ondelete="RESTRICT"), nullable=False)
    # Custom-plan settings. Catalog plans may leave these nullable/defaulted.
    goal_text = Column(String(160), nullable=True)
    identity_statement = Column(String(160), nullable=True)
    support_style = Column(String(20), nullable=False, default="gentle")

    # Stored as JSONB so each user can choose zero, one, two, or three times.
    reminder_times = Column(JSONB, nullable=False, default=list)
    reminder_timezone = Column(String(64), nullable=False, default="UTC")
    reminders_enabled = Column(Boolean, nullable=False, default=False)

    start_date = Column(Date, nullable=False, default=date.today)
    current_streak = Column(Integer, nullable=False, default=0)
    longest_streak = Column(Integer, nullable=False, default=0)
    last_checkin_date = Column(Date, nullable=False, default=date.today)
    is_completed = Column(Boolean, nullable=False, default=False)
    is_abandoned = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    user = relationship("User", back_populates="plans")
    template = relationship("PlanTemplate")
    logs = relationship("DailyLog", back_populates="user_plan", cascade="all, delete-orphan")

    __table_args__ = (
        # A user may only have ONE active (not completed/abandoned) instance
        # of a given template at a time — enforced partially in app logic,
        # but the composite index keeps the "find active plan" query O(log n).
        Index("ix_user_plans_active_lookup", "user_id", "is_completed", "is_abandoned"),
    )


class DailyLog(db.Model):
    """The append-only ledger of check-ins. This is the source of truth for
    streaks — current_streak on UserPlan is a denormalized cache recomputed
    from this table, never the other way around."""
    __tablename__ = "daily_logs"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user_plan_id = Column(UUID(as_uuid=False), ForeignKey("user_plans.id", ondelete="CASCADE"), nullable=False)
    plan_day_id = Column(UUID(as_uuid=False), ForeignKey("plan_days.id", ondelete="RESTRICT"), nullable=True)

    log_date = Column(Date, nullable=False, default=date.today)
    status = Column(Enum(LogStatus, name="log_status"), nullable=False)
    note = Column(String(280), nullable=True)   # optional private journal line

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    user = relationship("User", back_populates="logs")
    user_plan = relationship("UserPlan", back_populates="logs")

    __table_args__ = (
        # One log per user per plan per calendar day — prevents duplicate
        # check-in spam (also enforced app-side, but this is the hard floor).
        UniqueConstraint("user_plan_id", "log_date", name="uq_one_log_per_day"),
        Index("ix_daily_logs_user_date", "user_id", "log_date"),
    )

