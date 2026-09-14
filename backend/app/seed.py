from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.models import (
    AppSetting,
    AuditRecord,
    Department,
    Letter,
    MasterValue,
    MonthlyTrend,
    Notification,
    Organization,
    User,
)


MASTER_DATA = {
    "Letter Types": ["Incoming", "Outgoing", "Internal Memo"],
    "Priorities": ["Routine", "Important", "Urgent"],
    "Statuses": [
        "Registered",
        "Under Review",
        "Assigned",
        "Action in Progress",
        "Awaiting Response",
        "Completed",
        "Closed",
        "Overdue",
    ],
    "Confidentiality Levels": ["Normal", "Confidential", "Restricted"],
    "Action Types": ["Review", "Prepare response", "Forward", "Approve", "Archive"],
    "Organization Types": [
        "Government",
        "Defence",
        "Research",
        "Commercial",
        "Foreign Organization",
        "Internal Department",
        "Other",
    ],
}

DEPARTMENTS = [
    ("COR", "Coordination", "A. Rahman"),
    ("TEC", "Technical", "S. Khan"),
    ("FIN", "Finance", "N. Ahmed"),
    ("OPS", "Operations", "M. Iqbal"),
    ("ADM", "Administration", "F. Ali"),
    ("EXT", "External Relations", "H. Masood"),
    ("POL", "Policy", "Z. Raza"),
    ("HR", "Human Resources", "F. Ali"),
]

ORGANIZATIONS = [
    ("Ministry of Defence", "MOD", "Government", "Secretary Office", "secretary@mod.gov", "+92 51 9000", "Active"),
    ("SUPARCO", "SUPARCO", "Research", "Director General", "info@suparco.gov", "+92 21 9927", "Active"),
    ("Finance Division", "FD", "Government", "Budget Wing", "budget@finance.gov", "+92 51 9100", "Active"),
    ("Foreign Partner Organization", "FPO", "Foreign Organization", "Liaison Office", "liaison@partner.org", "+44 20 7000", "Active"),
    ("Research Organization", "RPO", "Research", "Focal Person", "contact@research.org", "+92 51 3300", "Inactive"),
    ("Cabinet Secretariat", "CAB", "Government", "Records Wing", "records@cabinet.gov", "+92 51 9200", "Active"),
    ("Government Department", "GOV", "Government", "Operations Desk", "ops@gov.pk", "+92 51 9300", "Active"),
]

USERS = [
    ("A. Rahman", "arahman", "Coordination", "Administrator", "a.rahman@office.gov", "Active", datetime(2026, 9, 13, 9, 42)),
    ("S. Khan", "skhan", "Technical", "Management", "s.khan@office.gov", "Active", datetime(2026, 9, 13, 8, 18)),
    ("N. Ahmed", "nahmed", "Finance", "Correspondence Officer", "n.ahmed@office.gov", "Active", datetime(2026, 9, 12, 16, 10)),
    ("M. Iqbal", "miqbal", "Operations", "Department/User", "m.iqbal@office.gov", "Active", datetime(2026, 9, 11, 11, 30)),
    ("F. Ali", "fali", "Administration", "Department/User", "f.ali@office.gov", "Inactive", datetime(2026, 9, 4, 10, 5)),
    ("H. Masood", "hmasood", "External Relations", "Department/User", "h.masood@office.gov", "Active", datetime(2026, 9, 12, 14, 20)),
    ("Z. Raza", "zraza", "Policy", "Correspondence Officer", "z.raza@office.gov", "Active", datetime(2026, 9, 13, 9, 5)),
]

LETTERS = [
    dict(number="MOD/SEC/2026/0412", letter_date=date(2026, 9, 8), received_date=date(2026, 9, 10), type="Incoming", subject="Request for quarterly security coordination meeting", sender="Ministry of Defence", recipient="Office of the Secretary", department="Coordination", priority="Important", status="Action in Progress", due_date=date(2026, 9, 17), assigned_to="A. Rahman", last_action="Forwarded to Coordination"),
    dict(number="SUPARCO/ADM/26/118", letter_date=date(2026, 9, 5), received_date=date(2026, 9, 7), type="Incoming", subject="Technical review of satellite communications proposal", sender="SUPARCO", recipient="Director General", department="Technical", priority="Urgent", status="Overdue", due_date=date(2026, 9, 12), assigned_to="S. Khan", last_action="Action initiated"),
    dict(number="ORG/FIN/2026/207", letter_date=date(2026, 9, 11), received_date=date(2026, 9, 11), type="Incoming", subject="Revised budget estimates for FY 2026–27", sender="Finance Division", recipient="Admin & Finance", department="Finance", priority="Important", status="Under Review", due_date=date(2026, 9, 20), assigned_to="N. Ahmed", last_action="Registered"),
    dict(number="OUT/OPS/2026/089", letter_date=date(2026, 9, 10), received_date=date(2026, 9, 10), type="Outgoing", subject="Follow-up on inter-agency operations brief", sender="Operations Directorate", recipient="Government Department", department="Operations", priority="Routine", status="Awaiting Response", due_date=date(2026, 9, 24), assigned_to="M. Iqbal", last_action="Response sent"),
    dict(number="RPO/HR/2026/331", letter_date=date(2026, 8, 28), received_date=date(2026, 9, 1), type="Incoming", subject="Nomination of focal persons for working group", sender="Research Organization", recipient="HR Department", department="Human Resources", priority="Routine", status="Completed", due_date=date(2026, 9, 9), assigned_to="F. Ali", last_action="Action completed", completion_date=date(2026, 9, 9)),
    dict(number="FPO/EXT/2026/054", letter_date=date(2026, 9, 2), received_date=date(2026, 9, 4), type="Incoming", subject="Invitation to bilateral technical consultation", sender="Foreign Partner Organization", recipient="International Relations", department="External Relations", priority="Important", status="Assigned", due_date=date(2026, 9, 18), assigned_to="H. Masood", last_action="Assigned to officer"),
    dict(number="OUT/ADM/2026/144", letter_date=date(2026, 9, 3), received_date=date(2026, 9, 3), type="Outgoing", subject="Submission of annual administrative report", sender="Admin Department", recipient="Cabinet Secretariat", department="Administration", priority="Routine", status="Closed", due_date=date(2026, 9, 8), assigned_to="A. Rahman", last_action="Closed", completion_date=date(2026, 9, 8)),
    dict(number="MOD/POL/2026/398", letter_date=date(2026, 9, 12), received_date=date(2026, 9, 12), type="Incoming", subject="Policy guidance for records retention", sender="Ministry of Defence", recipient="Records Office", department="Policy", priority="Routine", status="Registered", due_date=date(2026, 9, 22), assigned_to="Z. Raza", last_action="Registered"),
]

TRENDS = [
    (2026, "Apr", 34, 22),
    (2026, "May", 42, 29),
    (2026, "Jun", 38, 25),
    (2026, "Jul", 51, 36),
    (2026, "Aug", 58, 41),
    (2026, "Sep", 44, 31),
]


def seed_if_empty(db: Session) -> None:
    if db.query(Letter).count():
        return

    for category, values in MASTER_DATA.items():
        for value in values:
            db.add(MasterValue(category=category, value=value))

    for code, name, head in DEPARTMENTS:
        db.add(Department(code=code, name=name, head=head))

    for name, short, org_type, contact, email, phone, status in ORGANIZATIONS:
        db.add(Organization(name=name, short_name=short, type=org_type, contact=contact, email=email, phone=phone, status=status))

    for name, username, department, role, email, status, activity in USERS:
        db.add(User(name=name, username=username, department=department, role=role, email=email, status=status, last_activity=activity))

    for payload in LETTERS:
        db.add(Letter(**payload))

    for year, month, incoming, outgoing in TRENDS:
        db.add(MonthlyTrend(year=year, month=month, incoming=incoming, outgoing=outgoing))

    now = datetime(2026, 9, 13, 9, 42)
    db.add_all(
        [
            AuditRecord(created_at=now, user="A. Rahman", module="Letters", action="Status Changed", record="MOD/SEC/2026/0412", description="Status changed to Action in Progress", source="Web · 10.20.4.12"),
            AuditRecord(created_at=now - timedelta(minutes=27), user="S. Khan", module="Letters", action="Action Assigned", record="SUPARCO/ADM/26/118", description="Technical review assigned to S. Khan", source="Web · 10.20.4.18"),
            AuditRecord(created_at=datetime(2026, 9, 12, 16, 30), user="A. Rahman", module="Users", action="User Created", record="usr-005", description="Created Department/User account", source="Admin · 10.20.4.12"),
            AuditRecord(created_at=datetime(2026, 9, 12, 14, 8), user="N. Ahmed", module="Letters", action="Letter Registered", record="ORG/FIN/2026/207", description="Incoming letter registered", source="Web · 10.20.4.24"),
            AuditRecord(created_at=datetime(2026, 9, 11, 11, 22), user="A. Rahman", module="Master Data", action="Master Data Changed", record="priority:urgent", description="Priority value updated", source="Admin · 10.20.4.12"),
        ]
    )

    db.flush()
    letters = {letter.number: letter.id for letter in db.query(Letter).all()}
    db.add_all(
        [
            Notification(title="New assignment", description="Technical review assigned to your department.", priority="High", read=False, letter_id=letters.get("SUPARCO/ADM/26/118"), created_at=now - timedelta(minutes=12)),
            Notification(title="Due today", description="Quarterly security coordination meeting is due soon.", priority="Medium", read=False, letter_id=letters.get("MOD/SEC/2026/0412"), created_at=now - timedelta(hours=1)),
            Notification(title="Overdue correspondence", description="SUPARCO technical proposal is overdue.", priority="Critical", read=True, letter_id=letters.get("SUPARCO/ADM/26/118"), created_at=now - timedelta(days=1)),
            Notification(title="Response received", description="A response was received for an operations brief.", priority="Low", read=True, letter_id=letters.get("OUT/OPS/2026/089"), created_at=datetime(2026, 9, 11, 15, 20)),
        ]
    )

    db.add_all(
        [
            AppSetting(key="organizationName", value="Office of the Secretary"),
            AppSetting(key="systemName", value="Correspondence Management System"),
            AppSetting(key="defaultDueDays", value="7"),
            AppSetting(key="currentUser", value="A. Rahman"),
        ]
    )
    db.commit()
