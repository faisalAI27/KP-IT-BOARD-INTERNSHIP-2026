# KP Awaz Frontend

The frontend is organized so visual sections, interaction logic, data, and backend communication can evolve independently.

## Run locally

From this directory:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

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

## Connecting a backend

1. Implement the endpoints in [docs/backend-contract.md](docs/backend-contract.md).
2. Change `useMock` to `false` in `scripts/config.js`.
3. Set `baseUrl` if the API is hosted somewhere other than `/api`.

UI modules must not call `fetch` directly. Add or update calls in `scripts/services/` so backend changes remain isolated.

