from fastapi import APIRouter

from app.jobs import run_reminder_cycle
from app.reminder_service import reminder_schedule
from app.schemas import ReminderRunOut

router = APIRouter(prefix="/reminders", tags=["reminders"])


@router.get("/schedule")
def get_reminder_schedule() -> dict:
    return reminder_schedule()


@router.post("/run", response_model=ReminderRunOut)
def run_reminders() -> ReminderRunOut:
    stats = run_reminder_cycle()
    return ReminderRunOut(**stats)
