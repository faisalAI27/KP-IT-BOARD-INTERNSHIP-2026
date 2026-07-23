# Frontend architecture

## Responsibilities

- `index.html` defines public-page metadata and section order only.
- `auth.html` owns the dedicated password/signup-code account entrance.
- `about.html`, `how-it-works.html`, and `leaderboard.html` are standalone public pages.
- `forgot-password.html` and `reset-password.html` isolate recovery flows.
- `dashboard.html`, `contribute.html`, `my-contributions.html`, and `settings.html`
  are private page shells sharing `sections/workspace-sidebar.html`.
- `profile.html` remains a protected compatibility route and renders the unified
  Settings workspace.
- `sections/` owns semantic markup and visible copy.
- `styles/` owns presentation, separated by page responsibility.
- `scripts/modules/` owns browser behavior and DOM state.
- `scripts/data/` contains temporary local data that can later come from the API.
- `scripts/services/` is the only layer allowed to communicate with the backend.
- `scripts/app.js` assembles the development page and initializes each feature.
- `scripts/modules/workspace-shell.js` assembles and guards private pages,
  verifies the shared session lifecycle, renders identity, and owns sign-out.
- Page entry modules initialize only the features required by their page.
- `admin.html` is a separate internal review entry point and initializes only
  `scripts/modules/admin-review.js` through `scripts/admin-app.js`.

## Request flow

```text
Contribution form or workspace page
       ↓
Focused browser module
       ↓
API service adapter
       ↓
FastAPI backend
```

The recorder returns both a temporary playback URL and the original `Blob`. The UI uses the URL for review; the API service sends the `Blob` as multipart form data.

The admin review flow is intentionally isolated:

```text
Runtime admin-key form
       ↓
Admin review module (memory-only key and UI state)
       ↓
Admin API service (X-Admin-Key header)
       ↓
Protected FastAPI review and audio routes
```

Protected audio is fetched as a Blob for the selected contribution only. The
review module owns and revokes the resulting object URL. It never creates a
public audio URL and never persists the admin key.

## Adding a page section

1. Create `sections/new-section.html`.
2. Add a `data-partial` slot in `index.html`.
3. Put its styles in the most relevant stylesheet or add a new stylesheet import.
4. If it is interactive, create a focused module and initialize it from `scripts/app.js`.

## Adding a private workspace page

1. Create a small page shell with the shared workspace-sidebar partial.
2. Add only the section partials and styles required by that page.
3. Initialize through `initializeWorkspace({ page, onReady })` so the session is
   verified before private API calls begin.
4. Keep backend calls in `scripts/services/`; page modules receive already-safe
   camel-case responses.
5. Add the new local filename to the account page's allowlisted return
   destinations and to `tools/build.mjs`.

## Migrating to backend templates

The files in `sections/` already match server-side partial boundaries. A future Express, Django, Laravel, or similar application can replace the development partial loader with its template include syntax while keeping the section markup, styles, feature modules, and API service contracts.
