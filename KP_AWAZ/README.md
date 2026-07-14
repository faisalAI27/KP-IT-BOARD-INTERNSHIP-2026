# KP Awaz Frontend

The frontend is organized so visual sections, interaction logic, data, and backend communication can evolve independently.

## Run locally

The frontend now uses the real FastAPI backend. Start both applications in separate terminals.

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
└── tools/build.mjs            # Dependency-free production build
```

## Production build

```bash
npm run build
```

This creates `dist/`, assembles all HTML partials into one production page, and copies the runtime assets. Development stays modular while production avoids client-side partial requests.

## Backend connection

The active API URL and mock-mode switch are centralized in `scripts/config.js`. Update `baseUrl` there when the API is hosted somewhere other than the local FastAPI address.

UI modules must not call `fetch` directly. Add or update calls in `scripts/services/` so backend changes remain isolated.
