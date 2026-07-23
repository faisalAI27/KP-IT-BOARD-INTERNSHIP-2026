# Backend contract

The frontend uses the following implemented FastAPI contract through `scripts/services/contributions-api.js`.

## Get sentence prompts

`GET /api/sentences?language=Pashto&limit=20`

Response:

```json
{
  "data": [
    {
      "id": "sentence-id",
      "language": "Pashto",
      "text": "زما ژبه زما پېژندنه ده.",
      "meaning": "My language is my identity."
    }
  ]
}
```

## Submit a guided voice donation

`POST /api/contributions/voice`

Content type: `multipart/form-data`

| Field | Type | Required |
| --- | --- | --- |
| `contributorName` | string | Yes |
| `language` | string | Yes |
| `sentence` | string | Yes |
| `sentenceSource` | `provided` or `custom` | Yes |
| `sentenceId` | UUID string | No |
| `consent` | boolean string | Yes |
| `audio` | supported audio file | Yes |

Successful guided submissions return `201 Created`. A provided sentence may include `sentenceId` for verification; custom sentences must omit it.

## Submit an open recording

`POST /api/contributions/open-recording`

Content type: `multipart/form-data`

| Field | Type | Required |
| --- | --- | --- |
| `contributorName` | string | Yes |
| `language` | string | Yes |
| `topic` | string | No |
| `consent` | boolean string | Yes |
| `audio` | supported audio file | Yes |

Explicit consent is required for both guided and open recordings. Accepted true values are `true`, `1`, `yes`, and `on`, compared case-insensitively. Open-recording topics are optional; omitted or blank topics are stored as null.

Successful submissions return `201 Created`:

```json
{
  "id": "contribution-id",
  "status": "queued",
  "createdAt": "2026-07-14T12:00:00.000Z"
}
```

Error response:

```json
{
  "message": "A user-friendly validation or server error message.",
  "code": "MACHINE_READABLE_CODE"
}
```

## Backend responsibilities

- Validate all fields again on the server.
- Restrict audio MIME types and maximum upload size.
- Store audio outside the public web root or in private object storage.
- Store consent, sentence metadata, review status, and the audio storage key in the database.
- Return safe error messages without exposing internal details.
- Add authentication, rate limiting, moderation, and malware scanning as the platform grows.
