# AILMS Backend

FastAPI service for the Correspondence Management System.

## Requirements

- Python 3.11+
- PostgreSQL 16 listening on port `5432` with the **pgvector** extension available
- Database name: `ailms` (created automatically on first start)

### pgvector (hybrid RAG)

On Windows/Linux, install the pgvector package for your Postgres major version, then restart Postgres. The API runs `CREATE EXTENSION IF NOT EXISTS vector` on startup and creates `cms_letter_chunks`.

```sql
-- Optional manual check
CREATE EXTENSION IF NOT EXISTS vector;
```

If startup fails on `cms_letter_chunks` / `vector`, install pgvector first (e.g. [pgvector install](https://github.com/pgvector/pgvector#installation)).

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

## Hybrid RAG (OpenAI demo → on-prem)

Register search (`POST /api/ai/search`) and the assistant (`POST /api/ai/chat`) use **keyword + vector hybrid retrieval** when enabled, then prompt the chat LLM with a shortlist of matches only.

### Demo (OpenAI embeddings)

In `backend/.env` (see `.env.example`):

```
EMBEDDING_ENABLED=true
EMBEDDING_PROVIDER=openai
EMBEDDING_DIMENSIONS=1536
EMBEDDING_OPENAI_MODEL=text-embedding-3-small
EMBEDDING_OPENAI_API_KEY=   # or rely on LLM_OPENAI_API_KEY
RAG_HYBRID_ENABLED=true
```

After letters have `body_text`, (re)build the index as an Administrator:

```http
POST /api/ai/reindex
{"force": true}
```

### On-prem later (Ollama / vLLM)

1. Pull an embedding model, e.g. `ollama pull nomic-embed-text`
2. Switch env (example):

```
EMBEDDING_PROVIDER=ollama
EMBEDDING_OLLAMA_MODEL=nomic-embed-text
EMBEDDING_DIMENSIONS=768
```

3. Restart the API (dimension change recreates `cms_letter_chunks`)
4. Call `POST /api/ai/reindex` with `{"force": true}` — old OpenAI vectors are incompatible

Chat can stay on `LLM_PROVIDER=openai` for demo or move to `ollama`/`vllm` independently; embeddings use `EMBEDDING_PROVIDER`.
