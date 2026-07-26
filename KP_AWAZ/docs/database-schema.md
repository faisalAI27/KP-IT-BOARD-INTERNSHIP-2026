# KP AWAZ SQLite schema

KP AWAZ uses one active SQLite database at `backend/kp_awaz.db`. Audio bytes
remain in private file storage; SQLite stores their safe storage key, checksum,
format, size, and review metadata.

## Recording data map

| Data stage | Table | Stored data |
| --- | --- | --- |
| Recording | `contributions` | Owner, mode, language, duration, status, timestamps |
| Speaker metadata | `profiles` | Verified account identity and contributor preferences |
| Device metadata | `recording_device_metadata` | Coarse device/browser/platform families and audio track settings |
| Recording metadata | `contributions` | Recording type, duration, review and lifecycle fields |
| Consent metadata | `contributions` | Consent flag, policy version and server timestamp |
| Prompt | `sentences` | Canonical prompt; `contributions.sentence_text` keeps its historical snapshot |
| Transcript | `transcripts` | Typed prompt references and future manual, ASR or reviewed transcripts |
| Audio | `contributions` plus private storage | Storage key, MIME, extension, checksum, generated name and byte size |

## Tables

The active database has nine application tables:

1. `profiles`
2. `sentences`
3. `contributions`
4. `recording_device_metadata`
5. `transcripts`
6. `text_contributions`
7. `point_ledger_entries`
8. `withdrawal_requests`
9. `import_batches`

`recording_device_metadata` deliberately excludes raw user-agent strings,
microphone labels, `deviceId`, `groupId`, hardware serial numbers, IP-derived
location, and exact screen dimensions. These values are unnecessary for the
recording workflow and would increase fingerprinting risk.

For guided recordings, a `prompt_reference` transcript row preserves the exact
sentence shown to the speaker. It is explicitly not marked as a verified
word-for-word transcript. Manual or ASR transcripts can be added later using
their distinct transcript types.
