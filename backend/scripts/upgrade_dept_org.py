from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_department_org_schema
from app.models import Department, DepartmentLink
from app.seed import ensure_department_org_layout

upgrade_department_org_schema(engine)
db = SessionLocal()
try:
    ensure_department_org_layout(db)
    db.commit()
    depts = db.query(Department).order_by(Department.id).all()
    links = db.query(DepartmentLink).count()
    print(f"departments={len(depts)} links={links}")
    for d in depts:
        print(f"  {d.id} {d.code} {d.name} parent={d.parent_id} pos=({d.pos_x},{d.pos_y})")
finally:
    db.close()
