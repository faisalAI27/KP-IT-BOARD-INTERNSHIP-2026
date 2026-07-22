# Dashboard and recording improvement — 2026

## What was causing friction

The production dashboard repeated its contribution call to action, gave a large score orbit and leaderboard preview more space than recording, and displayed a rejected count beside positive progress. The guided contribution then repeated the selected mode, contributor name, and Pashto language before requiring Continue and Review steps. A contributor needed several decisions before reaching the microphone.

## What changed

- The dashboard now has one dominant contribution area with exactly two routes: `?mode=guided` and `?mode=custom`.
- Leaderboard preview, score orbit, profile compass, rejected-count card, duplicate action grid, and repeated contribution links were removed from the dashboard.
- The summary is limited to Voices shared, Under review, and Approved. Recent activity remains limited to three recordings and uses supportive review labels.
- The shared sidebar prioritizes Dashboard, Record Voice, and My Recordings while retaining leaderboard, profile/privacy, settings, the public site, and sign out.
- Authenticated profile data now fills the contributor name. Guided recordings no longer ask for a name or language.
- The visible three-step wizard and redundant Continue/Review buttons were removed. A single Submit recording action appears after capture; the previous per-recording consent block is gone.
- The original long-form `/open-recording` path remains available through a secondary disclosure, so the existing API contract is preserved without competing with the main sentence flow.

## New recording journey

Guided:

```text
Dashboard choice → reviewed sentence → microphone → stop → listen/re-record → submit
```

Custom:

```text
Dashboard choice → RTL Pashto sentence → microphone → stop → listen/re-record → submit
```

The provided-sentence path is now one dashboard click plus one microphone click before recording starts. Unsupported or missing `mode` values safely default to guided mode. Switching mode updates the current URL without adding a new history entry.

## Waveform and recording states

`scripts/modules/audio-visualizer.js` extends the existing recorder rather than replacing it. During an active recording it creates an `AudioContext`, connects a `MediaStreamAudioSourceNode` to an `AnalyserNode`, and draws real time-domain samples to Canvas with `requestAnimationFrame`. It never connects to the audio destination, so it does not echo or interfere with `MediaRecorder`.

Stopping, resetting, changing flows, closing the long-form disclosure, destroying the module, or leaving the page cancels the animation frame, disconnects nodes, closes the audio context, stops microphone tracks, clears timers, and revokes object URLs. Reduced-motion mode throttles visual sampling while retaining real input feedback. Text states cover permission request, recording, processing, playback, failure, and submission for screen-reader users. Browsers without Web Audio keep the existing text/timer recorder experience.

## Visual and motion system

The existing forest, ivory, cream, clay, and restrained gold palette remains intact. CSS-only woven lines on the contribution hub and recorder grid remain; a low-opacity diamond embroidery motif now sits in two quiet main-workspace corners. The former sidebar-edge textile strip, right border, and side shadow were removed at every breakpoint.

Motion uses transform and opacity: four dashboard groups enter over 300–400 ms after ready, recent rows and statuses resolve once, statistics transition once from placeholders, and recorder states distinguish idle, permission request, live recording, processing, playback-ready, and success. The live waveform still reflects real Web Audio input. `prefers-reduced-motion` removes entry, breathing, pulse, spinner, status, and reveal animations.

## Consent and accessibility

The contribution UI contains no per-recording checkbox, details block, consent error, or “I agree” action. Both flows now use “Submit recording.” The backend still requires explicit current-version consent fields for every upload, and no verified account-level policy record exists yet. The UI therefore blocks upload with an honest integration message while keeping the captured audio available. It does not send `true`, infer acceptance from the profile consent summary, or invent a timestamp. See `docs/account-level-consent-migration.md` before enabling uploads.

Controls use semantic buttons, labels, live regions, visible focus, textual state changes, and 44–48 px touch targets. Pashto content and input use `lang="ps"` and `dir="rtl"`. The mobile drawer now closes with Escape, restores focus, updates its accessible label, and retains a strong backdrop.

## 21st.dev pattern review

Used as adapted patterns:

- Compact waveform/player hierarchy from WaveformPlayer, Live Waveform, and Audio Player examples.
- Native selection semantics and full-card affordance ideas from Radio/Radio Card examples; the final query-selected page uses a compact mode summary to avoid asking for the same choice twice.
- Drawer backdrop, active-state, and Escape-route ideas from mobile drawer/menu examples.
- Actionable alert, empty/retry, and success-message structure from Alert and Empty State examples.
- Underlined navigation, voice-input status, waveform, status-badge, and one-time success/reveal patterns reviewed in the July motion pass.

Rejected:

- WebGL, AI transcription, glow/scanline, glassmorphism, and animated demo treatments.
- React, Vaul, Tailwind, or template dependencies that would conflict with the vanilla production architecture.
- Modal consent, which would interrupt the natural review flow.
- Springy dock navigation, glowing AI voice orbs, WebGL backgrounds, and full-page animated patterns that would compete with recording.

## Files changed

- `dashboard.html`, `contribute.html`
- `sections/contribution.html`, `sections/workspace-sidebar.html`
- `styles/dashboard.css`, `styles/contribution.css`, `styles/contribute-page.css`, `styles/workspace.css`
- `scripts/dashboard-app.js`, `scripts/contribute-page-app.js`
- `scripts/modules/contributions.js`, `scripts/modules/recorder.js`, `scripts/modules/audio-visualizer.js`
- Relevant frontend tests and this README/document

The isolated `dashboard-v2`, `dashboard-v3-cultural`, and `dashboard-v4-awaz-inspired` directories were verified as unreferenced prototypes with no required unique production asset, then removed from the repository.

## Validation and future work

Tests cover route-mode selection and fallback, simplified markup, profile-derived fields, the account-policy upload block, strict unchanged API consent validation, recording state announcements, Web Audio setup/cleanup, reduced motion, production selectors/IDs, and prototype removal. The normal frontend suite, production build, secret scan, and authenticated browser checks should be run for every release.

True microphone input, authenticated API data, and successful multipart submission still depend on browser permission plus a configured Supabase and FastAPI environment. A future improvement could add a dedicated authenticated end-to-end fixture for those external services without weakening production authentication.

Validation completed on 2026-07-22:

- `npm test`: 743 passed.
- `pytest -q`: 952 passed.
- `npm run build` and `npm run scan:secrets`: passed.
- Browser layout checks: 375, 430, 768, 1024, and 1440 px, plus 667×375 landscape; no horizontal overflow.
- Sidebar computed edge: 0 px border, no shadow, and no `::after` divider at every checked width.
- Reduced motion: dashboard and statistic animation names resolve to `none`.
- Fake-device microphone: real Web Audio waveform activity, capture, processing, playback, and review reveal passed.
- Account-policy gate: Submit recording produced no contribution POST and preserved the captured playback Blob.
