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

Backend Swagger is available at `http://127.0.0.1:8000/docs`, and backend health is available at `http://127.0.0.1:8000/api/health`.

The backend must be running for real sentence prompts and recording submissions to work. Frontend mock mode is disabled in `scripts/config.js`.

Do not open `index.html` directly. The development page loads HTML section partials over HTTP.

## Project structure

```text
KP_AWAZ/
├── index.html                 # Small page shell
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

This creates `dist/`, assembles all HTML partials into one production page, generates the browser-compatible Supabase vendor module, and copies the runtime assets. Development stays modular while production avoids client-side partial requests.

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

Profile settings are available inside the signed-in account dialog. Users can edit their display name, preferred language, and whether their display name may appear on a future public leaderboard. Leaderboard visibility is private by default. The profile form includes loading, retry, validation, save, and no-change feedback without blocking the rest of the site.

Supabase remains responsible for authentication and browser session management. FastAPI stores only application-specific profile preferences and the safe identity metadata needed to associate the profile with the verified Supabase user. Access tokens are not stored in the profile table or in profile UI state.

## Authenticated contributions

Guided and open contribution recording now requires a signed-in user whose Supabase session has been verified by FastAPI. Signed-out users see a sign-in prompt, recording controls remain unavailable, and microphone permission is not requested. Signing out during a recording releases the microphone and discards unsent audio.

Uploads send the current access token only in the `Authorization: Bearer` header. The frontend never sends a user ID or profile ID. FastAPI derives ownership exclusively from the verified token, creates or synchronizes the local profile when needed, and stores the verified profile ID with new contribution metadata. The two contributions created before ownership support remain unowned legacy records.

Signed-in users can view their private submission history in the **My Contributions** area of the account dialog. The interface loads ten results at a time from `GET /api/contributions/me`, supports refresh, retry, and Load more, and refreshes the first page automatically after a successful guided or open-recording upload. History is requested only after FastAPI verifies the current Supabase session.

The backend filters history by the identity derived from the bearer token. The frontend neither sends nor accepts a user ID for history requests, so one account cannot select or view another account's contributions. The two legacy unowned contributions do not appear in any user's history. Audio playback is not included because the history response does not provide a safe playable URL. Audio files remain separate from SQLite; SQLite stores their safe relative keys, contribution metadata, and nullable ownership.

## Recording behavior

Guided recordings have a maximum duration of 60 seconds. Open recordings have a maximum duration of 5 minutes. Recording stops automatically at the configured limit, and the completed recording remains available for playback and submission.

Available recording formats depend on the browser's `MediaRecorder` support. The frontend prefers WebM with Opus, followed by WebM, OGG with Opus, OGG, and MP4. It uses the recorder's actual Blob MIME type to generate matching upload filenames such as `recording.webm`, `recording.ogg`, `recording.wav`, `recording.mp3`, or `recording.m4a`.

No client-side audio conversion is performed.
