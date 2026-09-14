from sqlalchemy import create_engine, inspect, text

from app.config import get_settings

engine = create_engine(get_settings().database_url)
inspector = inspect(engine)
print("tables:", inspector.get_table_names())
for table in inspector.get_table_names():
    print(table, [column["name"] for column in inspector.get_columns(table)])
with engine.connect() as connection:
    for table in inspector.get_table_names():
        count = connection.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
        print("count", table, count)
