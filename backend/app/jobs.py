"""Background reminder processing."""

from __future__ import annotations

import logging
import threading
import time

from app.config import get_settings
from app.database import SessionLocal
from app.reminder_service import process_reminders

logger = logging.getLogger("ailms.jobs")
_stop = threading.Event()
_thread: threading.Thread | None = None


def run_reminder_cycle() -> dict:
    db = SessionLocal()
    try:
        stats = process_reminders(db)
        db.commit()
        return stats
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _loop(interval_seconds: int) -> None:
    while not _stop.is_set():
        try:
            stats = run_reminder_cycle()
            logger.info("Reminder cycle complete: %s", stats)
        except Exception:
            logger.exception("Reminder cycle failed")
        _stop.wait(interval_seconds)


def start_reminder_scheduler(interval_seconds: int = 3600) -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, args=(interval_seconds,), name="reminder-scheduler", daemon=True)
    _thread.start()


def stop_reminder_scheduler() -> None:
    _stop.set()
