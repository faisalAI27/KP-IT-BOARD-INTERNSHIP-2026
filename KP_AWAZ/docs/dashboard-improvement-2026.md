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
- The contributor page now stays focused on guided and contributor-written sentences. The optional long-form disclosure was removed from this page; its backend contract remains unchanged.

### July 23 reading and Rabab refinement

- The dashboard contribution area is no longer a dark hero. It is a compact cream/light-green panel with shorter copy, two always-visible choices, and one quiet corner motif.
- The dashboard header now leads with a concise two-tone “Salaam, [first name].” greeting. Its salutation, name, and gold underline reveal once in a short stagger, while reduced-motion users receive the complete static greeting.
- The reviewed Pashto sentence now sits in a warm parchment reading panel with `lang="ps"`, `dir="rtl"`, one keyboard focus stop, an optional English meaning, and an understated sentence-replacement action.
- Visible Pashto words are rendered as non-focusable inline spans separated by their original whitespace text nodes. This keeps screen-reader output, copying, selection, punctuation, RTL order, review text, and the stored/API sentence exact while allowing a stable `scale(1.08)` pointer treatment.
- Sentence replacement crossfades in place. Touch uses sentence-level feedback, and reduced motion removes word and Rabab transforms while retaining color/state feedback.
- The earlier recording surfaces used an original inline SVG Rabab inside semantic buttons while retaining native mouse, Enter, Space, focus, disabled, and ARIA behavior. The primary surface was later replaced by the enhanced microphone control.
- The existing Web Audio analyser now publishes a normalized RMS level from the same `MediaRecorder` stream. That value moves the Rabab strings, body, and echo marks while the existing Canvas waveform continues to show real microphone samples. No second recorder, stream, audio destination, or animation library was added.
- Idle, permission request, recording, processing, ready, playback, and error states have distinct text and visuals without changing the control's 108×112 desktop or 90×98 mobile bounds.

### July 23 compact panel and embroidery refinement

- The production contribution panel now uses an intro row above two equal-height action cards. At wide desktop widths the heading and support copy share that row; below 1080 px they stack without changing either recording route.
- “Choose how you want to share your voice” remains the dominant heading while fitting in two lines at 375, 430, 1024, and 1440 px and one line at 768 px in the tested production layout.
- Both actions use the same pale surface, compact internal rhythm, reserved label space, and 92 px desktop minimum height. The recommended state is communicated with a quiet badge and clay border rather than a different card treatment.
- Fine-pointer hover and keyboard focus lift the card by 3 px and move its arrow by 4 px over 220 ms. The panel enters once from 12 px over 380 ms; reduced motion removes all of these transforms and the entrance.
- Original inline SVG diamond-and-stitch embroidery is scoped to the dashboard body. The main background is now cream with two soft radial washes, not graph paper; low-opacity embroidery stays behind content in selected corners and the second corner is removed on mobile. The contribution panel keeps a clean left edge so decoration cannot be mistaken for status icons.
- No JavaScript, route, link, ID, authentication, API, recorder, contribution, or backend contract changed in this refinement.

### July 23 profile and privacy refinement

- The profile page now uses one quiet workspace surface instead of separate identity, score, consent, and settings cards.
- Identity and private account facts form one compact overview row. Editable settings remain primary, while contribution impact and consent sit in a secondary column separated by simple rules.
- The decorative portrait rings, dark identity card, numbered data card, gradients, and nested shadows were removed. Form fields, live regions, retry actions, privacy wording, API calls, and all production IDs remain intact.
- On narrower screens, the workspace becomes one column, facts remain scannable, privacy sections separate with horizontal rules, and the save action expands to a full-width touch target.

### July 23 voice mission template adaptation

- The supplied motion prototype now informs the production Record Voice page: its focused mission heading, privacy cue, Read → Record → Submit journey, dark recording stage, recording-only pulse rings, and restrained textile thread are adapted to the existing KP AWAZ palette.
- The visual journey listens to the real recorder button states. It advances to Record while permission, capture, or processing is active and to Submit only when a playable recording is ready.
- Existing authentication, reviewed-sentence loading, custom-sentence mode, Pashto semantics, Web Audio waveform, playback, account-policy gate, and guided API payloads remain production-owned. The optional long-form disclosure has since been removed from the contributor page.
- Prototype-only XP, streak, fake community activity, simulated recording, duplicate sidebar, theme toggle, confetti, tilt, and continuous decorative motion were intentionally excluded.
- The layout reduces to one clear journey column and a two-column recorder control on small screens. Reduced-motion disables the entrance, shimmer, pulse, and journey transitions.

### July 23 enhanced microphone template replacement

- The primary Record Voice card now implements the supplied enhanced microphone template: circular microphone orb, breathing halo, two rotating cultural orbits, three recording ripples, stop/play icon swaps, recording and playback glow, pointer-follow stage light, fine-pointer card tilt, live signal bars, timer panel, sentence transition, toast, XP rise, confetti, and cultural thread.
- Template states are connected to the production `MediaRecorder`. The orb requests real microphone permission, stops the real stream, previews the captured Blob from the same control, and continues to use the existing Web Audio analyser and cleanup lifecycle.
- The supplied 44-bar signal display animates only during real capture or playback. The analyser’s normalized RMS level adjusts its brightness while the existing hidden Canvas remains the recorder’s real sample source.
- XP rise and confetti are wired only to a genuine submission-success state; the current account-policy gate still blocks upload honestly and never fabricates successful submission or awarded points.
- The replacement is scoped to the primary Record Voice card. Shared navigation, authenticated page guard, profile data, reviewed/custom sentence routes, and backend contracts remain unchanged.
- Small screens use the supplied two-column recorder layout and then the single-column microphone console below 450 px. Reduced-motion collapses all template animations and transitions to a single near-instant frame.

### July 23 focused recorder and moving weave

- The “Want to share a longer story instead?” disclosure, its plus trigger, and its long-form recorder were removed from the Record Voice page so the experience ends cleanly after the primary sentence workflow.
- The contributor-facing module now initializes and releases only the primary recorder. The existing `/open-recording` backend contract remains available but is no longer exposed on this page.
- The green, yellow, cream, and clay thread at the bottom of the primary Record Voice card now travels horizontally with the same seven-second continuous weave used by My Contributions. Reduced-motion keeps the thread static.

## New recording journey

Guided:

```text
Dashboard choice → reviewed sentence → microphone → stop → listen/re-record → submit
```

Custom:

```text
Dashboard choice → RTL Pashto sentence → microphone → stop → listen/re-record → submit
```

The provided-sentence path is now one dashboard click plus one Rabab press before recording starts. Unsupported or missing `mode` values safely default to guided mode. Switching mode updates the current URL without adding a new history entry.

## Waveform and recording states

`scripts/modules/audio-visualizer.js` extends the existing recorder rather than replacing it. During an active recording it creates an `AudioContext`, connects a `MediaStreamAudioSourceNode` to an `AnalyserNode`, draws real time-domain samples to Canvas with `requestAnimationFrame`, and publishes smoothed RMS levels to the Rabab presentation. It never connects to the audio destination, so it does not echo or interfere with `MediaRecorder`.

Stopping, resetting, changing sentence modes, destroying the module, or leaving the page cancels the animation frame, disconnects nodes, closes the audio context, stops microphone tracks, clears timers, and revokes object URLs. Reduced-motion mode throttles visual sampling while retaining real input feedback. Text states cover permission request, recording, processing, playback, failure, and submission for screen-reader users. Browsers without Web Audio keep the existing text/timer recorder experience.

## Visual and motion system

The existing forest, ivory, cream, clay, and restrained gold palette remains intact. A low-opacity embroidery motif sits in two selected dashboard-workspace corners while the contribution panel keeps a clean edge. The dashboard body override removes the shared graph-paper treatment without affecting other workspace routes. The former sidebar-edge textile strip, right border, and side shadow remain removed at every breakpoint.

Motion uses transform and opacity: four dashboard groups enter over 300–400 ms after ready, recent rows and statuses resolve once, statistics transition once from placeholders, and recorder states distinguish idle, permission request, live recording, processing, playback-ready, and success. The live waveform still reflects real Web Audio input. `prefers-reduced-motion` removes entry, breathing, pulse, spinner, status, and reveal animations.

## Consent and accessibility

The contribution UI contains no per-recording checkbox, details block, consent error, or “I agree” action. Both visible sentence modes use the same “Submit recording” action. The backend still requires explicit current-version consent fields for every upload, and no verified account-level policy record exists yet. The UI therefore blocks upload with an honest integration message while keeping the captured audio available. It does not send `true`, infer acceptance from the profile consent summary, or invent a timestamp. See `docs/account-level-consent-migration.md` before enabling uploads.

Controls use semantic buttons, labels, live regions, visible focus, textual state changes, and 44–48 px touch targets. Pashto content and input use `lang="ps"` and `dir="rtl"`. The mobile drawer now closes with Escape, restores focus, updates its accessible label, and retains a strong backdrop.

## 21st.dev pattern review

Used as adapted patterns:

- Compact waveform/player hierarchy and explicit recording-state copy from WaveformPlayer, Live Waveform, Voice Recording, and Voice Input examples.
- One restrained hover emphasis idea from text-hover/highlighter examples, adapted without WebGL, glow, character scrambling, or extra tab stops.
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
- `styles/dashboard.css`, `styles/contribution.css`, `styles/contribute-page.css`, `styles/workspace.css`, `styles/final-polish.css`
- `scripts/dashboard-app.js`, `scripts/contribute-page-app.js`
- `scripts/modules/contributions.js`, `scripts/modules/recorder.js`, `scripts/modules/audio-visualizer.js`
- Relevant frontend tests and this README/document

The isolated `dashboard-v2`, `dashboard-v3-cultural`, and `dashboard-v4-awaz-inspired` directories were verified as unreferenced prototypes with no required unique production asset, then removed from the repository.

## Validation and future work

Tests cover route-mode selection and fallback, simplified markup, profile-derived fields, the account-policy upload block, strict unchanged API consent validation, recording state announcements, Web Audio setup/cleanup, reduced motion, production selectors/IDs, and prototype removal. The normal frontend suite, production build, secret scan, and authenticated browser checks should be run for every release.

True microphone input, authenticated API data, and successful multipart submission still depend on browser permission plus a configured Supabase and FastAPI environment. A future improvement could add a dedicated authenticated end-to-end fixture for those external services without weakening production authentication.

## July 23 My Contributions motion template

The standalone My Contributions page now uses the supplied motion template while retaining the production workspace shell and authenticated data model. The implementation includes the woven shell border, review summary, four server-backed status filters, staggered status cards, pointer glow and tilt, refresh sparkle/toast feedback, responsive single-column cards, and reduced-motion handling.

Playback is connected to a new protected owner-audio route. The route requires the current bearer session, filters by both contribution ID and owner ID, validates the canonical private file path and audio MIME/extension, and returns a Blob-backed player without exposing storage keys or persistent public audio URLs. Filtering is also performed in the ownership-scoped database query so pagination remains accurate for each review state.

Validation completed on 2026-07-22:

- `npm test`: 743 passed.
- `pytest -q`: 952 passed.
- `npm run build` and `npm run scan:secrets`: passed.
- Browser layout checks: 375, 430, 768, 1024, and 1440 px, plus 667×375 landscape; no horizontal overflow.
- Sidebar computed edge: 0 px border, no shadow, and no `::after` divider at every checked width.
- Reduced motion: dashboard and statistic animation names resolve to `none`.
- Fake-device microphone: real Web Audio waveform activity, capture, processing, playback, and review reveal passed.
- Account-policy gate: Submit recording produced no contribution POST and preserved the captured playback Blob.

Validation completed for the July 23 refinement:

- `npm test`: 746 passed, including exact Pashto token reassembly, Rabab markup/state coverage, RMS-level output, Web Audio cleanup, and reduced-motion behavior.
- `pytest -q`: 952 passed; no backend contract was changed.
- `npm run build` and `npm run scan:secrets`: passed (293 source files and 94 build files scanned).
- Browser widths: 375, 430, 768, 1024, and 1440 px plus 667×375 landscape; dashboard and contribution pages had no horizontal overflow.
- The compact dashboard panel measured 390 px high on 375/430 (both actions remain in the first viewport), 275 px at 768, 310 px at 1024, and 246 px at 1440.
- The sentence accessibility snapshot exposes one complete Pashto paragraph; DOM text exactly matches the source sentence after word spans are added.
- Pointer magnification kept the word's layout width and neighboring word position stable; reduced motion resolved the word transform to `none`.
- A Chromium fake-device microphone pass verified native Enter-to-start and Space-to-stop, `Stop recording` ARIA state, live Canvas activity, live Rabab level properties, processing, playback, stable control bounds, and ready state.

Validation completed for the compact panel and embroidery refinement:

- Focused dashboard regressions: 15 passed.
- `npm test`: 747 passed; `npm run build`: passed; `npm run scan:secrets`: passed across 293 source and 94 build files.
- Browser widths: 375, 430, 768, 1024, and 1440 px; every width had zero horizontal overflow.
- Panel heights: 378 px at 375, 386 px at 430, 262 px at 768, 312 px at 1024, and 261 px at 1440.
- Card heights remained equal at every width: 94 px on mobile, 119 px at 768/1024, and 92 px at 1440.
- Computed dashboard backgrounds contained only the two radial washes and no linear-gradient grid. Embroidery opacity resolved to 0.05 on mobile and 0.075 above 650 px.
- Fine-pointer hover resolved to `translateY(-3px)` with a `translateX(4px)` arrow over 220 ms. Forced keyboard focus exposed the same motion with a solid 3 px focus outline.
- Reduced motion resolved the panel animation and both card/arrow transforms to `none`.
