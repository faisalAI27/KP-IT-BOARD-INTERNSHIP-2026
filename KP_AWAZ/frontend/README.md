# KP AWAZ Frontend

Static HTML, CSS, and JavaScript frontend for KP AWAZ.

## Run locally

```bash
npm install
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173`. The source must be served over HTTP because pages
load reusable HTML partials.

## Verify and build

```bash
npm test
npm run build
npm run scan:secrets
```

The build assembles the production site in the ignored `dist/` directory.

## Structure

```text
frontend/
├── *.html          # Page entry points
├── sections/       # Reusable HTML partials
├── styles/         # Shared and page-specific CSS
├── scripts/
│   ├── *-app.js    # Page bootstraps
│   ├── modules/    # UI behavior and lifecycle
│   └── services/   # FastAPI and Supabase adapters
├── assets/         # Images, logos, and browser vendor assets
├── tests/          # Frontend regression tests
├── tools/          # Build and security utilities
└── dist/           # Generated production output; not committed
```

Backend code, environment configuration, SQLite data, and recorded audio belong
in `../backend/` and must not be copied into this directory.
