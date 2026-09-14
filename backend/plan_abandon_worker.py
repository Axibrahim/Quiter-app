"""
Quiter plan-abandon worker.

Run this as a separate service (e.g. a second Railway service), same as
reninder_worker.py:

    cd backend && python plan_abandon_worker.py

Runs once a day and auto-abandons any active plan that's gone 15+ days
without a check-in. Deliberately separate from Flask so this schedule
runs independent of any user opening the site or app that day.
"""

import logging
import os
import time
from datetime import date, timedelta

from app import create_app
from app.models.models import db, UserPlan

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("quiter.plan_abandon")

AUTO_QUIT_AFTER_DAYS = 15
POLL_SECONDS = max(3600, int(os.environ.get("ABANDON_POLL_SECONDS", "86400")))  # default: once a day


def abandon_stale_plans():
    cutoff = date.today() - timedelta(days=AUTO_QUIT_AFTER_DAYS)

    stale_plans = UserPlan.query.filter(
        UserPlan.is_completed.is_(False),
        UserPlan.is_abandoned.is_(False),
        UserPlan.last_checkin_date < cutoff,
    ).all()

    for plan in stale_plans:
        plan.is_abandoned = True
        logger.info(
            "Auto-abandoning plan %s (last check-in %s)",
            plan.id, plan.last_checkin_date,
        )

    if stale_plans:
        db.session.commit()

    db.session.remove()
    return len(stale_plans)


def main():
    app = create_app("production")

    with app.app_context():
        logger.info(
            "Quiter plan-abandon worker started; checking every %ss",
            POLL_SECONDS,
        )

        while True:
            try:
                count = abandon_stale_plans()
                if count:
                    logger.info("Auto-abandoned %d plan(s)", count)
            except Exception:
                db.session.rollback()
                db.session.remove()
                logger.exception("Abandon cycle failed")

            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()