from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.models import (
    AppSetting,
    Approval,
    AuditRecord,
    Department,
    DepartmentLink,
    Document,
    DocumentVersion,
    Escalation,
    Letter,
    LetterMeetingLink,
    LetterRelation,
    Meeting,
    MeetingAction,
    MeetingParticipant,
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
        "Draft",
        "Registered",
        "OCR Processed",
        "LLM Analyzed",
        "Validated",
        "Classified",
        "Pending Routing Approval",
        "Routed",
        "Action Assigned",
        "In Progress",
        "Response Drafted",
        "Under Approval",
        "Returned for Revision",
        "Approved for Dispatch",
        "Dispatched",
        "Information Delivered",
        "Under Review",
        "Assigned",
        "Action in Progress",
        "Awaiting Response",
        "Response Prepared",
        "Approval Pending",
        "Response Approved",
        "Response Sent",
        "Completed",
        "Closed",
        "Rejected",
        "Escalated",
        "Reopened",
        "Archived",
        "Overdue",
    ],
    "Confidentiality Levels": ["Normal", "Confidential", "Restricted"],
    "Action Types": ["Review", "Prepare response", "Forward", "Approve", "Archive"],
    "Document Types": [
        "Original Letter",
        "Scanned Letter",
        "Draft Response",
        "Final Response",
        "Supporting Document",
        "Technical Document",
        "Financial Document",
        "Reference Document",
        "Email",
        "Presentation",
        "Attachment",
        "Other",
    ],
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

# Default org-chart layout (canvas positions) and reporting lines under Coordination.
DEPARTMENT_LAYOUT = {
    "Coordination": (420, 40),
    "Technical": (80, 220),
    "Finance": (280, 220),
    "Operations": (480, 220),
    "Administration": (680, 220),
    "External Relations": (180, 420),
    "Policy": (420, 420),
    "Human Resources": (660, 420),
}

DEPARTMENT_PARENTS = {
    "Technical": "Coordination",
    "Finance": "Coordination",
    "Operations": "Coordination",
    "Administration": "Coordination",
    "External Relations": "Coordination",
    "Policy": "Coordination",
    "Human Resources": "Administration",
}

DEPARTMENT_COORDINATION = [
    ("Technical", "Operations"),
    ("Technical", "External Relations"),
    ("Finance", "Administration"),
    ("Operations", "Policy"),
    ("External Relations", "Policy"),
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
    ("A. Rahman", "arahman", "Coordination", "Admin", "a.rahman@office.gov", "Active", datetime(2026, 9, 13, 9, 42)),
    ("S. Khan", "skhan", "Technical", "Management", "s.khan@office.gov", "Active", datetime(2026, 9, 13, 8, 18)),
    ("N. Ahmed", "nahmed", "Finance", "Coordinator", "n.ahmed@office.gov", "Active", datetime(2026, 9, 12, 16, 10)),
    ("M. Iqbal", "miqbal", "Operations", "Actionist", "m.iqbal@office.gov", "Active", datetime(2026, 9, 11, 11, 30)),
    ("F. Ali", "fali", "Administration", "Actionist", "f.ali@office.gov", "Inactive", datetime(2026, 9, 4, 10, 5)),
    ("H. Masood", "hmasood", "External Relations", "Actionist", "h.masood@office.gov", "Active", datetime(2026, 9, 12, 14, 20)),
    ("Z. Raza", "zraza", "Policy", "Coordinator", "z.raza@office.gov", "Active", datetime(2026, 9, 13, 9, 5)),
    ("R. Malik", "rmalik", "Technical", "Manager", "r.malik@office.gov", "Active", datetime(2026, 9, 13, 10, 0)),
    ("L. Noor", "lnoor", "Coordination", "Viewer", "l.noor@office.gov", "Active", datetime(2026, 9, 13, 10, 5)),
]

LETTERS = [
    dict(number="MOD/SEC/2026/0412", letter_date=date(2026, 9, 8), received_date=date(2026, 9, 10), type="Incoming", subject="Request for quarterly security coordination meeting", sender="Ministry of Defence", recipient="Office of the Secretary", department="Coordination", priority="Important", status="Action in Progress", due_date=date(2026, 9, 17), assigned_to="A. Rahman", created_by="A. Rahman", assigned_by="A. Rahman", last_action="Forwarded to Coordination"),
    dict(number="SUPARCO/ADM/26/118", letter_date=date(2026, 9, 5), received_date=date(2026, 9, 7), type="Incoming", subject="Technical review of satellite communications proposal", sender="SUPARCO", recipient="Director General", department="Technical", priority="Urgent", status="Overdue", due_date=date(2026, 9, 12), assigned_to="S. Khan", created_by="A. Rahman", assigned_by="A. Rahman", last_action="Action initiated"),
    dict(number="ORG/FIN/2026/207", letter_date=date(2026, 9, 11), received_date=date(2026, 9, 11), type="Incoming", subject="Revised budget estimates for FY 2026–27", sender="Finance Division", recipient="Admin & Finance", department="Finance", priority="Important", status="Under Review", due_date=date(2026, 9, 20), assigned_to="N. Ahmed", created_by="N. Ahmed", assigned_by="N. Ahmed", last_action="Registered"),
    dict(number="OUT/OPS/2026/089", letter_date=date(2026, 9, 10), received_date=date(2026, 9, 10), type="Outgoing", subject="Follow-up on inter-agency operations brief", sender="Operations Directorate", recipient="Government Department", department="Operations", priority="Routine", status="Awaiting Response", due_date=date(2026, 9, 24), assigned_to="M. Iqbal", created_by="M. Iqbal", assigned_by="M. Iqbal", last_action="Response sent"),
    dict(number="RPO/HR/2026/331", letter_date=date(2026, 8, 28), received_date=date(2026, 9, 1), type="Incoming", subject="Nomination of focal persons for working group", sender="Research Organization", recipient="HR Department", department="Human Resources", priority="Routine", status="Completed", due_date=date(2026, 9, 9), assigned_to="F. Ali", created_by="F. Ali", assigned_by="F. Ali", last_action="Action completed", completion_date=date(2026, 9, 9)),
    dict(number="FPO/EXT/2026/054", letter_date=date(2026, 9, 2), received_date=date(2026, 9, 4), type="Incoming", subject="Invitation to bilateral technical consultation", sender="Foreign Partner Organization", recipient="International Relations", department="External Relations", priority="Important", status="Assigned", due_date=date(2026, 9, 18), assigned_to="H. Masood", created_by="A. Rahman", assigned_by="A. Rahman", last_action="Assigned to officer"),
    dict(number="OUT/ADM/2026/144", letter_date=date(2026, 9, 3), received_date=date(2026, 9, 3), type="Outgoing", subject="Submission of annual administrative report", sender="Admin Department", recipient="Cabinet Secretariat", department="Administration", priority="Routine", status="Closed", due_date=date(2026, 9, 8), assigned_to="A. Rahman", created_by="A. Rahman", assigned_by="A. Rahman", last_action="Closed", completion_date=date(2026, 9, 8)),
    dict(number="MOD/POL/2026/398", letter_date=date(2026, 9, 12), received_date=date(2026, 9, 12), type="Incoming", subject="Policy guidance for records retention", sender="Ministry of Defence", recipient="Records Office", department="Policy", priority="Routine", status="Registered", due_date=date(2026, 9, 22), assigned_to="Z. Raza", created_by="Z. Raza", assigned_by="Z. Raza", last_action="Registered"),
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
        pos = DEPARTMENT_LAYOUT.get(name, (0, 0))
        db.add(Department(code=code, name=name, head=head, pos_x=pos[0], pos_y=pos[1]))

    db.flush()
    by_name = {row.name: row for row in db.query(Department).all()}
    for child_name, parent_name in DEPARTMENT_PARENTS.items():
        child = by_name.get(child_name)
        parent = by_name.get(parent_name)
        if child and parent:
            child.parent_id = parent.id
    for source_name, target_name in DEPARTMENT_COORDINATION:
        source = by_name.get(source_name)
        target = by_name.get(target_name)
        if source and target:
            db.add(DepartmentLink(source_id=source.id, target_id=target.id, kind="coordinates"))

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


def ensure_phase4b_samples(db: Session) -> None:
    """Light sample data when tables exist but are empty (non-destructive)."""
    if db.query(Approval).count() == 0:
        letter = db.query(Letter).filter(Letter.number == "SUPARCO/ADM/26/118").first()
        if letter:
            db.add(
                Approval(
                    letter_id=letter.id,
                    prepared_by="S. Khan",
                    reviewer="A. Rahman",
                    approval_status="Pending",
                    revision_number=1,
                )
            )

    if db.query(Escalation).count() == 0:
        letter = db.query(Letter).filter(Letter.status == "Overdue").first()
        if letter:
            db.add(
                Escalation(
                    letter_id=letter.id,
                    escalation_level="Level 2",
                    escalated_by="S. Khan",
                    escalated_to="A. Rahman",
                    reason="Overdue technical review requires management attention.",
                    escalation_date=date(2026, 9, 13),
                    target_resolution_date=date(2026, 9, 15),
                    status="Open",
                )
            )


def ensure_phase4d_samples(db: Session) -> None:
    if db.query(Meeting).count() == 0:
        meeting = Meeting(
            title="Quarterly security coordination meeting",
            meeting_date=date(2026, 9, 17),
            start_time="10:00",
            end_time="11:30",
            location="Conference Room A",
            chairperson="A. Rahman",
            agenda="Review pending security correspondence and department actions.",
            status="Scheduled",
            created_by="A. Rahman",
        )
        db.add(meeting)
        db.flush()
        db.add(MeetingParticipant(meeting_id=meeting.id, participant_name="A. Rahman", department="Coordination"))
        db.add(MeetingParticipant(meeting_id=meeting.id, participant_name="S. Khan", department="Technical"))
        letter = db.query(Letter).filter(Letter.number == "MOD/SEC/2026/0412").first()
        if letter:
            db.add(LetterMeetingLink(meeting_id=meeting.id, letter_id=letter.id, linked_by="A. Rahman"))
        db.add(
            MeetingAction(
                meeting_id=meeting.id,
                action_description="Circulate updated security checklist to all departments",
                responsible_person="S. Khan",
                department="Technical",
                priority="Important",
                due_date=date(2026, 9, 20),
                status="Open",
            )
        )

    if db.query(LetterRelation).count() == 0:
        primary = db.query(Letter).filter(Letter.number == "MOD/SEC/2026/0412").first()
        related = db.query(Letter).filter(Letter.number == "OUT/OPS/2026/089").first()
        if primary and related:
            db.add(
                LetterRelation(
                    from_letter_id=primary.id,
                    to_letter_id=related.id,
                    relationship_type="Related",
                    created_by="A. Rahman",
                    remarks="Linked during coordination review",
                )
            )


def _seed_dummy_attachment(
    db: Session,
    *,
    letter_id: int,
    filename: str,
    document_type: str = "Supporting Document",
    uploaded_by: str = "S. Khan",
) -> None:
    """Create a document metadata row (no real binary) so analysis can cite attachments."""
    existing = (
        db.query(DocumentVersion)
        .join(Document, Document.id == DocumentVersion.document_id)
        .filter(Document.letter_id == letter_id, DocumentVersion.original_filename == filename)
        .first()
    )
    if existing:
        return
    doc = Document(letter_id=letter_id, document_type=document_type, status="Active")
    db.add(doc)
    db.flush()
    db.add(
        DocumentVersion(
            document_id=doc.id,
            version_number="1.0",
            filename=filename,
            original_filename=filename,
            file_type=filename.rsplit(".", 1)[-1].lower() if "." in filename else "pdf",
            mime_type="application/pdf",
            file_size=128_000,
            storage_key=f"seed/{letter_id}/{filename}",
            uploaded_by=uploaded_by,
            change_description="Seed dummy attachment",
            status="Current",
            checksum="",
            is_current=True,
        )
    )


def ensure_procurement_thread_samples(db: Session) -> None:
    """
    Long dummy correspondence thread: vendor quotation → SUPARCO questions →
    competing vendor replies → internal evaluation → award recommendation.
    Idempotent via marker letter number VND/AQ/2026/001.
    """
    marker = "VND/AQ/2026/001"
    if db.query(Letter).filter(Letter.number == marker).first():
        return

    # Ensure vendor orgs exist for UI filters
    for name, short, org_type in (
        ("AeroLink Systems Pvt Ltd", "ALS", "Commercial"),
        ("OrbitTech Solutions", "OTS", "Commercial"),
        ("SkyWave Engineering", "SWE", "Commercial"),
    ):
        if not db.query(Organization).filter(Organization.name == name).first():
            db.add(
                Organization(
                    name=name,
                    short_name=short,
                    type=org_type,
                    contact="Sales Desk",
                    email=f"sales@{short.lower()}.example",
                    phone="+92 21 0000",
                    status="Active",
                )
            )

    thread_specs = [
        dict(
            number=marker,
            letter_date=date(2026, 7, 2),
            received_date=date(2026, 7, 3),
            type="Incoming",
            subject="Quotation for S-band ground station RF front-end kit",
            sender="AeroLink Systems Pvt Ltd",
            recipient="SUPARCO Procurement",
            department="Technical",
            priority="Important",
            status="Action in Progress",
            due_date=date(2026, 7, 20),
            assigned_to="S. Khan",
            created_by="A. Rahman",
            assigned_by="A. Rahman",
            last_action="Registered quotation",
            body_text=(
                "Dear Sir,\n\n"
                "AeroLink Systems is pleased to submit Quotation AQ-7842 for supply of one S-band RF front-end kit "
                "compatible with SUPARCO ground-station racks. Unit price PKR 18,450,000 (ex-GST), delivery 12 weeks "
                "EXW Karachi, validity 60 days. Warranty 24 months. Please find attached technical datasheet and "
                "commercial offer.\n\nRegards,\nSales Manager, AeroLink Systems"
            ),
            attachment="AeroLink_AQ-7842_Quotation.pdf",
        ),
        dict(
            number="SUP/TEC/OUT/2026/221",
            letter_date=date(2026, 7, 8),
            received_date=date(2026, 7, 8),
            type="Outgoing",
            subject="Clarifications on AeroLink quotation AQ-7842 (S-band RF kit)",
            sender="SUPARCO Technical Directorate",
            recipient="AeroLink Systems Pvt Ltd",
            department="Technical",
            priority="Important",
            status="Awaiting Response",
            due_date=date(2026, 7, 18),
            assigned_to="S. Khan",
            created_by="S. Khan",
            assigned_by="S. Khan",
            last_action="Clarification questions sent",
            body_text=(
                "Reference your quotation AQ-7842 dated 02 Jul 2026.\n\n"
                "Please clarify: (1) noise figure at 2.2 GHz under −10°C ambient; (2) whether LNA bias supply is included; "
                "(3) MTBF figures per MIL-HDBK-217; (4) spare kit pricing for 2 years. Reply within ten working days.\n\n"
                "S. Khan\nTechnical Directorate, SUPARCO"
            ),
            attachment="SUPARCO_Clarification_AQ-7842.pdf",
        ),
        dict(
            number="VND/AQ/2026/014",
            letter_date=date(2026, 7, 15),
            received_date=date(2026, 7, 16),
            type="Incoming",
            subject="Reply to SUPARCO clarifications on quotation AQ-7842",
            sender="AeroLink Systems Pvt Ltd",
            recipient="SUPARCO Technical Directorate",
            department="Technical",
            priority="Important",
            status="Under Review",
            due_date=date(2026, 7, 25),
            assigned_to="S. Khan",
            created_by="A. Rahman",
            assigned_by="A. Rahman",
            last_action="Vendor clarification received",
            body_text=(
                "Dear Sir,\n\n"
                "Please find answers to your four points: (1) NF ≤ 0.85 dB at −10°C; (2) bias supply included in kit; "
                "(3) MTBF 85,000 hrs predicted; (4) 2-year spares package PKR 2,100,000. Revised datasheet attached. "
                "We remain available for a technical meeting.\n\nAeroLink Systems"
            ),
            attachment="AeroLink_Clarification_Reply_AQ-7842.pdf",
        ),
        dict(
            number="VND/OT/2026/088",
            letter_date=date(2026, 7, 18),
            received_date=date(2026, 7, 19),
            type="Incoming",
            subject="Competitive quotation for S-band ground station RF front-end",
            sender="OrbitTech Solutions",
            recipient="SUPARCO Procurement",
            department="Technical",
            priority="Important",
            status="Under Review",
            due_date=date(2026, 8, 1),
            assigned_to="S. Khan",
            created_by="A. Rahman",
            assigned_by="A. Rahman",
            last_action="Competing quotation registered",
            body_text=(
                "OrbitTech Solutions submits Quotation OT-331 for an equivalent S-band RF front-end. "
                "Unit price PKR 17,900,000 (ex-GST), delivery 14 weeks FOB Karachi, validity 45 days, warranty 18 months. "
                "Technical brochure and compliance matrix attached. We request inclusion in the evaluation."
            ),
            attachment="OrbitTech_OT-331_Quotation.pdf",
        ),
        dict(
            number="SUP/TEC/OUT/2026/238",
            letter_date=date(2026, 7, 22),
            received_date=date(2026, 7, 22),
            type="Outgoing",
            subject="Technical questionnaire for OrbitTech quotation OT-331",
            sender="SUPARCO Technical Directorate",
            recipient="OrbitTech Solutions",
            department="Technical",
            priority="Important",
            status="Awaiting Response",
            due_date=date(2026, 8, 1),
            assigned_to="S. Khan",
            created_by="S. Khan",
            assigned_by="S. Khan",
            last_action="Questionnaire dispatched",
            body_text=(
                "Reference OT-331. Please confirm rack depth compatibility with SUPARCO GS-R2 cabinets, "
                "availability of local field support in Karachi, and whether FIR software updates are included for 3 years."
            ),
            attachment="SUPARCO_Questionnaire_OT-331.pdf",
        ),
        dict(
            number="VND/OT/2026/095",
            letter_date=date(2026, 7, 29),
            received_date=date(2026, 7, 30),
            type="Incoming",
            subject="OrbitTech response to SUPARCO questionnaire OT-331",
            sender="OrbitTech Solutions",
            recipient="SUPARCO Technical Directorate",
            department="Technical",
            priority="Important",
            status="Under Review",
            due_date=date(2026, 8, 10),
            assigned_to="S. Khan",
            created_by="A. Rahman",
            assigned_by="A. Rahman",
            last_action="Vendor questionnaire reply",
            body_text=(
                "OrbitTech confirms: (1) GS-R2 rack depth compatible with supplied rails; (2) Karachi field engineer on call "
                "within 48 hours; (3) FIR updates included for 3 years under warranty extension Option-B (+PKR 450,000)."
            ),
            attachment="OrbitTech_Questionnaire_Reply.pdf",
        ),
        dict(
            number="VND/SW/2026/041",
            letter_date=date(2026, 8, 2),
            received_date=date(2026, 8, 3),
            type="Incoming",
            subject="Late quotation / expression of interest — S-band RF front-end",
            sender="SkyWave Engineering",
            recipient="SUPARCO Procurement",
            department="Technical",
            priority="Routine",
            status="Under Review",
            due_date=date(2026, 8, 15),
            assigned_to="S. Khan",
            created_by="A. Rahman",
            assigned_by="A. Rahman",
            last_action="Late EOI logged",
            body_text=(
                "SkyWave Engineering submits a late EOI with indicative price PKR 19,200,000 and 10-week delivery. "
                "We request consideration if the tender window remains open; brochure attached."
            ),
            attachment="SkyWave_EOI_Sband.pdf",
        ),
        dict(
            number="SUP/TEC/INT/2026/052",
            letter_date=date(2026, 8, 8),
            received_date=date(2026, 8, 8),
            type="Internal Memo",
            subject="Comparative evaluation — S-band RF front-end quotations",
            sender="Technical Evaluation Committee",
            recipient="Director Technical",
            department="Technical",
            priority="Urgent",
            status="Action in Progress",
            due_date=date(2026, 8, 15),
            assigned_to="R. Malik",
            created_by="S. Khan",
            assigned_by="S. Khan",
            last_action="Evaluation memo circulated",
            body_text=(
                "TEC compared AeroLink AQ-7842, OrbitTech OT-331, and late SkyWave EOI. "
                "Technically both AeroLink and OrbitTech meet mandatory specs. OrbitTech is lower cost but shorter warranty; "
                "AeroLink offers better NF and 24-month warranty. SkyWave late EOI recommended for record only. "
                "Finance concurrence requested before award recommendation."
            ),
            attachment="TEC_Comparative_Matrix_Sband.xlsx.pdf",
        ),
        dict(
            number="SUP/FIN/OUT/2026/119",
            letter_date=date(2026, 8, 12),
            received_date=date(2026, 8, 12),
            type="Internal Memo",
            subject="Finance concurrence on S-band RF kit procurement",
            sender="Finance Directorate",
            recipient="Director Technical",
            department="Finance",
            priority="Important",
            status="Completed",
            due_date=date(2026, 8, 14),
            assigned_to="N. Ahmed",
            created_by="N. Ahmed",
            assigned_by="N. Ahmed",
            last_action="Concurrence issued",
            completion_date=date(2026, 8, 12),
            body_text=(
                "Finance concurs with TEC evaluation. Budget head GS-CAP-2026 can absorb either AeroLink or OrbitTech quote. "
                "Recommend award to technically preferred offer if difference ≤ 5% after warranty normalization."
            ),
            attachment="Finance_Concurrence_Sband.pdf",
        ),
        dict(
            number="SUP/PRC/OUT/2026/067",
            letter_date=date(2026, 8, 18),
            received_date=date(2026, 8, 18),
            type="Outgoing",
            subject="Award recommendation / LOI — S-band RF front-end kit (AeroLink AQ-7842)",
            sender="SUPARCO Procurement",
            recipient="AeroLink Systems Pvt Ltd",
            department="Technical",
            priority="Urgent",
            status="Awaiting Response",
            due_date=date(2026, 8, 28),
            assigned_to="S. Khan",
            created_by="A. Rahman",
            assigned_by="A. Rahman",
            last_action="LOI dispatched",
            body_text=(
                "Subject to final DG approval, SUPARCO intends to award supply of one S-band RF front-end kit against "
                "quotation AQ-7842 as clarified on 15 Jul 2026. Please confirm acceptance of LOI terms within seven days "
                "and prepare for purchase-order documentation."
            ),
            attachment="SUPARCO_LOI_AQ-7842.pdf",
        ),
        dict(
            number="VND/AQ/2026/031",
            letter_date=date(2026, 8, 22),
            received_date=date(2026, 8, 23),
            type="Incoming",
            subject="Acceptance of SUPARCO LOI for quotation AQ-7842",
            sender="AeroLink Systems Pvt Ltd",
            recipient="SUPARCO Procurement",
            department="Technical",
            priority="Important",
            status="Action in Progress",
            due_date=date(2026, 9, 5),
            assigned_to="S. Khan",
            created_by="A. Rahman",
            assigned_by="A. Rahman",
            last_action="Vendor LOI acceptance",
            body_text=(
                "AeroLink Systems gratefully accepts the Letter of Intent for AQ-7842. We confirm price, delivery, and "
                "warranty as previously stated. Bank guarantee draft will follow within five working days."
            ),
            attachment="AeroLink_LOI_Acceptance.pdf",
        ),
    ]

    created: dict[str, Letter] = {}
    for spec in thread_specs:
        attachment = spec.pop("attachment", None)
        body = spec.pop("body_text", "")
        letter = Letter(**spec, body_text=body, remarks="Procurement thread sample")
        db.add(letter)
        db.flush()
        created[letter.number] = letter
        if attachment:
            _seed_dummy_attachment(
                db,
                letter_id=letter.id,
                filename=attachment,
                document_type="Quotation" if "Quotation" in attachment or "quotation" in attachment.lower() else "Supporting Document",
                uploaded_by=spec.get("assigned_to") or "S. Khan",
            )

    # Chain of relations (chronological story links)
    links = [
        ("VND/AQ/2026/001", "SUP/TEC/OUT/2026/221", "Clarification", "SUPARCO questions on AeroLink quote"),
        ("SUP/TEC/OUT/2026/221", "VND/AQ/2026/014", "Reply", "AeroLink answers clarifications"),
        ("VND/AQ/2026/001", "VND/OT/2026/088", "Related", "Competing OrbitTech quotation"),
        ("VND/OT/2026/088", "SUP/TEC/OUT/2026/238", "Clarification", "SUPARCO questionnaire to OrbitTech"),
        ("SUP/TEC/OUT/2026/238", "VND/OT/2026/095", "Reply", "OrbitTech questionnaire response"),
        ("VND/AQ/2026/001", "VND/SW/2026/041", "Related", "Late SkyWave EOI"),
        ("VND/AQ/2026/014", "SUP/TEC/INT/2026/052", "Follow-up", "Internal comparative evaluation"),
        ("VND/OT/2026/095", "SUP/TEC/INT/2026/052", "Related", "OrbitTech inputs into TEC memo"),
        ("SUP/TEC/INT/2026/052", "SUP/FIN/OUT/2026/119", "Reference", "Finance concurrence on evaluation"),
        ("SUP/FIN/OUT/2026/119", "SUP/PRC/OUT/2026/067", "Follow-up", "LOI after finance concurrence"),
        ("SUP/PRC/OUT/2026/067", "VND/AQ/2026/031", "Reply", "Vendor accepts LOI"),
        ("VND/AQ/2026/001", "SUP/PRC/OUT/2026/067", "Related", "Original quotation leads to LOI"),
    ]
    for frm, to, rel_type, remarks in links:
        a, b = created.get(frm), created.get(to)
        if a and b:
            db.add(
                LetterRelation(
                    from_letter_id=a.id,
                    to_letter_id=b.id,
                    relationship_type=rel_type,
                    created_by="S. Khan",
                    remarks=remarks,
                )
            )


def ensure_department_org_layout(db: Session) -> None:
    """Backfill org-chart positions, parents, and coordination links on existing DBs."""
    departments = {row.name: row for row in db.query(Department).all()}
    if not departments:
        return

    for name, (x, y) in DEPARTMENT_LAYOUT.items():
        row = departments.get(name)
        if not row:
            continue
        if (row.pos_x or 0) == 0 and (row.pos_y or 0) == 0:
            row.pos_x = x
            row.pos_y = y

    for child_name, parent_name in DEPARTMENT_PARENTS.items():
        child = departments.get(child_name)
        parent = departments.get(parent_name)
        if child and parent and child.parent_id is None:
            child.parent_id = parent.id

    if db.query(DepartmentLink).count() == 0:
        for source_name, target_name in DEPARTMENT_COORDINATION:
            source = departments.get(source_name)
            target = departments.get(target_name)
            if source and target:
                db.add(DepartmentLink(source_id=source.id, target_id=target.id, kind="coordinates"))


def ensure_master_document_types(db: Session) -> None:
    desired = MASTER_DATA.get("Document Types", [])
    existing = {
        row.value
        for row in db.query(MasterValue).filter(MasterValue.category == "Document Types").all()
    }
    for value in desired:
        if value not in existing:
            db.add(MasterValue(category="Document Types", value=value))


def ensure_master_statuses(db: Session) -> None:
    """Add Phase 4 workflow statuses to existing databases without re-seeding letters."""
    desired = MASTER_DATA["Statuses"]
    existing = {
        row.value
        for row in db.query(MasterValue).filter(MasterValue.category == "Statuses").all()
    }
    for value in desired:
        if value not in existing:
            db.add(MasterValue(category="Statuses", value=value))


_AVATAR_PALETTE = (
    ((37, 99, 235), (29, 78, 216)),      # blue
    ((5, 150, 105), (4, 120, 87)),       # emerald
    ((8, 145, 178), (14, 116, 144)),     # cyan
    ((79, 70, 229), (67, 56, 202)),      # indigo
    ((180, 83, 9), (146, 64, 14)),       # amber
    ((190, 24, 93), (157, 23, 77)),      # rose
    ((71, 85, 105), (51, 65, 85)),       # slate
    ((13, 148, 136), (15, 118, 110)),    # teal
)


def _avatar_initials(name: str) -> str:
    parts = [p for p in name.replace(".", "").split() if p]
    if not parts:
        return "U"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[1][0]}".upper()


def _render_seed_avatar_png(name: str, username: str) -> bytes:
    """Generate a simple professional avatar PNG (initials on a soft gradient)."""
    from io import BytesIO

    from PIL import Image, ImageDraw, ImageFont

    size = 256
    idx = sum(ord(c) for c in (username or name)) % len(_AVATAR_PALETTE)
    c1, c2 = _AVATAR_PALETTE[idx]

    img = Image.new("RGB", (size, size), c1)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        r = int(c1[0] + (c2[0] - c1[0]) * t)
        g = int(c1[1] + (c2[1] - c1[1]) * t)
        b = int(c1[2] + (c2[2] - c1[2]) * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b))

    # Soft vignette ring
    inset = 10
    draw.ellipse([inset, inset, size - inset, size - inset], outline=(255, 255, 255, 40), width=3)

    initials = _avatar_initials(name)
    font = None
    for candidate in (
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        try:
            font = ImageFont.truetype(candidate, 92)
            break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), initials, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1] - 4
    draw.text((x, y), initials, fill=(255, 255, 255), font=font)

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def ensure_seed_avatars(db: Session) -> int:
    """Assign generated profile photos to users that do not have one yet."""
    from app.storage_service import ensure_storage_dirs, save_avatar_bytes

    ensure_storage_dirs()
    updated = 0
    users = db.query(User).order_by(User.id).all()
    for user in users:
        if (user.avatar_key or "").strip():
            continue
        png = _render_seed_avatar_png(user.name or user.username, user.username)
        user.avatar_key = save_avatar_bytes(
            user_id=user.id,
            content=png,
            filename=f"{user.username or user.id}-avatar.png",
        )
        updated += 1
    return updated
