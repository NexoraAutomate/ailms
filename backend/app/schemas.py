from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def empty_to_none(value: object) -> object:
    return None if value == "" else value


class LetterOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    number: str
    letterDate: str
    receivedDate: str
    type: str
    subject: str
    from_: str = Field(serialization_alias="from")
    to: str
    department: str
    priority: str
    status: str
    dueDate: str
    assignedTo: str
    lastAction: str
    daysPending: int
    confidentiality: str = "Normal"
    actionRequired: str = ""
    remarks: str = ""
    completionDate: str = "—"
    isArchived: bool = False
    baseStatus: str = ""


class LetterCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    number: str
    letterDate: date
    receivedDate: date | None = None
    type: str = "Incoming"
    subject: str
    from_: str = Field(default="", alias="from")
    to: str = ""
    department: str = ""
    priority: str = "Routine"
    status: str = "Registered"
    dueDate: date | None = None
    assignedTo: str = ""
    lastAction: str = "Registered"
    confidentiality: str = "Normal"
    actionRequired: str = ""
    remarks: str = ""

    @field_validator("receivedDate", "dueDate", mode="before")
    @classmethod
    def blank_dates(cls, value: object) -> object:
        return empty_to_none(value)


class LetterUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    number: str | None = None
    letterDate: date | None = None
    receivedDate: date | None = None
    type: str | None = None
    subject: str | None = None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    department: str | None = None
    priority: str | None = None
    status: str | None = None
    dueDate: date | None = None
    assignedTo: str | None = None
    lastAction: str | None = None
    confidentiality: str | None = None
    actionRequired: str | None = None
    remarks: str | None = None

    @field_validator("letterDate", "receivedDate", "dueDate", mode="before")
    @classmethod
    def blank_dates(cls, value: object) -> object:
        return empty_to_none(value)


class LetterStatusUpdate(BaseModel):
    status: str


class LetterActionCreate(BaseModel):
    action: str
    remarks: str = ""
    createdBy: str = "A. Rahman"


class LetterActionOut(BaseModel):
    id: int
    letterId: str
    action: str
    remarks: str
    createdBy: str
    createdAt: datetime


class LetterDeleteChallengeIn(BaseModel):
    letterIds: list[int] = Field(min_length=1)


class LetterDeleteChallengeOut(BaseModel):
    confirmationCode: str
    letterIds: list[int]
    expiresInSeconds: int


class LetterDeleteIn(BaseModel):
    letterIds: list[int] = Field(min_length=1)
    confirmationCode: str = Field(min_length=1)


class LetterDeleteOut(BaseModel):
    deleted: int
    letterIds: list[int]


class DepartmentIn(BaseModel):
    code: str
    name: str
    head: str = ""
    status: str = "Active"
    parentId: int | None = None
    posX: float = 0
    posY: float = 0


class DepartmentUpdateIn(BaseModel):
    code: str | None = None
    name: str | None = None
    head: str | None = None
    status: str | None = None
    parentId: int | None = None
    posX: float | None = None
    posY: float | None = None


class DepartmentOut(BaseModel):
    id: int
    code: str
    name: str
    head: str
    users: int
    pending: int
    status: str
    parentId: int | None = None
    posX: float = 0
    posY: float = 0


class DepartmentLinkIn(BaseModel):
    sourceId: int
    targetId: int
    kind: str = "coordinates"


class DepartmentLinkOut(BaseModel):
    id: int
    sourceId: int
    targetId: int
    kind: str


class OrganizationIn(BaseModel):
    name: str
    short: str = ""
    type: str = "Government"
    contact: str = ""
    email: str = ""
    phone: str = ""
    status: str = "Active"


class OrganizationOut(BaseModel):
    id: int
    name: str
    short: str
    type: str
    contact: str
    email: str
    phone: str
    status: str


class OrganizationUpdateIn(BaseModel):
    name: str | None = None
    short: str | None = None
    type: str | None = None
    contact: str | None = None
    email: str | None = None
    phone: str | None = None
    status: str | None = None


class UserIn(BaseModel):
    name: str
    username: str
    department: str = ""
    role: str = "Department/User"
    email: str = ""
    status: str = "Active"
    password: str | None = None


class UserUpdateIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    email: str | None = None
    department: str | None = None
    role: str | None = None
    status: str | None = None
    password: str | None = None


class UserOut(BaseModel):
    id: int
    name: str
    username: str
    department: str
    role: str
    email: str
    status: str
    activity: str
    created: str = ""


class LoginIn(BaseModel):
    username: str
    password: str


class SignupIn(BaseModel):
    name: str
    username: str
    password: str
    email: str = ""
    department: str = ""


class ChangePasswordIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    currentPassword: str
    newPassword: str


class AuthUserOut(BaseModel):
    id: int
    name: str
    username: str
    role: str
    department: str
    email: str
    status: str
    initials: str


class AuthTokenOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    accessToken: str
    tokenType: str = "bearer"
    expiresAt: str
    user: AuthUserOut


class MessageOut(BaseModel):
    message: str


class RoleIn(BaseModel):
    name: str
    description: str = ""


class RoleOut(BaseModel):
    id: int
    name: str
    description: str
    permissionCount: int = 0


class RolePermissionsIn(BaseModel):
    description: str | None = None
    permissions: dict


class StatusDefinitionIn(BaseModel):
    category: str
    name: str
    description: str = ""
    color: str = "#64748b"


class StatusDefinitionOut(BaseModel):
    id: int
    category: str
    name: str
    description: str
    color: str


class NotificationOut(BaseModel):
    id: int
    title: str
    description: str
    time: str
    priority: str
    read: bool
    letter: str
    notificationType: str = "System Notification"
    recipientName: str = ""
    relatedEntityType: str = ""
    relatedEntityId: str = ""
    readAt: str = ""
    navigateTo: str = ""
    navigateLabel: str = ""
    createdAt: str = ""


class NotificationSummaryOut(BaseModel):
    total: int
    unread: int
    byType: dict[str, int]


class AuditOut(BaseModel):
    date: str
    user: str
    module: str
    action: str
    record: str
    description: str
    source: str


class MasterValueIn(BaseModel):
    category: str
    value: str
    status: str = "Active"


class MasterValueUpdateIn(BaseModel):
    value: str | None = None
    status: str | None = None


class MasterValueOut(BaseModel):
    id: int
    category: str
    value: str
    status: str


class SettingsIn(BaseModel):
    organizationName: str | None = None
    systemName: str | None = None
    defaultDueDays: str | None = None
    currentUser: str | None = None


class SettingsOut(BaseModel):
    organizationName: str
    systemName: str
    defaultDueDays: str
    currentUser: str


class WorkflowExecuteIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    action: str
    remarks: str = ""
    assignedTo: str | None = None
    department: str | None = None
    actionLabel: str | None = None
    reviewerName: str | None = None
    escalatedTo: str | None = None
    escalationLevel: str | None = None


class WorkflowTransitionOut(BaseModel):
    id: int
    letterId: str
    action: str
    fromStatus: str
    toStatus: str
    performedBy: str
    remarks: str
    assignedTo: str
    department: str
    createdAt: str


class WorkflowActionOut(BaseModel):
    letterId: str
    currentStatus: str
    actions: list[str]


class ApprovalOut(BaseModel):
    id: int
    letterId: str
    documentId: int | None = None
    preparedBy: str
    reviewer: str
    submittedAt: str
    reviewedAt: str
    approvalStatus: str
    reviewerRemarks: str
    revisionNumber: int
    createdAt: str
    updatedAt: str


class ApprovalSubmitIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    reviewer: str | None = None
    documentId: int | None = None
    remarks: str = ""


class ApprovalReviewIn(BaseModel):
    decision: str
    remarks: str


class EscalationOut(BaseModel):
    id: int
    letterId: str
    actionId: int | None = None
    escalationLevel: str
    escalatedBy: str
    escalatedTo: str
    reason: str
    escalationDate: str
    targetResolutionDate: str
    resolutionDate: str
    remarks: str
    status: str
    createdAt: str
    updatedAt: str


class EscalationCreateIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    letterId: int
    actionId: int | None = None
    escalationLevel: str = "Level 1"
    escalatedTo: str
    reason: str = ""
    remarks: str = ""
    targetResolutionDate: date | None = None


class EscalationResolveIn(BaseModel):
    remarks: str = ""


class ReminderRunOut(BaseModel):
    lettersChecked: int
    notificationsCreated: int
    skippedDuplicates: int


class DocumentVersionOut(BaseModel):
    id: int
    documentId: str
    versionNumber: str
    parentVersionId: int | None = None
    filename: str
    originalFilename: str
    fileType: str
    mimeType: str
    fileSize: int
    uploadedBy: str
    uploadDate: str
    changeDescription: str
    status: str
    checksum: str
    isCurrent: bool
    previewable: bool


class DocumentOut(BaseModel):
    id: str
    letterId: str
    documentType: str
    status: str
    createdAt: str
    versionCount: int
    currentVersion: DocumentVersionOut | None = None


class StagedDocumentOut(BaseModel):
    """Response for POST /api/ai-registration/staged-documents."""

    stagedDocumentId: str
    originalFilename: str
    mimeType: str
    fileSize: int
    checksum: str
    createdAt: str


class AiRegistrationJobCreateIn(BaseModel):
    """Body for POST /api/ai-registration/jobs."""

    model_config = ConfigDict(populate_by_name=True)

    staged_document_id: str = Field(alias="stagedDocumentId")


class AiRegistrationJobCreateOut(BaseModel):
    """Response for POST /api/ai-registration/jobs."""

    jobId: str
    status: str
    stagedDocumentId: str


class AiRegistrationJobOut(BaseModel):
    """Response for GET /api/ai-registration/jobs/{id} and review actions."""

    jobId: str
    status: str
    stagedDocumentId: str
    letterId: str | None = None
    currentStage: str | None = None
    errorCode: str | None = None
    errorMessage: str | None = None
    proposal: dict | list | None = None
    validation: dict | None = None
    stagedDocument: dict | None = None
    evidence: list[dict] | None = None
    aiGenerated: list[str] | None = None
    userOverrides: dict | None = None
    reviewedBy: str | None = None
    workerEnabled: bool = False
    createdAt: str
    updatedAt: str | None = None
    startedAt: str | None = None
    ocrCompletedAt: str | None = None
    extractionCompletedAt: str | None = None
    reviewReadyAt: str | None = None
    completedAt: str | None = None


class AiRegistrationRejectIn(BaseModel):
    """Body for POST /jobs/{id}/reject."""

    reason: str = ""


class AiRegistrationApproveIn(BaseModel):
    """Body for POST /jobs/{id}/approve."""

    confirm: bool = True


class AiRegistrationApproveOut(BaseModel):
    """Response for POST /jobs/{id}/approve (spec 08)."""

    letterId: str
    number: str
    jobId: str
    status: str
    warnings: list[str] = []


class MeetingParticipantIn(BaseModel):
    name: str
    department: str = ""


class MeetingCreateIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str
    meetingDate: date = Field(alias="date")
    startTime: str = "09:00"
    endTime: str = "10:00"
    location: str = ""
    chairperson: str = ""
    agenda: str = ""
    minutes: str = ""
    status: str = "Scheduled"
    participants: list[MeetingParticipantIn] = []


class MeetingUpdateIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str | None = None
    meetingDate: date | None = Field(default=None, alias="date")
    startTime: str | None = None
    endTime: str | None = None
    location: str | None = None
    chairperson: str | None = None
    agenda: str | None = None
    minutes: str | None = None
    status: str | None = None


class MeetingActionOut(BaseModel):
    id: int
    meetingId: str
    actionDescription: str
    responsiblePerson: str
    department: str
    priority: str
    dueDate: str
    status: str
    remarks: str
    completionDate: str


class MeetingOut(BaseModel):
    id: str
    title: str
    date: str
    startTime: str
    endTime: str
    location: str
    chairperson: str
    agenda: str
    minutes: str
    status: str
    createdBy: str
    participants: list[dict]
    actions: list[MeetingActionOut]
    letterIds: list[str]
    createdAt: str
    updatedAt: str


class MeetingActionCreateIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    actionDescription: str
    responsiblePerson: str = ""
    department: str = ""
    priority: str = "Routine"
    dueDate: date | None = None
    status: str = "Open"
    remarks: str = ""


class MeetingActionUpdateIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    actionDescription: str | None = None
    responsiblePerson: str | None = None
    department: str | None = None
    priority: str | None = None
    dueDate: date | None = None
    status: str | None = None
    remarks: str | None = None


class CorrespondenceRelationCreateIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fromLetterId: int
    toLetterId: int
    relationshipType: str
    remarks: str = ""


class CorrespondenceRelationOut(BaseModel):
    id: int
    fromLetterId: str
    toLetterId: str
    relationshipType: str
    createdBy: str
    remarks: str
    createdAt: str


class CorrespondenceThreadNodeOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    number: str
    letterDate: str
    type: str
    from_: str = Field(validation_alias="from", serialization_alias="from")
    to: str
    subject: str
    status: str
    assignedTo: str
    actionStatus: str


class CorrespondenceThreadOut(BaseModel):
    rootLetterId: str
    nodes: list[CorrespondenceThreadNodeOut]
    edges: list[dict]
    relations: list[CorrespondenceRelationOut]
