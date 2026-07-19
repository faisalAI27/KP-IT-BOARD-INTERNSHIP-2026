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

Contributor pages are available at:

- `http://127.0.0.1:4173/auth.html` — password account creation, email
  verification, password sign-in, and Google sign-in
- `http://127.0.0.1:4173/dashboard.html` — authenticated overview
- `http://127.0.0.1:4173/contribute.html` — protected recording studio
- `http://127.0.0.1:4173/my-contributions.html` — private review history
- `http://127.0.0.1:4173/profile.html` — profile and leaderboard privacy
- `http://127.0.0.1:4173/settings.html` — preferences and account security

Opening a private page without a verified session redirects to `auth.html` and
returns to the requested page after sign-in.

The separate administrator review page is available at
`http://127.0.0.1:4173/admin.html`. Enter the value configured as
`ADMIN_API_KEY` in the running backend; never place a real key in source code or
documentation.

Backend Swagger is available at `http://127.0.0.1:8000/docs`, and backend health is available at `http://127.0.0.1:8000/api/health`.

The backend must be running for sentence prompts and recording submissions to work. Production frontend paths always use the real API.

Do not open `index.html` directly. The development page loads HTML section partials over HTTP.

## Project structure

```text
KP_AWAZ/
├── index.html                 # Public archive homepage
├── about.html                 # Mission and responsible-data page
├── how-it-works.html          # Contribution and scoring explanation
├── leaderboard.html           # Complete public rankings
├── auth.html                  # Dedicated contributor account entrance
├── forgot-password.html       # Password-recovery request
├── reset-password.html        # Verified recovery-session password update
├── dashboard.html             # Private contributor overview
├── contribute.html            # Private recording studio
├── my-contributions.html      # Private review-history page
├── profile.html               # Private identity and privacy page
├── settings.html              # Private preferences and security page
├── admin.html                 # Isolated contribution-review page
├── sections/                  # One HTML partial per visible section
├── styles/                    # Foundation, section and responsive CSS
├── scripts/
│   ├── app.js                 # Application bootstrap
│   ├── config.js              # API and browser-auth configuration
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

## Brand identity

The KP AWAZ logo system uses a cultural gateway, KP mountain peaks, and an
integrated voice waveform. Full-color, horizontal, stacked, icon-only, and
monochrome SVG assets live in `assets/images/`. Meaning, colors, minimum sizes,
accessibility, and frontend usage are documented in
[`docs/brand-identity.md`](docs/brand-identity.md).

## Production build

```bash
npm run build
```

This creates `dist/` and assembles every public, authentication, recovery,
contributor-workspace, and standalone administrator page,
generates the browser-compatible Supabase vendor module, and copies the runtime
assets. Development stays modular while production avoids client-side partial
requests.

The focused vendor bundle can also be regenerated directly with:

```bash
npm run build:supabase
```

It is generated from the installed official `@supabase/supabase-js` package. The generated source vendor directory and `node_modules` are not committed.

## Backend connection

The active API URL is centralized in `scripts/config.js`. Update `baseUrl` there when the API is hosted somewhere other than the local FastAPI address.

UI modules must not call `fetch` directly. Add or update calls in `scripts/services/` so backend changes remain isolated.

Authentication requests use a 12-second bound. Other API service requests use a
20-second bound and abort the browser request before showing a safe retry state.

## Authentication interface

The public site has no authentication modal. Signed-out **Start contributing**
links open `auth.html?next=contribute.html`; after successful authentication the
allowlisted destination opens. A restored verified session changes only the
public header actions—the homepage and other public pages remain available and
never redirect automatically. A verified contributor can choose Dashboard,
Account, or Start contributing explicitly.

`auth.html` provides the full account entrance. A new contributor supplies a
display name, email, and 8–72 character password. Supabase Auth creates the
credential account and sends a six-digit signup verification code. The page
verifies that code with OTP type `email`, obtains the resulting Supabase
session, and runs the same FastAPI `GET /api/auth/me` verification used by
Google and returning password sign-in. Only then does it save the initial display
name and enter `dashboard.html`. Returning contributors can sign in with email
and password; Google OAuth behavior is unchanged.

Before password signup, the browser sends only the normalized email to
`POST /api/auth/account-status`. FastAPI performs a server-only Supabase Auth
Admin lookup and returns only `accountExists`. A confirmed existing account
never reaches `signUp()` or the OTP screen; the contributor is guided to
password sign-in, the unchanged Google option, or password recovery. A new
email continues through the existing signup and six-digit verification flow.
If the lookup is unavailable or inconclusive, signup remains blocked and the
form offers a safe retry.

The current Admin list API is paginated. KP AWAZ checks at most 10 pages of up
to 1,000 users; reaching that bound is treated as unavailable rather than
incorrectly reporting that an account is new. The public endpoint is limited
to five checks per minute per direct client address in the current single
backend process. A horizontally scaled deployment should replace that
in-process guard with a shared limiter before increasing traffic.

Showing an exact existing-account message intentionally creates an account
enumeration tradeoff. Rate limiting, generic provider-neutral wording, a short
upstream timeout, strict input validation, and a boolean-only response reduce
the exposure, but they do not eliminate it. The server-only Supabase credential
must stay in the ignored backend environment file; it is never part of browser
configuration, frontend assets, URLs, storage, or logs.

### Cultural authentication visual

The account entrance places one centered, opaque authentication card over an
original full-viewport editorial illustration; it no longer uses a split-screen
layout. KP-inspired mountains, a hujra setting, carved wood, woven textiles, a
rabāb, community conversation, and a microphone surround the card. A warm
sound wave becoming connected points represents community speech moving into
preserved language data and future technology.

Responsive local assets provide separate desktop and portrait-mobile WebP
compositions plus a progressive JPEG fallback. Authentication initializes
without waiting for the artwork, and a forest-green CSS mountain and textile
fallback preserves contrast if it cannot load. The Google button uses the
official multicolor Google G from Google's pre-approved Android/Web sign-in
asset bundle, stored locally without recoloring.

The functional card remains sign-in-first and changes context for account
creation, signup OTP, loading, error, and verified-success states. Keyboard
users can move between the Sign In and Create Account tabs with arrow, Home,
and End keys; Escape safely leaves OTP verification.

Passwords and signup codes remain only in live form controls while needed.
They are cleared after requests, successful verification, mode changes, page
destruction, and navigation. They are never written to browser storage, URLs,
logs, the FastAPI API, or application profile state. Signup-code resending uses
only the active normalized email and has a 60-second client cooldown.

Supabase manages browser session persistence, Google URL-session detection, and
token refresh. The confirmation email must render `{{ .Token }}` so the user can
enter the delivered signup code. The account interface is displayed as fully
signed in only after FastAPI `GET /api/auth/me` verifies the resulting session.

Authentication provider calls, session restoration, and FastAPI verification
use a centralized 12-second frontend timeout. A timeout keeps any existing
session intact, releases the active form controls, and shows only: “We could not
complete the authentication request. Please try again.” Provider and backend
errors never leave a page-wide overlay, blur, scroll lock, or inert document.
Only the submitted form is marked busy, and its loading state is cleared in a
`finally` block. Backend verification is single-flight per access token and is
cached only in memory for the current page lifecycle.

Email codes are held only by the OTP input while needed. They are cleared after
success, cancellation, sign-out, email changes, and UI destruction; they are
never written to browser storage, URLs, logs, or FastAPI requests. Resending
uses the same normalized email and becomes available after a 60-second
cooldown.

Google sign-in requires the Google provider to be enabled and configured in the
Supabase dashboard before live use. Its redirect behavior is unchanged. For
local development, the configured Google redirect is
`http://127.0.0.1:4173/dashboard.html`.

Google OAuth and email/password signup are independent entry methods. **Continue with
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

Password recovery starts on `forgot-password.html` and always shows the same
account-neutral success copy. Supabase sends the recovery message to the
allowlisted `reset-password.html` URL. That page exposes its new-password form
only after Supabase emits a password-recovery session and FastAPI verifies the
access token. Password fields are cleared on failure, success, and navigation.

### Required Supabase account configuration

The hosted Supabase project must be configured manually to match the six-digit
interface:

1. Under **Authentication → Sign In / Providers → Email**, enable the email
   provider, new signups, Confirm Email, an 8-character-or-stronger password
   minimum, and six-digit OTPs.
2. Under **Authentication → Emails → Templates → Confirm signup**, render
   `{{ .Token }}` as the six-digit code instead of requiring
   `{{ .ConfirmationURL }}`.
3. Add the deployed `reset-password.html` address to the redirect allow list and
   keep the recovery email template enabled.
4. Keep custom SMTP configured so recipients outside the Supabase project team
   can receive codes.

Suggested Confirm signup subject: `Verify your KP AWAZ account`.

```html
<h2>Verify your KP AWAZ account</h2>
<p>Enter this six-digit code on KP AWAZ:</p>
<div style="margin:24px 0;padding:16px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px">
  {{ .Token }}
</div>
<p>If you did not create this account, you can ignore this email.</p>
<p>Our voices, our language, our Khyber Pakhtunkhwa.</p>
```

For password-account creation, keep **Confirm email** enabled and configure the
Supabase confirmation template to render the same `{{ .Token }}` six-digit
value. The dedicated page verifies it with type `email`; it never accepts or
renders `TokenHash`.

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

The configured relative `redirectUrl` resolves against the deployed origin and
currently returns Google OAuth to `dashboard.html`. Empty Supabase configuration does not stop navigation or FAQ
features from initializing, but recording remains unavailable until
authentication is configured and the user is verified.

### Contributor workspace

The contributor experience is now split into real page boundaries instead of
growing the public page into a single large application:

- `dashboard.html` loads the verified profile, dynamic review statistics,
  approved-contribution score, three most recent submissions, and leaderboard preview.
- `contribute.html` reuses the guided and open recorder with authenticated uploads.
- `my-contributions.html` reuses the existing paginated private history module,
  including review states and administrator feedback.
- `profile.html` shows private identity, contributor-since date, supported profile
  edits, approved score, and public rank.
- `settings.html` manages preferred language, leaderboard visibility, password
  updates for password-capable accounts, data-use information, and sign out.
- `sections/workspace-sidebar.html` is shared by every private page; page shells,
  feature modules, service adapters, and styles remain separate.

The dashboard does not invent word counts, speech duration, XP levels, or
unsupported donation types. Every number shown comes from the current backend
contracts. Private pages verify the restored Supabase session with FastAPI
before requesting profile data and redirect signed-out users to the account
entrance with a local allowlisted return destination. While this check runs,
they show a lightweight “Loading your contributor workspace…” shell instead of
revealing, fading, or disabling the private page. The shared sidebar includes a
**Visit Public Website** link back to `index.html`.

### Public and private navigation

Public navigation links to Home, About, How it works, Leaderboard, account
access, and the contribution journey. Authenticated work is kept on protected
pages with a shared responsive sidebar. Sign-out clears the private in-memory
view and returns to `index.html`.

Routing decisions are centralized in `scripts/services/route-guard.js`:
`index.html`, `about.html`, `data-use.html`, `how-it-works.html`, and
`leaderboard.html` are public for every visitor; `auth.html` redirects only a fully verified user;
`dashboard.html`, `contribute.html`, `my-contributions.html`, `profile.html`,
and `settings.html` require verification. The root path is normalized to
`index.html`, unsafe `next` values are rejected, and each page lifecycle allows
at most one redirect for a transition. `admin.html` remains independent and
continues to use only its existing runtime admin API-key mechanism.

Sign-out clears only the Supabase browser session and private in-memory UI. It
does not delete the local profile, profile preferences, contribution ownership,
recording files, review state, or point-ledger entries. Signing back in with the
same verified Supabase user ID restores that durable data. Google and email
accounts remain separate when Supabase gives them different user IDs; they
share data only when Supabase intentionally represents them as the same linked
identity.

## Recording consent and data use

Every new guided or open recording requires the contributor to accept consent
policy version `1.0`. The frontend sends `consentGiven` and
`consentPolicyVersion`; FastAPI validates them and records the accepted version
and a server-generated timestamp on the authenticated contribution. Identity is
always taken from the verified bearer token, never from a form field.

Older contributions are not backfilled. A row without both a consent policy
version and consent timestamp has legacy consent status unknown and is not
externally release-ready, even if it was already reviewed. Review status and
score are otherwise unchanged. Contributors can see the current policy version
and their most recent structured consent date on `profile.html`. The public
privacy and data-use explanation is available at `data-use.html`.

## Contributor withdrawal requests

Authenticated contributors can use **Settings → Data and Privacy** to request
withdrawal for one recording they own or for all recordings they own at the
time of the request. The browser sends no user ID; FastAPI derives ownership
from the verified bearer token. Requests use the states `requested`,
`approved`, and `declined`; `none` is the effective private history state when
no request applies. The optional contributor reason is limited to 500
characters.

Creating a request is non-destructive and does not change contribution review
status, score, points, or stored audio. My Contributions privately displays the
effective withdrawal state. Public sentence, leaderboard, and contribution
responses expose no withdrawal data.

The protected administrator workspace lists withdrawal requests through the
existing `X-Admin-Key` header and can approve exclusion or decline a request
with safe internal reasoning. Requested and approved records are excluded by
the canonical dataset export-eligibility query. An approved withdrawal means
exclude the affected data from future exports while retaining the source
record for audit; permanent deletion requires a separate secure product and
operational decision.

Owner endpoints:

- `POST /api/withdrawals/me`
- `GET /api/withdrawals/me`

Protected administrator endpoints:

- `GET /api/admin/withdrawals`
- `PATCH /api/admin/withdrawals/{request_id}`

## Internal approved-dataset export

The backend includes a read-only command-line exporter for internal model-training
preparation. It has no public download endpoint. The exporter includes only
approved contributions with authenticated ownership, structured consent, safe
supported audio, valid stored metadata, and no requested or approved withdrawal.
It uses export-local sample and speaker identifiers and never writes a reversible
identity map.

Inspect development data without creating output:

```bash
cd backend
.venv/bin/python -m app.cli.export_dataset \
  --output ../exports/kp_awaz_approved_dataset \
  --audio-mode original \
  --dry-run \
  --include-checksums
```

Create the internal export after reviewing the dry-run counts:

```bash
.venv/bin/python -m app.cli.export_dataset \
  --output ../exports/kp_awaz_approved_dataset \
  --audio-mode original \
  --include-checksums
```

The deterministic seed defaults to `42`. A non-empty output directory is refused
unless `--overwrite` is explicitly provided. When fewer than three eligible
speakers exist, only `splits/all.csv` is created; otherwise train, validation,
and test files are speaker-disjoint. Generated `exports/` directories are ignored
by Git.

## Profile settings

After Supabase restores or creates a session, FastAPI verifies the signed-in user and guarantees that one local profile exists through `GET /api/auth/me` before the frontend requests profile data. `GET /api/profile/me` remains safe to call directly and also creates the profile when needed. Existing profile preferences and edited display names are never replaced by later provider metadata.

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

After either upload succeeds, the contributor remains in the recording flow and
sees that the recording is waiting for administrator review. Submission itself
does not increase the score. The history, account score, and an opened personal
leaderboard context request fresh backend state after submission; they never add
a point optimistically in browser state.

Signed-in users can view their private submission history in its own **My
Contributions** section using the separate header control. The interface loads
ten results at a time from `GET /api/contributions/me` and preserves loading,
empty, safe error, retry, refresh, and Load more states. It does not preload the
history merely because a user signs in. A successful guided or open-recording
upload marks closed history as needing refresh, or refreshes it when the section
is already open.

Each history card shows `Pending review`, `Approved`, or `Rejected`. Pending
recordings are safely stored but do not score yet; approved recordings count;
rejected recordings do not count. A rejection reason is shown as plain text only
to the verified owner and only for a rejected item. Pending and approved items
never render rejection text. The summary above the history uses
`GET /api/profile/me/statistics` for total, pending, approved, and rejected
counts rather than deriving counts from the current history page.

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

The scoring rule is fixed: one currently approved contribution owned by the
verified profile equals one point. A new pending submission adds zero; approval
adds one; changing approval to rejection removes one; and approving again adds
one back. Rejected, pending, legacy unowned, and orphaned contributions always
count as zero.

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
The contributor-facing explanation states that only recordings approved by an
administrator are included.

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

The initial view is the newest-first Pending queue. A visible `Pending reviews`
count uses the backend's total for the pending filter and is refreshed when the
admin connects, changes filters, records a decision, or explicitly refreshes.
Successful decisions remove an item from the Pending view, preserve its audio,
and explain whether the contributor's score will update or remain unchanged.

This is temporary internal API-key administration, not an admin-account system.
The public leaderboard is available only on the contributor website and does
not initialize or share state with this administrator page.

## Recording behavior

Guided recordings have a maximum duration of 60 seconds. Open recordings have a maximum duration of 5 minutes. Recording stops automatically at the configured limit, and the completed recording remains available for playback and submission.

Available recording formats depend on the browser's `MediaRecorder` support. The frontend prefers WebM with Opus, followed by WebM, OGG with Opus, OGG, and MP4. It uses the recorder's actual Blob MIME type to generate matching upload filenames such as `recording.webm`, `recording.ogg`, `recording.wav`, `recording.mp3`, or `recording.m4a`.

No client-side audio conversion is performed.
