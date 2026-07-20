# KP AWAZ production deployment guide

This guide prepares a release but does not deploy it. Use placeholders and a
hosting secret manager; never put server credentials in Git, frontend build
variables, images, URLs, or deployment logs.

## Architecture and software

- Static frontend: Node.js 24 and npm 11 build 14 HTML pages into `dist/`.
- API: Python 3.13, FastAPI, Uvicorn, and one writable backend process.
- Metadata: one persistent SQLite file, conceptually `/data/database/kp_awaz.db`.
- Recordings: private persistent raw audio at `/data/audio/raw`, organized by
  year and month. Existing legacy recordings remain on a separate private mount.
- Supabase: hosted authentication; the browser receives only the URL and
  publishable key. Phrase state, snapshots, ownership, consent, withdrawal,
  review decisions, points, leaderboard preference, and audio metadata remain
  in SQLite.

SQLite is intentionally retained for Stage A. Run only one backend writer. Do
not horizontally scale writable API instances until the metadata database is
migrated to a service designed for that topology.

## Backend environment

Required in production:

```text
ENVIRONMENT
DATABASE_URL
RAW_AUDIO_STORAGE_ROOT
STORAGE_ROOT
AUDIO_STORAGE_SUBDIRECTORY
FRONTEND_BASE_URL
FRONTEND_ORIGINS
MAX_AUDIO_UPLOAD_BYTES
ADMIN_API_KEY
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
```

Supported operational settings with safe bounded defaults:

```text
APP_NAME
API_PREFIX
MAX_IMPORT_FILE_SIZE_MB
MIN_IMPORTED_SENTENCE_LENGTH
MAX_IMPORTED_SENTENCE_LENGTH
SUPABASE_AUTH_TIMEOUT_SECONDS
SUPABASE_ADMIN_TIMEOUT_SECONDS
SUPABASE_ADMIN_USERS_PER_PAGE
SUPABASE_ADMIN_MAX_PAGES
ACCOUNT_STATUS_RATE_LIMIT
ACCOUNT_STATUS_RATE_WINDOW_SECONDS
```

Use `ENVIRONMENT=production`, an absolute file-backed SQLite URL such as
`sqlite:////data/database/kp_awaz.db`, an absolute raw-audio root such as
`/data/audio/raw`, an HTTPS `FRONTEND_BASE_URL`, and a comma-separated list of
explicit HTTPS `FRONTEND_ORIGINS`. Production startup rejects missing server
configuration, local origins, relative/inside-image persistence, weak admin
keys, and wildcard origins without printing configured values.

Generate the admin key once and save it in the hosting secret manager:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

The admin browser keeps this key in page memory only, sends it in
`X-Admin-Key`, clears it on disconnect/unload, and never puts it in a URL or
browser storage. Do not generate a replacement on every restart.

## Frontend build

The public build variables are:

```text
KP_AWAZ_BUILD_ENV
KP_AWAZ_API_BASE_URL
KP_AWAZ_FRONTEND_BASE_URL
KP_AWAZ_SUPABASE_URL
KP_AWAZ_SUPABASE_PUBLISHABLE_KEY
KP_AWAZ_APP_VERSION
KP_AWAZ_API_TIMEOUT_MS
KP_AWAZ_AUDIO_UPLOAD_TIMEOUT_MS
```

Set the environment to `production`, use HTTPS API/frontend/Supabase URLs, and
build:

```bash
npm ci
npm run build
npm run scan:secrets
```

The build fails before replacing `dist/` when required public configuration is
missing. The default JSON request timeout is 20 seconds; original-audio uploads
use a separate 120-second timeout. Deploy `dist/` atomically. Serve HTML and
`scripts/config.js` with `Cache-Control: no-cache`; use revalidation for current
script/style/image names and purge the CDN on each `KP_AWAZ_APP_VERSION`
release. Do not mark non-fingerprinted assets immutable.

The build includes `index`, `about`, `data-use`, `how-it-works`, `leaderboard`,
`auth`, `forgot-password`, `reset-password`, `dashboard`, `contribute`,
`my-contributions`, `profile`, `settings`, and `admin` pages, plus local cultural
images, KP AWAZ logos, and the Google logo.

## Backend install and start

Without Docker:

```bash
cd backend
python3.13 -m venv .venv
.venv/bin/pip install -r requirements-prod.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --no-server-header
```

With Docker, build from the `KP_AWAZ` directory:

```bash
docker build -f backend/Dockerfile -t kp-awaz-api:<release> .
```

Run the image as its non-root user with one worker, inject environment through
the platform secret manager, and mount persistent volumes at:

```text
/data/database
/data/audio/raw
/data/legacy-storage/audio
```

The image contains no `.env`, development database, raw audio, test suite, or
frontend secret. Never deploy SQLite or recordings only in the container layer.
Monitor volume capacity/inodes and alert before either database or audio storage
is exhausted. Audio stays private and is played through protected backend admin
routes, not a public static server.

## Supabase and Google dashboard setup

In Supabase Auth URL Configuration:

- Site URL: `https://<frontend-domain>`.
- Redirect allow list:
  `https://<frontend-domain>/auth.html`,
  `https://<frontend-domain>/dashboard.html`,
  `https://<frontend-domain>/forgot-password.html`, and
  `https://<frontend-domain>/reset-password.html`.
- Email provider: enable signup and Confirm Email, use a six-digit OTP, and make
  the confirm-signup email template render `{{ .Token }}`. Keep configured SMTP
  credentials in Supabase/SMTP secret storage.
- Google provider: enable it and use
  `https://<project-ref>.supabase.co/auth/v1/callback` as the Google Cloud
  authorized redirect URI. Keep required test users while the Google consent
  screen is in Testing mode.

Set the frontend build's final dashboard and reset destinations through
`KP_AWAZ_FRONTEND_BASE_URL`. Store `SUPABASE_SECRET_KEY` only in the backend
hosting secret manager. The publishable key is the only browser key.

## CORS and proxy

`FRONTEND_ORIGINS` accepts one or more comma-separated origins, not paths. Use
only final HTTPS origins. The API permits credentials with explicit `GET`,
`POST`, `PATCH`, and `OPTIONS` methods and the `Accept`, `Authorization`,
`Content-Type`, and `X-Admin-Key` headers. It never reflects an unapproved
request origin. Terminate TLS at the hosting proxy and forward requests to port
8000. Keep authorization/admin headers out of proxy logs.

## Health, readiness, and smoke checks

- `GET /api/health`: process liveness only.
- `GET /api/readiness`: read-only database connection and database/audio
  directory accessibility. Responses contain no paths, secrets, or data counts.

After each release verify: all 14 frontend pages and local assets return 200;
health/readiness succeed; public sentences and leaderboard succeed;
unauthenticated private routes reject; missing/incorrect admin keys reject;
configured persistent mounts are active; a permitted CORS preflight succeeds;
login redirects use the production domain. Do not place a real admin key in a
shell history, URL, screenshot, or shared report.

## Storage inspection

All commands are read-only:

```bash
cd backend
.venv/bin/python -m app.cli.storage_health --include-checksums
.venv/bin/python -m app.cli.audio_inventory --include-checksums
.venv/bin/python -c "import sqlite3; c=sqlite3.connect('file:/data/database/kp_awaz.db?mode=ro', uri=True); print(c.execute('PRAGMA integrity_check').fetchone()[0])"
```

`storage_health` reports SQLite integrity, aggregate active/inactive phrase
counts, missing/orphan/zero-byte audio, formats, and counts without paths,
phrase text, or contributor data. Investigate warnings manually. These tools do
not delete, repair, seed, import, or alter records.

## Backup and restore

Pause API writes and uploads (or stop the single backend) for a database/audio
point-in-time backup. Choose a destination outside all active database/audio
directories and outside the application image:

```bash
cd backend
.venv/bin/python -m app.cli.backup_data \
  --output /secure-backups/kp-awaz/<timestamp>
```

The command uses SQLite's backup API, copies supported raw and legacy original
audio bytes, verifies source stability, verifies copied SQLite integrity and
SHA-256 checksums, and writes a safe JSON manifest. It excludes `.env` and all
credentials. Transfer backups to encrypted, access-controlled, lifecycle-managed
storage and test restoration regularly.

Restore only while the API is stopped, to new unused destinations:

```bash
cd backend
.venv/bin/python -m app.cli.restore_data \
  --backup /secure-backups/kp-awaz/<timestamp> \
  --database-destination /restore/database/kp_awaz.db \
  --raw-audio-destination /restore/audio/raw \
  --legacy-audio-destination /restore/legacy/audio \
  --confirm-restore
```

Restore refuses existing destinations, verifies every checksum before copying,
and runs SQLite integrity after copying. Review the restored storage offline,
then change mounts/configuration during a controlled maintenance window. It
never overwrites the active production paths automatically.

## Rollback

Keep the previous immutable frontend release and backend image. For an
application-only regression, stop the new API, restore the prior image with the
same persistent volumes, and atomically restore the prior static release. Do not
roll back the database unless a reviewed data migration requires it; Stage A has
no automatic destructive migrations. If storage restoration is required, use a
verified backup, new destinations, and the maintenance procedure above.

Before proceeding to deployment, record the hosting provider, final frontend
and API domains, TLS/proxy behavior, persistent-volume mount details and backup
retention, secret-manager ownership, deployment credentials, monitoring, and
rollback operator.
