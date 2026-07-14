# Proposed backend contract

The frontend currently uses mock responses from `scripts/services/contributions-api.js`. The following contract is ready to implement on the backend.

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
| `consent` | boolean string | Yes |
| `audio` | WebM or OGG file | Yes |

## Submit an open recording

`POST /api/contributions/open-recording`

Content type: `multipart/form-data`

| Field | Type | Required |
| --- | --- | --- |
| `contributorName` | string | Yes |
| `language` | string | Yes |
| `topic` | string | No |
| `audio` | WebM or OGG file | Yes |

Successful submission response:

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
  "message": "A user-friendly validation or server error message."
}
```

## Backend responsibilities

- Validate all fields again on the server.
- Restrict audio MIME types and maximum upload size.
- Store audio outside the public web root or in private object storage.
- Store consent, sentence metadata, review status, and the audio storage key in the database.
- Return safe error messages without exposing internal details.
- Add authentication, rate limiting, moderation, and malware scanning as the platform grows.

