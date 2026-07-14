# KP Awaz API

This directory contains the FastAPI backend for KP Awaz. It provides environment-based settings, SQLAlchemy 2 database setup, SQLite support, CORS, health and sentence endpoints, seed data, and isolated backend tests.

## Move into the backend

```bash
cd KP_AWAZ/backend
```

## Create a virtual environment

```bash
python3 -m venv .venv
```

## Activate on macOS or Linux

```bash
source .venv/bin/activate
```

## Install dependencies

```bash
pip install -r requirements.txt
```

## Create the environment file

```bash
cp .env.example .env
```

Review the development values in `.env` before running the application. In particular, replace `ADMIN_API_KEY` before using a non-local environment.

## Run the backend

```bash
uvicorn app.main:app --reload
```

## Open the API

```text
http://127.0.0.1:8000
```

## Open Swagger documentation

```text
http://127.0.0.1:8000/docs
```

## Check the health endpoint

```text
http://127.0.0.1:8000/api/health
```

Expected response:

```json
{
  "status": "healthy",
  "service": "KP AWAZ API"
}
```

## Sentence API

Retrieve up to 20 random, active Pashto sentence prompts:

```http
GET /api/sentences?language=Pashto&limit=20
```

The language filter is case-insensitive. `limit` accepts values from 1 through 100. An empty result is returned as an empty `data` list.

Example response:

```json
{
  "data": [
    {
      "id": "sentence-uuid",
      "language": "Pashto",
      "text": "زما ژبه زما پېژندنه ده.",
      "meaning": "My language is my identity."
    }
  ]
}
```

## Seed sentences

From this backend directory, insert the initial Pashto prompts with:

```bash
python -m scripts.seed_sentences
```

The seed script is safe to run multiple times and skips duplicate sentences. Seed data is not inserted automatically when the API starts.

## Admin API authentication

Internal admin endpoints require the configured API key in the `X-Admin-Key` header. For local development, call the protected health check with:

```bash
curl \
  -H "X-Admin-Key: dev-change-this-key" \
  http://127.0.0.1:8000/api/admin/health
```

The development key comes from `ADMIN_API_KEY` in `.env`. Replace the example key outside local development and never commit a real API key to Git.

This API key is temporary internal authentication. A complete authentication system may replace it as the administration features grow.

## TXT import format

Future sentence imports will accept UTF-8 files with a `.txt` extension. Each nonblank line represents one phrase; blank lines are ignored. Duplicate phrases are detected using normalized text.

The default maximum file size is 5 MB, and valid phrases must contain between 3 and 500 characters. The upload endpoint will be implemented separately.

## Run tests

```bash
pytest
```

Tests create a separate temporary SQLite database and temporary storage path. They do not use `kp_awaz.db` or the development storage directories.
