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

## Database storage

KP Awaz uses one active SQLite database at `backend/kp_awaz.db`. The default
database URL is resolved from the backend source directory, so starting Uvicorn
from `KP_AWAZ`, `KP_AWAZ/backend`, or the repository root does not create a
second database in the launch directory. An explicit `DATABASE_URL` environment
value still overrides this default.

User profiles, sentence data, import history, and contribution metadata are
stored in separate tables inside this single database. Recorded audio is not
stored in SQLite; audio files remain under backend storage while the database
holds only their relative storage keys and metadata.

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

## Supabase authentication foundation

Supabase Auth manages Google and email login. The frontend sends the current Supabase access token to FastAPI as:

```http
Authorization: Bearer <access-token>
```

FastAPI validates that token against the Supabase Auth user endpoint and uses only the verified user ID, email, and provider. The backend does not trust user IDs or email addresses supplied in form fields, and it does not log or store access tokens.

Configure the direct Auth client in `.env`:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_AUTH_TIMEOUT_SECONDS=5
```

Use only a Supabase publishable key for this flow. A service-role key must never be placed in frontend code or exposed to the browser.

Google OAuth and six-digit email OTP are separate frontend entry methods. The
Google action calls Supabase OAuth only and does not call the email OTP request
or verification methods. The email action requests and verifies a six-digit
`email` OTP in Supabase, then sends only the resulting access token to FastAPI.
The OTP itself, `TokenHash`, Google provider tokens, Google client secrets, and
SMTP credentials are never sent to or stored by this backend.

For hosted email login, configure the Supabase email template manually with
`{{ .Token }}`, remove `{{ .ConfirmationURL }}` and `{{ .TokenHash }}`, set OTP
length to `6`, and keep custom SMTP configured for external recipients without
committing its credentials. If Google OAuth remains in Testing mode, add test
accounts manually under **Google Cloud → Google Auth Platform → Audience → Test
users**.

The protected foundation endpoint is:

```http
GET /api/auth/me
```

With a real Supabase access token, it can be called with:

```bash
curl \
  -H "Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN" \
  http://127.0.0.1:8000/api/auth/me
```

A real token is obtained through the frontend login interface. Sentence endpoints remain public, contribution submission requires verified Supabase authentication, and existing admin endpoints continue to use `X-Admin-Key`.

## Local authenticated user profiles

Supabase remains responsible for authentication, session handling, and verified identity. FastAPI stores only application-specific profile preferences in the local `profiles` table. Each profile ID is exactly the verified Supabase user ID; it is never accepted from a profile request body or URL parameter.

The verified email and authentication provider are synchronized from Supabase whenever the profile is accessed. Users can edit their display name, preferred language, and future leaderboard visibility. Leaderboard visibility defaults to private (`false`). New contributions reference this profile using only the user ID derived from verified authentication.

Retrieve or automatically create the authenticated user's profile with:

```http
GET /api/profile/me
```

Update profile preferences with:

```http
PATCH /api/profile/me
```

For example:

```bash
curl -X PATCH \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Faisal Imran",
    "preferredLanguage": "Pashto",
    "leaderboardOptIn": true
  }' \
  http://127.0.0.1:8000/api/profile/me
```

Profile responses contain the verified ID, email, provider, preferences, and timestamps. Supabase access, refresh, and provider tokens are neither stored in the profile table nor returned by these endpoints.

## TXT import format

Sentence imports accept UTF-8 files with a `.txt` extension. Each nonblank line represents one phrase; blank lines are ignored. Duplicate phrases are detected using normalized text.

The default maximum file size is 5 MB, and valid phrases must contain between 3 and 500 characters.

## Import multiple TXT files

Use the protected multipart endpoint:

```http
POST /api/admin/sentences/import
```

It requires the `X-Admin-Key` header, a `language` form field, and one or more `files` fields:

```bash
curl -X POST \
  -H "X-Admin-Key: dev-change-this-key" \
  -F "language=Pashto" \
  -F "files=@phrases-one.txt;type=text/plain" \
  -F "files=@phrases-two.txt;type=text/plain" \
  http://127.0.0.1:8000/api/admin/sentences/import
```

Multiple UTF-8 TXT files are allowed. Blank lines are ignored, upload-level and existing-database duplicates are skipped, and invalid lines are counted. Accepted source files are stored under their batch directory using generated safe filenames.

The database import is committed only after every source file is stored successfully. On failure, database changes are rolled back and that batch's storage directory is removed; a separate failed `ImportBatch` record is not retained.

The development admin key must be changed outside local development.

## Audio storage foundation

The backend recognizes these audio MIME types and safe storage extensions:

| MIME type | Stored extension |
| --- | --- |
| `audio/webm` | `.webm` |
| `audio/ogg` | `.ogg` |
| `audio/wav` | `.wav` |
| `audio/x-wav` | `.wav` |
| `audio/mpeg` | `.mp3` |
| `audio/mp4` | `.m4a` |

An incoming `audio/mp4` filename may use `.m4a` or `.mp4`; storage consistently uses `.m4a`. A missing original extension is allowed when the MIME type and basic signature are valid.

Guided recordings default to a 15 MB maximum, while open recordings default to 50 MB. Files are stored using contribution UUIDs under date-based directories such as `storage/audio/2026/07/14/`. The database stores only a relative key such as `audio/2026/07/14/<contribution-id>.webm`; the safe original filename is metadata only. Timezone-aware timestamps are converted to UTC for directory selection, and naïve timestamps are treated as UTC.

Audio headers receive basic WebM, OGG, WAV, MP3, or MP4/M4A signature checks. These checks do not provide complete media validation, malware scanning, or proof that a file is decodable. FFmpeg is not required in this phase.

## Submit a guided voice contribution

Submit a guided recording with:

```http
POST /api/contributions/voice
```

The multipart fields are `contributorName`, `language`, `sentence`, `sentenceSource`, optional `sentenceId`, `consent`, and `audio`.

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "contributorName=Faisal Imran" \
  -F "language=Pashto" \
  -F "sentence=هر غږ ارزښت لري." \
  -F "sentenceSource=provided" \
  -F "consent=true" \
  -F "audio=@recording.webm;type=audio/webm" \
  http://127.0.0.1:8000/api/contributions/voice
```

`sentenceId` is currently optional for provided prompts. Custom sentences must not include it, and custom text is stored only as a contribution snapshot. Consent must resolve to true.

Audio is checked for supported MIME type, filename-extension consistency, guided size limit, and a basic matching signature. Successful submissions return HTTP 201. Audio uses the contribution UUID as its filename, while the database stores only a relative storage key. Ownership is taken exclusively from the verified Bearer token; multipart user or profile IDs are never trusted.

## Submit an open recording

Submit an open recording with:

```http
POST /api/contributions/open-recording
```

The required multipart fields are `contributorName`, `language`, `consent`, and `audio`. The `topic` field is optional; an omitted or blank topic is stored as null.

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "contributorName=Faisal Imran" \
  -F "language=Pashto" \
  -F "topic=زما د کلي یوه کیسه" \
  -F "consent=true" \
  -F "audio=@recording.webm;type=audio/webm" \
  http://127.0.0.1:8000/api/contributions/open-recording
```

Explicit consent is required. Open recordings use the configured larger open-recording size limit and the same MIME, filename-extension, size, and basic signature checks as guided recordings. Audio is stored privately using the contribution UUID, and the database stores only its relative storage key. Successful submissions return HTTP 201 with the public contribution ID, queued status, and UTC creation time.

## My Contributions API

Return the verified caller's contributions with:

```http
GET /api/contributions/me?limit=20&offset=0
```

```bash
curl \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  "http://127.0.0.1:8000/api/contributions/me?limit=20&offset=0"
```

The endpoint filters ownership in the database query, orders newest records first, and returns `items`, `total`, `limit`, and `offset`. It never accepts a user ID and excludes both other users' contributions and legacy rows whose `user_id` is null. The response contains safe contribution metadata but no storage keys, absolute paths, tokens, or owner IDs.

SQLite stores contribution metadata and nullable authenticated ownership in the `contributions` table. Actual audio remains under backend storage. Existing contributions created before ownership support remain intact and unowned. The frontend account dialog uses this private endpoint for its My Contributions interface and does not provide audio playback because the response has no playable URL.

## Admin contribution review

Every new guided or open-recording contribution begins with a separate `pending` review status. The SQLite compatibility step assigns the same pending status to existing contributions without changing their ownership, audio keys, submission metadata, or user-facing `queued` upload status. Legacy contributions whose `user_id` is null remain reviewable and are not assigned to an account.

All review routes require the configured admin key in the `X-Admin-Key` header:

```http
GET /api/admin/contributions?status=pending&limit=20&offset=0
GET /api/admin/contributions/{contribution_id}
GET /api/admin/contributions/{contribution_id}/audio
PATCH /api/admin/contributions/{contribution_id}/review
```

List filters support `pending`, `approved`, `rejected`, and `all`. Results are newest first and contain only safe review metadata. Owner UUIDs, email addresses, storage keys, absolute paths, and authentication secrets are excluded. The protected audio route validates the stored canonical audio key and serves the file inline only when it remains inside the configured private audio root; no public static audio route is enabled.

Use placeholder values when testing locally:

```bash
curl \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  "http://127.0.0.1:8000/api/admin/contributions?status=pending&limit=20&offset=0"

curl \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  "http://127.0.0.1:8000/api/admin/contributions/CONTRIBUTION_ID"

curl \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  "http://127.0.0.1:8000/api/admin/contributions/CONTRIBUTION_ID/audio"
```

Approval sets `reviewStatus` to `approved`, records the current UTC review time, and clears any earlier rejection reason:

```bash
curl -X PATCH \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"approved"}' \
  "http://127.0.0.1:8000/api/admin/contributions/CONTRIBUTION_ID/review"
```

Rejection requires a trimmed reason of at most 500 characters:

```bash
curl -X PATCH \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"rejected","rejectionReason":"Audio is too noisy to use."}' \
  "http://127.0.0.1:8000/api/admin/contributions/CONTRIBUTION_ID/review"
```

Administrators may correct a previous decision by submitting another valid approval or rejection. Rejected recordings are preserved. Review changes are reflected immediately in the dynamic statistics and public leaderboard described below.

### Local review interface

With this backend and the frontend server running, open:

```text
http://127.0.0.1:4173/admin.html
```

Enter the configured `ADMIN_API_KEY` at runtime. The frontend keeps it only in
memory, sends it only through `X-Admin-Key`, and clears it on disconnect or page
refresh. It is never stored in browser storage, placed in request URLs or JSON,
or added to frontend configuration.

The interface uses the protected routes above for backend-filtered queues,
pagination, safe contribution detail, Blob-based audio playback, approval,
rejection, and correction of a previous decision. Rejected audio remains stored.
The page does not expose owner IDs, emails, storage keys, filesystem paths, or a
public audio URL. Do not include a real admin key in documentation or source.

Rewards remain unimplemented.

## Personal contribution statistics

Return dynamic statistics belonging only to the verified caller with:

```http
GET /api/profile/me/statistics
```

```bash
curl \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  "http://127.0.0.1:8000/api/profile/me/statistics"
```

The response fields are:

```json
{
  "totalContributions": 3,
  "pendingContributions": 1,
  "approvedContributions": 2,
  "rejectedContributions": 0,
  "leaderboardOptIn": true,
  "leaderboardEligible": true,
  "publicRank": 1
}
```

The endpoint creates or synchronizes the local profile through the existing
profile service, then filters contributions by the verified Supabase user ID in
SQL. It never accepts a user ID from a URL, query, body, or custom header.
Opted-out users and users with zero approved contributions receive a null public
rank while retaining all private counts.

## Privacy-safe public leaderboard

The public endpoint requires no authentication:

```http
GET /api/leaderboard?limit=20&offset=0
```

```bash
curl "http://127.0.0.1:8000/api/leaderboard?limit=20&offset=0"
```

Eligibility requires both an opted-in profile and at least one approved
contribution owned by that profile. Pending and rejected contributions, legacy
rows without an owner, and opted-out profiles are excluded in the database
aggregation. Changing `leaderboardOptIn` takes effect on the next request without
altering ownership, audio, or review state.

Public items contain exactly:

```json
{
  "rank": 1,
  "displayName": "Faisal Imran",
  "approvedContributions": 3
}
```

No profile IDs, emails, authentication providers, preferred languages,
contribution IDs, or audio metadata are public. Results are ordered by approved
contribution count descending. Equal counts share the same dense rank, and
normalized display name plus an internal profile-ID tiebreaker provide stable
ordering without exposing that ID.

Counts and eligibility are calculated dynamically with SQL aggregation; profiles
do not store mutable contribution counters. The composite
`(review_status, user_id)` contribution index supports these filters. The public
leaderboard remains based on approved contribution counts and does not expose
the private points ledger. Rewards are not implemented; the contributor
frontend renders this API as a public podium and semantic table.

### Authenticated personal leaderboard context

The containing-page endpoint requires the same verified Supabase bearer token:

```http
GET /api/leaderboard/me/context?limit=20
```

It derives the current profile internally and returns `leaderboardOptIn`,
`leaderboardEligible`, a privacy-safe `currentUser` summary, `items`, `total`,
`limit`, and the calculated page `offset`. Eligible page items add only the
boolean `isCurrentUser`; exactly one item is marked. Ineligible users receive
their private approved count, a null rank, and an empty public page.

The query uses SQL aggregation plus `dense_rank()` for public ties and a
separate deterministic `row_number()` for containing-page lookup. It does not
load the complete contributor population into Python and never returns profile
IDs, user IDs, emails, authentication providers, tokens, contribution IDs, or
audio metadata.

Ending a browser session does not call a deletion endpoint. Profiles,
preferences, owned contributions, audio storage keys and files, review state,
and append-only ledger events remain durable and are restored when the same
verified Supabase user ID signs in again. Different Supabase user IDs remain
separate accounts even when their email text matches.

## Append-only contribution points

The current point rule is fixed:

```text
1 approved owned contribution = 1 point
```

Pending, rejected, legacy unowned, and orphaned contributions receive no points.
Leaderboard privacy does not affect private point ownership. Points always use
the profile ID stored on the contribution; display names and emails are never
used as ownership.

The `point_ledger_entries` table stores immutable positive and negative events.
Its internal entry types are:

| Entry type | Delta | Meaning |
| --- | ---: | --- |
| `approval_award` | `+1` | A non-approved contribution became approved |
| `approval_reversal` | `-1` | Approval was removed |
| `approved_backfill` | `+1` | One-time migration of an existing approved owned contribution |

Every entry references its contribution and the contribution's internal review
revision. A uniqueness rule on `(contribution_id, review_revision)` prevents a
retry from recording the same event twice. Review changes and their required
point entry commit in one transaction; a point failure rolls back the review.
Existing ledger rows are never updated or deleted.

Existing pending contributions initialize at review revision `0`. Existing
approved and rejected contributions initialize at revision `1`. Meaningful
review changes increment the revision; exact repeated decisions do not. The
startup compatibility process safely backfills one event for every existing
approved owned contribution and may be run repeatedly without duplication.

Balances are calculated dynamically with:

```text
SUM(point_ledger_entries.points_delta)
```

No point balance or total-points counter is stored in `profiles`.

### Personal points endpoint

Retrieve only the verified caller's private balance and paginated history with:

```http
GET /api/profile/me/points?limit=20&offset=0
```

```bash
curl \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  "http://127.0.0.1:8000/api/profile/me/points?limit=20&offset=0"
```

Example response:

```json
{
  "balance": 2,
  "items": [
    {
      "id": "LEDGER_ENTRY_ID",
      "entryType": "approvalAward",
      "pointsDelta": 1,
      "contributionId": "OWNED_CONTRIBUTION_ID",
      "createdAt": "2026-07-16T10:00:00Z"
    }
  ],
  "total": 2,
  "limit": 20,
  "offset": 0
}
```

API entry types are `approvalAward`, `approvalReversal`, and
`approvedBackfill`. The response excludes user IDs, emails, authentication
providers, admin credentials, tokens, audio metadata, rejection reasons, and raw
review metadata. There are no point mutation routes or public point endpoints.

The public leaderboard still ranks by approved contribution count. Points have
no monetary value, and no points frontend, rewards, payments, withdrawals, or
redemption features are implemented in this phase.

## Run tests

```bash
pytest
```

Tests create a separate temporary SQLite database and temporary storage path. They do not use `kp_awaz.db` or the development storage directories.
