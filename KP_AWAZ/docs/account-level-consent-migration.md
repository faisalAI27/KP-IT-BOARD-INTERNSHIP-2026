# Account-level data-use acceptance migration

## Current production limitation

The recording studio no longer shows a per-recording consent checkbox. Guided and
open flows can record, visualize, stop, play back, and re-record audio. Selecting
**Submit recording** currently stops before any upload and explains that verified
account-level data-use acceptance is not connected. The captured Blob stays in the
browser.

This is intentional. There is no trustworthy account-level acceptance record or
API in the current system, so the UI must not silently send `consentGiven=true`,
reuse the latest recording's consent, or invent a policy version or timestamp.
Production submission is blocked until the migration below is complete.

## Existing consent contract

The following locations still enforce or depend on per-recording structured consent:

- `scripts/services/contributions-api.js` requires the exact boolean `true`, requires
  policy version `1.0`, and appends `consentGiven=true` and
  `consentPolicyVersion=1.0` to both multipart requests.
- `backend/app/routes/contributions.py` declares both multipart fields as required for
  `/api/contributions/voice` and `/api/contributions/open-recording`.
- `backend/app/services/contribution_service.py::_validate_consent` rejects false,
  missing, or noncurrent consent. Persistence writes `consent_given=True`, the
  current policy version, and a server-generated timestamp equal to creation time.
- `backend/app/models/contribution.py` stores `consent_given`,
  `consent_policy_version`, and `consent_timestamp`. `has_structured_consent` and
  release readiness depend on all three.
- `backend/app/services/schema_compatibility.py` adds the version and timestamp
  columns for compatible legacy databases.
- `backend/app/services/dataset_export_service.py` and
  `backend/app/services/dataset_exporter.py` exclude records without complete
  structured consent.
- `backend/app/services/profile_service.py` and `GET /api/profile/me/consent` return
  the current policy version and latest qualifying **recording** consent timestamp.
  This summary is historical display data, not an account acceptance authority.
- Guided/open endpoint, service, model, profile, ownership, exporter, schema, and
  frontend API tests assert these rules. They must remain strict until the backend
  migration ships.

## Required future flow

1. After signup and backend identity verification, show the complete current
   data-use policy and its immutable version/hash.
2. Require an explicit Accept action. Do not precheck it and do not bundle acceptance
   into an unrelated submit button.
3. POST the acceptance through an authenticated endpoint. The server derives the
   user ID from the bearer token and writes an append-only record containing user ID,
   policy version, policy hash, and server-generated acceptance timestamp.
4. Before every future recording upload, the backend loads the caller's latest
   acceptance and verifies that its version/hash matches the active policy.
5. Snapshot that verified account acceptance onto each contribution's existing
   consent version/timestamp fields so export eligibility and historical audit remain
   stable if a later policy is published.
6. If the policy version changes, require a new explicit account acceptance before
   accepting more uploads. Never backfill acceptance for earlier versions.

## Backend/API work required before unblocking

- Add an append-only account policy-acceptance model and migration; a unique key on
  `(user_id, policy_version, policy_hash)` prevents duplicate records without erasing
  history.
- Add authenticated read/accept endpoints that return only safe acceptance metadata.
- Change contribution routes/services so client-supplied consent booleans are no
  longer the authority. The server must verify the account record and persist its
  snapshot. Remove the two required multipart fields only in the coordinated API
  version where all clients use server verification.
- Keep dataset-export requirements strict and extend tests for missing, stale,
  forged, cross-user, and policy-change acceptance.
- Expose only a verified current-policy result to the contribution page. Do not use
  `GET /api/profile/me/consent` for authorization because it summarizes old
  contributions.
- Replace the blocker in `scripts/modules/contributions.js` only after the server
  contract and authenticated acceptance UX are deployed together.

## Release gate

Do not enable either contribution POST from the current UI until an automated test
proves: explicit account acceptance → server-stored current version/timestamp →
authenticated upload → contribution snapshot → export eligibility. Until then, the
visible blocker is the correct safe behavior.
