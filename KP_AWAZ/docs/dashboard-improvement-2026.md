# Dashboard and recording improvement — 2026

## What was causing friction

The production dashboard repeated its contribution call to action, gave a large score orbit and leaderboard preview more space than recording, and displayed a rejected count beside positive progress. The guided contribution then repeated the selected mode, contributor name, and Pashto language before requiring Continue and Review steps. A contributor needed several decisions before reaching the microphone.

## What changed

- The dashboard now has one dominant contribution area with exactly two routes: `?mode=guided` and `?mode=custom`.
- Leaderboard preview, score orbit, profile compass, rejected-count card, duplicate action grid, and repeated contribution links were removed from the dashboard.
- The summary is limited to Voices shared, Under review, and Approved. Recent activity remains limited to three recordings and uses supportive review labels.
- The shared sidebar prioritizes Dashboard, Record Voice, and My Recordings while retaining leaderboard, profile/privacy, settings, the public site, and sign out.
- Authenticated profile data now fills the contributor name. Guided recordings no longer ask for a name or language.
- The visible three-step wizard and redundant Continue/Review buttons were removed. Consent and submission appear only after a recording is captured.
- The original long-form `/open-recording` path remains available through a secondary disclosure, so the existing API contract is preserved without competing with the main sentence flow.

## New recording journey

Guided:

```text
Dashboard choice → reviewed sentence → microphone → stop → listen/re-record → consent → submit
```

Custom:

```text
Dashboard choice → RTL Pashto sentence → microphone → stop → listen/re-record → consent → submit
```

The provided-sentence path is now one dashboard click plus one microphone click before recording starts. Unsupported or missing `mode` values safely default to guided mode. Switching mode updates the current URL without adding a new history entry.

## Waveform and recording states

`scripts/modules/audio-visualizer.js` extends the existing recorder rather than replacing it. During an active recording it creates an `AudioContext`, connects a `MediaStreamAudioSourceNode` to an `AnalyserNode`, and draws real time-domain samples to Canvas with `requestAnimationFrame`. It never connects to the audio destination, so it does not echo or interfere with `MediaRecorder`.

Stopping, resetting, changing flows, closing the long-form disclosure, destroying the module, or leaving the page cancels the animation frame, disconnects nodes, closes the audio context, stops microphone tracks, clears timers, and revokes object URLs. Reduced-motion mode throttles visual sampling while retaining real input feedback. Text states cover permission request, recording, processing, playback, failure, and submission for screen-reader users. Browsers without Web Audio keep the existing text/timer recorder experience.

## Visual and motion system

The existing forest, ivory, cream, clay, and restrained gold palette remains intact. CSS-only woven lines on the contribution hub, the recorder grid, and a narrow sidebar textile strip add regional character without new images or patterns behind body text.

Motion is limited to 160–240 ms state transitions, two dashboard entry groups, three recent rows, review/success reveals, and an active-recording pulse. Idle audio has no looping animation. `prefers-reduced-motion` removes entry, pulse, and reveal animations.

## Consent and accessibility

Consent remains unchecked, explicit, versioned at `1.0`, and required by both submission APIs. The review state includes a visible data-use-policy link and the final action “I agree and submit recording.” The backend remains responsible for the consent timestamp and authenticated ownership; no browser-selected user ID was introduced.

Controls use semantic buttons, labels, live regions, visible focus, textual state changes, and 44–48 px touch targets. Pashto content and input use `lang="ps"` and `dir="rtl"`. The mobile drawer now closes with Escape, restores focus, updates its accessible label, and retains a strong backdrop.

## 21st.dev pattern review

Used as adapted patterns:

- Compact waveform/player hierarchy from WaveformPlayer, Live Waveform, and Audio Player examples.
- Native selection semantics and full-card affordance ideas from Radio/Radio Card examples; the final query-selected page uses a compact mode summary to avoid asking for the same choice twice.
- Drawer backdrop, active-state, and Escape-route ideas from mobile drawer/menu examples.
- Actionable alert, empty/retry, and success-message structure from Alert and Empty State examples.

Rejected:

- WebGL, AI transcription, glow/scanline, glassmorphism, and animated demo treatments.
- React, Vaul, Tailwind, or template dependencies that would conflict with the vanilla production architecture.
- Modal consent, which would interrupt the natural review flow.

## Files changed

- `dashboard.html`, `contribute.html`
- `sections/contribution.html`, `sections/workspace-sidebar.html`
- `styles/dashboard.css`, `styles/contribution.css`, `styles/contribute-page.css`, `styles/workspace.css`
- `scripts/dashboard-app.js`, `scripts/contribute-page-app.js`
- `scripts/modules/contributions.js`, `scripts/modules/recorder.js`, `scripts/modules/audio-visualizer.js`
- Relevant frontend tests and this README/document

The isolated `dashboard-v2`, `dashboard-v3-cultural`, and `dashboard-v4-awaz-inspired` directories were verified as unreferenced prototypes with no required unique production asset, then removed from the repository.

## Validation and future work

Tests cover route-mode selection and fallback, simplified markup, profile-derived fields, explicit consent, recording state announcements, Web Audio setup/cleanup, reduced motion, production selectors/IDs, and prototype removal. The normal frontend suite, production build, secret scan, and authenticated browser checks should be run for every release.

True microphone input, authenticated API data, and successful multipart submission still depend on browser permission plus a configured Supabase and FastAPI environment. A future improvement could add a dedicated authenticated end-to-end fixture for those external services without weakening production authentication.
