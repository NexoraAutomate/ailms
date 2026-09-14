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


class DepartmentIn(BaseModel):
    code: str
    name: str
    head: str = ""
    status: str = "Active"


class DepartmentOut(BaseModel):
    code: str
    name: str
    head: str
    users: int
    pending: int
    status: str


class OrganizationIn(BaseModel):
    name: str
    short: str = ""
    type: str = "Government"
    contact: str = ""
    email: str = ""
    phone: str = ""
    status: str = "Active"


class OrganizationOut(BaseModel):
    name: str
    short: str
    type: str
    contact: str
    email: str
    phone: str
    status: str


class UserIn(BaseModel):
    name: str
    username: str
    department: str = ""
    role: str = "Department/User"
    email: str = ""
    status: str = "Active"


class UserOut(BaseModel):
    name: str
    username: str
    department: str
    role: str
    email: str
    status: str
    activity: str


class NotificationOut(BaseModel):
    id: int
    title: str
    description: str
    time: str
    priority: str
    read: bool
    letter: str


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
