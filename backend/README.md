# AILMS Backend

FastAPI service for the Correspondence Management System.

## Requirements

- Python 3.11+
- PostgreSQL 16 listening on port `5432`
- Database name: `ailms` (created automatically on first start)

## Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Update `.env` with your PostgreSQL username and password:

```
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=ailms
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
DOCUMENT_STORAGE_PATH=storage
```

Uploaded correspondence files are stored under `DOCUMENT_STORAGE_PATH` (default `backend/storage` when running from the backend folder). Only storage keys are persisted in PostgreSQL — not raw filesystem paths in API responses.

## Run

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API docs: http://127.0.0.1:8000/docs

The frontend at `../frontend` proxies `/api/*` to this service. Start it with `npm run dev` and open http://localhost:3000.

Application tables are created as `cms_*` inside the `ailms` database so they do not collide with any existing AILMS schema.
