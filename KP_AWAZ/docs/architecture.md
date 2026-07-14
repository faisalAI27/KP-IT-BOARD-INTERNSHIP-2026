# Frontend architecture

## Responsibilities

- `index.html` defines document metadata and section order only.
- `sections/` owns semantic markup and visible copy.
- `styles/` owns presentation, separated by page responsibility.
- `scripts/modules/` owns browser behavior and DOM state.
- `scripts/data/` contains temporary local data that can later come from the API.
- `scripts/services/` is the only layer allowed to communicate with the backend.
- `scripts/app.js` assembles the development page and initializes each feature.

## Request flow

```text
Contribution form
       ↓
Contribution module
       ↓
API service adapter
       ↓
Mock response now / real backend later
```

The recorder returns both a temporary playback URL and the original `Blob`. The UI uses the URL for review; the API service sends the `Blob` as multipart form data.

## Adding a page section

1. Create `sections/new-section.html`.
2. Add a `data-partial` slot in `index.html`.
3. Put its styles in the most relevant stylesheet or add a new stylesheet import.
4. If it is interactive, create a focused module and initialize it from `scripts/app.js`.

## Migrating to backend templates

The files in `sections/` already match server-side partial boundaries. A future Express, Django, Laravel, or similar application can replace the development partial loader with its template include syntax while keeping the section markup, styles, feature modules, and API service contracts.

