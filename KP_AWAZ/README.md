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
├── assets/images/             # Brand and culturally rooted page imagery
├── docs/                      # Architecture and API contracts
└── tools/                     # Production and Supabase vendor build scripts
```

The main-page hero uses the locally stored, optimized
`assets/images/kp-community-voice-hero.jpg` illustration. Its arched responsive
crop connects community voice recording with the people, landscape, materials,
and warmth of Khyber Pakhtunkhwa while keeping the existing earthy palette.

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

The header provides a visible account control. Signed-out users can continue
with Google or request a six-digit email sign-in code from the authentication
dialog. Email authentication does not use or request a password.

Supabase manages browser session persistence, Google URL-session detection, and
token refresh. The email template must render `{{ .Token }}` so the user can
enter the delivered code in the second dialog step. The frontend requests codes
with `shouldCreateUser: true`, verifies them with OTP type `email`, reloads the
resulting Supabase session, and then runs the existing FastAPI `GET /api/auth/me`
verification. The account interface is displayed as fully signed in only after
that backend verification succeeds.

Email codes are held only by the OTP input while needed. They are cleared after
success, cancellation, sign-out, email changes, and UI destruction; they are
never written to browser storage, URLs, logs, or FastAPI requests. Resending
uses the same normalized email and becomes available after a 60-second
cooldown.

Google sign-in requires the Google provider to be enabled and configured in the
Supabase dashboard before live use. Its redirect behavior is unchanged. For
local development, the configured Google redirect is
`http://127.0.0.1:4173/`.

Google OAuth and email OTP are independent entry methods. **Continue with
Google** calls only Google's normal OAuth flow; KP AWAZ does not request or
verify an email OTP, force an account chooser, force repeated consent, add
unnecessary scopes, or retain Google provider tokens. Google may still show its
own chooser or consent screen when Google considers it necessary. After either
method succeeds, the same restored Supabase session, FastAPI `/api/auth/me`
verification, profile loading, and private navigation lifecycle is used.

If the Google OAuth application is still in Testing mode, every account used
for testing must be added manually under **Google Cloud → Google Auth Platform
→ Audience → Test users**. Test users are not managed by application code, and
Google client secrets must never be placed in frontend files.

### Required Supabase email-code configuration

The hosted Supabase project must be configured manually to match the six-digit
interface:

1. Set the email OTP length to `6`.
2. In the sign-in email template, render `{{ .Token }}` as the code.
3. Remove `{{ .ConfirmationURL }}` and `{{ .TokenHash }}` from that template.
4. Keep custom SMTP configured so recipients outside the Supabase project team
   can receive codes.

Never place SMTP usernames, passwords, provider API keys, project secrets, or
real OTP values in code, tests, documentation examples, or frontend
configuration. The application accepts the six-digit token only in the
in-memory input; `TokenHash` is neither displayed nor accepted.

Frontend authentication uses only the Supabase project URL and publishable key. A service-role key must never appear in frontend configuration, browser code, logs, or production files.

Authentication configuration is centralized under `appConfig.auth` in `scripts/config.js` with these fields:

```text
supabaseUrl
supabasePublishableKey
redirectUrl
```

When `redirectUrl` is blank, Google OAuth uses the current website origin and
application root. Empty Supabase configuration does not stop navigation or FAQ
features from initializing, but recording remains unavailable until
authentication is configured and the user is verified.

### Header private navigation

Signed-out visitors see Home, Contribute, Leaderboard, and Sign in. After
FastAPI verifies the session, the header adds a separate **My Contributions**
control and changes Sign in to the user's compact profile name. The profile-name
control opens the dedicated Account section; My Contributions opens only the
private recording history. Both use the existing single-page navigation and do
not open a new browser tab.

Sign-out hides both private destinations, clears their data, and returns the
website to a public section. Long profile names are truncated in the header
without changing the full saved display name.

Sign-out clears only the Supabase browser session and private in-memory UI. It
does not delete the local profile, profile preferences, contribution ownership,
recording files, review state, or point-ledger entries. Signing back in with the
same verified Supabase user ID restores that durable data. Google and email
accounts remain separate when Supabase gives them different user IDs; they
share data only when Supabase intentionally represents them as the same linked
identity.

## Profile settings

After Supabase restores or creates a session, FastAPI verifies the signed-in user before the frontend requests profile data. The first authenticated `GET /api/profile/me` automatically creates that user's local application profile when one does not already exist.

Profile settings are available in the dedicated signed-in **My Account**
section alongside the verified email when available, current score, and Sign
out. Users can edit their display name, preferred language, and whether their
display name may appear on the public leaderboard. Leaderboard visibility is
private by default. Contribution history is not rendered inside Account. The
profile form includes loading, retry, validation, save, and no-change feedback
without blocking the rest of the site.

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

Signed-in users can view their private submission history in its own **My
Contributions** section using the separate header control. The interface loads
ten results at a time from `GET /api/contributions/me` and preserves loading,
empty, safe error, retry, refresh, and Load more states. It does not preload the
history merely because a user signs in. A successful guided or open-recording
upload marks closed history as needing refresh, or refreshes it when the section
is already open.

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
rank approved contribution counts rather than points.

### Public Leaderboard

The contributor website includes a public **Leaderboard** section that requires
no login. It uses a structured semantic table with Rank, a bold Contributor
name, and Approved contributions columns. Compact rank badges are consistently
sized on desktop and mobile. The table loads 20 eligible contributors at a time
and provides loading, empty, safe error, retry, refresh, and Load more states.
Manual refresh reflects recent profile-privacy or administrator-review changes
without continuous polling.

Each public row displays only:

- Rank
- Display name
- Approved contribution count

The frontend respects the dense rank returned by FastAPI, including tied ranks,
and keeps duplicate display names as separate entries. Only contributors who
opt into leaderboard visibility and own at least one approved recording appear.
No user/profile identifiers, email, provider, review history, audio metadata, or
private contribution points are displayed.

Private scores remain available only to their signed-in owners in **My
Account**. Public ranking is based solely on currently approved contribution
count. Rewards are not implemented.

The section also loads a separate public top-three showcase with
`GET /api/leaderboard?limit=3&offset=0`. It remains public and visible after
sign-out. The semantic table below it remains the complete ranked view.

When a verified user opens Leaderboard, the frontend requests:

```http
GET /api/leaderboard/me/context?limit=20
```

FastAPI derives the current profile from the bearer token and returns the
bounded page containing that profile. Only the server-provided
`isCurrentUser` marker is used to highlight the row and add the **You** badge;
display names are never used as identity keys. Dense public rank remains
separate from deterministic row position, so tied users share rank while page
lookup remains stable. Opted-out users or users with no approved recordings
receive no public page, but see their own private approved count and an Account
link explaining how eligibility works. This authenticated response still
excludes user/profile IDs, emails, provider metadata, tokens, and audio data.

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

Authenticated users can retrieve only their own balance and ledger data:

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

### Account score

The contributor interface displays only the top-level backend `balance` in a
compact **Current score** card inside My Account. It requests the points endpoint
with `limit=1&offset=0`, does not calculate the score from the returned page,
and never renders or stores ledger items in UI state. The card provides loading,
safe error, retry, and refresh behavior with correct `point`/`points` wording.

The backend append-only ledger remains unchanged as the internal accounting
mechanism, but contributor-facing approval, reversal, backfill, date, delta,
and pagination cards are intentionally not displayed. One currently approved,
owned contribution equals one point; pending, rejected, and legacy unowned
contributions do not award points. Scores are private, have no monetary value,
and do not affect the public approved-contribution leaderboard.

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
The public leaderboard is available only on the contributor website and does
not initialize or share state with this administrator page.

## Recording behavior

Guided recordings have a maximum duration of 60 seconds. Open recordings have a maximum duration of 5 minutes. Recording stops automatically at the configured limit, and the completed recording remains available for playback and submission.

Available recording formats depend on the browser's `MediaRecorder` support. The frontend prefers WebM with Opus, followed by WebM, OGG with Opus, OGG, and MP4. It uses the recorder's actual Blob MIME type to generate matching upload filenames such as `recording.webm`, `recording.ogg`, `recording.wav`, `recording.mp3`, or `recording.m4a`.

No client-side audio conversion is performed.
