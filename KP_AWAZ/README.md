# KP Awaz Frontend

The frontend is organized so visual sections, interaction logic, data, and backend communication can evolve independently.

## Run locally

The frontend now uses the real FastAPI backend. Start both applications in separate terminals.

Install the frontend packages first. This also generates the local Supabase browser vendor module:

```bash
npm install
```

### Terminal 1 — Backend

```bash
cd KP_AWAZ/backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

### Terminal 2 — Frontend

```bash
cd KP_AWAZ
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

The separate administrator review page is available at
`http://127.0.0.1:4173/admin.html`. Enter the value configured as
`ADMIN_API_KEY` in the running backend; never place a real key in source code or
documentation.

Backend Swagger is available at `http://127.0.0.1:8000/docs`, and backend health is available at `http://127.0.0.1:8000/api/health`.

The backend must be running for real sentence prompts and recording submissions to work. Frontend mock mode is disabled in `scripts/config.js`.

Do not open `index.html` directly. The development page loads HTML section partials over HTTP.

## Project structure

```text
KP_AWAZ/
├── index.html                 # Small page shell
├── admin.html                 # Isolated contribution-review page
├── sections/                  # One HTML partial per visible section
├── styles/                    # Foundation, section and responsive CSS
├── scripts/
│   ├── app.js                 # Application bootstrap
│   ├── config.js              # API environment switch
│   ├── data/                  # Temporary frontend datasets
│   ├── modules/               # Navigation, FAQ, recorder and contribution UI
│   └── services/              # All backend communication
├── assets/images/             # Logos and future images
├── docs/                      # Architecture and API contracts
└── tools/                     # Production and Supabase vendor build scripts
```

## Production build

```bash
npm run build
```

This creates `dist/`, assembles all contributor HTML partials, includes the
standalone `admin.html`, generates the browser-compatible Supabase vendor
module, and copies the runtime assets. Development stays modular while
production avoids client-side partial requests.

The focused vendor bundle can also be regenerated directly with:

```bash
npm run build:supabase
```

It is generated from the installed official `@supabase/supabase-js` package. The generated source vendor directory and `node_modules` are not committed.

## Backend connection

The active API URL and mock-mode switch are centralized in `scripts/config.js`. Update `baseUrl` there when the API is hosted somewhere other than the local FastAPI address.

UI modules must not call `fetch` directly. Add or update calls in `scripts/services/` so backend changes remain isolated.

## Authentication interface

The header provides a visible account control. Signed-out users can continue with Google or request an email magic link from the authentication dialog. Email authentication does not use or request a password.

Supabase manages browser session persistence, URL-session detection, and token refresh. Returning from a Google or email redirect uses the same startup flow to restore the session. The frontend keeps the complete session internal and sends only its access token to FastAPI for identity verification through `GET /api/auth/me`. The account interface is displayed as fully signed in only after that backend verification succeeds.

Google sign-in requires the Google provider to be enabled and configured in the Supabase dashboard before live use. Email magic links require the frontend return address to be present in the project's allowed redirect URLs. For local development, the configured redirect is `http://127.0.0.1:4173/`.

Frontend authentication uses only the Supabase project URL and publishable key. A service-role key must never appear in frontend configuration, browser code, logs, or production files.

Authentication configuration is centralized under `appConfig.auth` in `scripts/config.js` with these fields:

```text
supabaseUrl
supabasePublishableKey
redirectUrl
```

When `redirectUrl` is blank, the application uses the current website origin and application root. Empty Supabase configuration does not stop navigation or FAQ features from initializing, but recording remains unavailable until authentication is configured and the user is verified.

## Profile settings

After Supabase restores or creates a session, FastAPI verifies the signed-in user before the frontend requests profile data. The first authenticated `GET /api/profile/me` automatically creates that user's local application profile when one does not already exist.

Profile settings are available inside the signed-in account dialog. Users can edit their display name, preferred language, and whether their display name may appear on the public leaderboard. Leaderboard visibility is private by default. The profile form includes loading, retry, validation, save, and no-change feedback without blocking the rest of the site.

Supabase remains responsible for authentication and browser session management. FastAPI stores only application-specific profile preferences and the safe identity metadata needed to associate the profile with the verified Supabase user. Access tokens are not stored in the profile table or in profile UI state.

## Authenticated contributions

Guided and open contribution recording now requires a signed-in user whose Supabase session has been verified by FastAPI. Signed-out users see a sign-in prompt, recording controls remain unavailable, and microphone permission is not requested. Signing out during a recording releases the microphone and discards unsent audio.

Uploads send the current access token only in the `Authorization: Bearer` header. The frontend never sends a user ID or profile ID. FastAPI derives ownership exclusively from the verified token, creates or synchronizes the local profile when needed, and stores the verified profile ID with new contribution metadata. The two contributions created before ownership support remain unowned legacy records.

New submissions enter a private pending-review queue. Review actions are
protected by the backend admin key and are available only through the separate
administrator page described below. Approved contribution statistics and the
privacy-safe public leaderboard are calculated dynamically by the backend.
Approved owned contributions also receive private append-only points. Rewards
are not implemented yet.

Signed-in users can view their private submission history in the **My Contributions** area of the account dialog. The interface loads ten results at a time from `GET /api/contributions/me`, supports refresh, retry, and Load more, and refreshes the first page automatically after a successful guided or open-recording upload. History is requested only after FastAPI verifies the current Supabase session.

The backend filters history by the identity derived from the bearer token. The frontend neither sends nor accepts a user ID for history requests, so one account cannot select or view another account's contributions. The two legacy unowned contributions do not appear in any user's history. Audio playback is not included because the history response does not provide a safe playable URL. Audio files remain separate from SQLite; SQLite stores their safe relative keys, contribution metadata, and nullable ownership.

## Contribution statistics and public leaderboard

Authenticated users can retrieve only their own dynamic review counts with:

```bash
curl \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  "http://127.0.0.1:8000/api/profile/me/statistics"
```

`GET /api/profile/me/statistics` returns total, pending, approved, and rejected
contribution counts together with the current leaderboard opt-in choice,
eligibility, and public rank. FastAPI derives ownership from the verified token;
the endpoint does not accept a user ID.

The public backend leaderboard requires no login:

```bash
curl "http://127.0.0.1:8000/api/leaderboard?limit=20&offset=0"
```

A profile is eligible only when it has opted in and owns at least one currently
approved contribution. Pending, rejected, opted-out, and legacy unowned
contributions are excluded by the database query. Entries are ordered by
approved contribution count descending, with dense ranks for ties and a stable
display-name order within each tie.

Only `rank`, `displayName`, and `approvedContributions` are public. Profile IDs,
emails, authentication providers, audio metadata, and private review counts are
never returned. Disabling leaderboard visibility removes the profile on the next
request without changing its recordings, ownership, review decisions, or private
statistics.

Counts are aggregated from the contribution rows on every request; mutable
counter columns are not stored in profiles. The public leaderboard continues to
rank approved contribution counts rather than points. A public leaderboard
frontend and rewards are not implemented yet.

## Private contribution points

One approved contribution owned by a verified profile equals one private point.
Pending and rejected contributions award no points, and legacy unowned
contributions are excluded. Leaderboard opt-out does not remove privately owned
points.

Points are recorded as immutable ledger events. Approval creates a `+1` award,
removing approval creates a `-1` reversal, and reapproval creates another `+1`
award. Existing approved owned contributions receive one idempotent backfill
event. Earlier entries are never edited or deleted, and balances are calculated
with `SUM(points_delta)` rather than stored on profiles.

Authenticated users can retrieve only their own balance and ledger history:

```bash
curl \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  "http://127.0.0.1:8000/api/profile/me/points?limit=20&offset=0"
```

`GET /api/profile/me/points` returns `balance`, paginated `items`, `total`,
`limit`, and `offset`. Items contain `id`, `entryType`, `pointsDelta`,
`contributionId`, and `createdAt`. They do not expose user IDs, emails, tokens,
review reasons, or audio paths.

The stored event types are represented by the API as `approvalAward`,
`approvalReversal`, and `approvedBackfill`.

### My Points

Signed-in users can view their private current balance and append-only point
history in the **My Points** area of the account dialog. History entries explain
approval awards, approval reversals, and the initial credit for contributions
that were already approved when the ledger was introduced. The interface loads
20 entries at a time and provides safe loading, empty, error, retry, refresh,
and Load more states. Refresh can be used to see point changes after a recent
administrator review.

One currently approved, owned contribution equals one point. Pending, rejected,
and legacy unowned contributions do not award points. The balance is always
calculated from immutable ledger entries rather than a mutable profile total,
so approval reversals remain visible in history even after a contribution is
approved again.

Point totals and history are private during this phase. The public leaderboard
continues to rank contributors by approved contribution count, not point
balance. Points currently have no monetary value. Rewards and redemption are
not implemented; there is no withdrawal, payment, transfer, or cash-value
feature.

## Administrator contribution review

The administrator interface is intentionally separate from the contributor
application and does not initialize Supabase login, profile settings, My
Contributions, or either recorder. To use it locally:

1. Start FastAPI and the frontend server using the commands above.
2. Open `http://127.0.0.1:4173/admin.html`.
3. Enter the backend's configured admin key at runtime.

The key is sent only in the `X-Admin-Key` request header and is kept only in the
admin module's memory for the current page session. It is not written to browser
storage, cookies, configuration, request URLs, or request JSON. Disconnecting,
refreshing, or closing the page clears it and requires entry again.

The workspace supports backend-filtered pending, approved, rejected, and all
queues; 20-item page navigation; safe contribution metadata; protected Blob
audio playback; approval; rejection with a required reason; and correction of
earlier decisions. Audio object URLs are revoked when changing or closing the
selection, disconnecting, or destroying the page module. There is no public
audio URL or download action, and rejected recordings remain stored.

This is temporary internal API-key administration, not an admin-account system.
The public leaderboard currently has a backend endpoint only; no public
leaderboard interface exists yet.

## Recording behavior

Guided recordings have a maximum duration of 60 seconds. Open recordings have a maximum duration of 5 minutes. Recording stops automatically at the configured limit, and the completed recording remains available for playback and submission.

Available recording formats depend on the browser's `MediaRecorder` support. The frontend prefers WebM with Opus, followed by WebM, OGG with Opus, OGG, and MP4. It uses the recorder's actual Blob MIME type to generate matching upload filenames such as `recording.webm`, `recording.ogg`, `recording.wav`, `recording.mp3`, or `recording.m4a`.

No client-side audio conversion is performed.
