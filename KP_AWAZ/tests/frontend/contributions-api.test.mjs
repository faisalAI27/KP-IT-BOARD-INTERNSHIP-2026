import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { appConfig } from "../../scripts/config.js";
import {
  AUDIO_MIME_EXTENSION_MAP,
  ApiError,
  ContributionsApi,
  extensionForAudioMimeType,
  normalizeAudioMimeType,
  validateMyContributionsResponse,
} from "../../scripts/services/contributions-api.js";


const originalFetch = globalThis.fetch;
const ACCESS_TOKEN = "private-access-token";
const REFRESH_TOKEN = "private-refresh-token";
const contributionApi = new ContributionsApi({
  getAccessToken: () => ACCESS_TOKEN,
});
const sentence = {
  id: "11111111-1111-4111-8111-111111111111",
  language: "Pashto",
  text: "هر غږ ارزښت لري.",
  meaning: "Every voice has value.",
};
const successBody = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "queued",
  createdAt: "2026-07-14T12:00:00Z",
};
const historyItem = {
  id: successBody.id,
  contributionType: "guided",
  sentenceId: sentence.id,
  sentenceText: sentence.text,
  topic: null,
  language: "Pashto",
  originalFilename: "recording.webm",
  mimeType: "audio/webm",
  durationSeconds: 4.2,
  status: "queued",
  reviewStatus: "pending",
  rejectionReason: null,
  createdAt: successBody.createdAt,
};
const historyBody = {
  items: [historyItem],
  total: 1,
  limit: 20,
  offset: 0,
};


afterEach(() => {
  globalThis.fetch = originalFetch;
});


function installJsonFetch(body, { status = 200 } = {}) {
  let capturedRequest;
  globalThis.fetch = async (url, options = {}) => {
    capturedRequest = { url: String(url), options };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return () => capturedRequest;
}


function voiceInput(overrides = {}) {
  return {
    contributorName: "Faisal Imran",
    language: "Pashto",
    sentence: sentence.text,
    sentenceSource: "provided",
    sentenceId: sentence.id,
    consent: true,
    audioBlob: new Blob(["guided-audio"], { type: "audio/webm" }),
    ...overrides,
  };
}


function openInput(overrides = {}) {
  return {
    contributorName: "Faisal Imran",
    language: "Pashto",
    topic: "زما د کلي یوه کیسه",
    consent: true,
    audioBlob: new Blob(["open-audio"], { type: "audio/webm" }),
    ...overrides,
  };
}


test("getSentencePrompts preserves sentence IDs", async () => {
  installJsonFetch({ data: [sentence] });

  const prompts = await contributionApi.getSentencePrompts("Pashto");

  assert.equal(prompts[0].id, sentence.id);
});


test("getSentencePrompts returns the complete body.data array", async () => {
  installJsonFetch({ data: [sentence] });

  const prompts = await contributionApi.getSentencePrompts("Pashto");

  assert.deepEqual(prompts, [sentence]);
});


test("getSentencePrompts rejects a malformed response", async () => {
  installJsonFetch({ results: [sentence] });

  await assert.rejects(contributionApi.getSentencePrompts(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "INVALID_SENTENCE_RESPONSE");
    return true;
  });
});


test("guided provided submission sends sentenceId", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitVoiceDonation(voiceInput());

  assert.equal(request().options.body.get("sentenceId"), sentence.id);
});


test("guided custom submission omits sentenceId", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitVoiceDonation(
    voiceInput({ sentenceSource: "custom", sentenceId: undefined }),
  );

  assert.equal(request().options.body.has("sentenceId"), false);
});


test("guided submission sends consent", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitVoiceDonation(voiceInput());

  assert.equal(request().options.body.get("consent"), "true");
});


test("open recording sends consent", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitOpenRecording(openInput());

  assert.equal(request().options.body.get("consent"), "true");
});


test("open recording sends topic", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitOpenRecording(openInput());

  assert.equal(request().options.body.get("topic"), "زما د کلي یوه کیسه");
});


test("open recording permits an empty topic field", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitOpenRecording(openInput({ topic: "" }));

  assert.equal(request().options.body.has("topic"), true);
  assert.equal(request().options.body.get("topic"), "");
});


test("guided FormData includes the audio blob", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitVoiceDonation(voiceInput());

  const audio = request().options.body.get("audio");
  assert.ok(audio instanceof Blob);
  assert.equal(audio.size, "guided-audio".length);
});


test("open-recording FormData includes the audio blob", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitOpenRecording(openInput());

  const audio = request().options.body.get("audio");
  assert.ok(audio instanceof Blob);
  assert.equal(audio.size, "open-audio".length);
});


test("successful HTTP 201 JSON is returned", async () => {
  installJsonFetch(successBody, { status: 201 });

  const result = await contributionApi.submitOpenRecording(openInput());

  assert.deepEqual(result, successBody);
});


test("backend error message is preserved", async () => {
  installJsonFetch(
    { message: "Consent is required.", code: "CONSENT_REQUIRED" },
    { status: 400 },
  );

  await assert.rejects(contributionApi.submitOpenRecording(openInput()), (error) => {
    assert.equal(error.message, "Consent is required.");
    return true;
  });
});


test("backend error code is preserved", async () => {
  installJsonFetch(
    { message: "Consent is required.", code: "CONSENT_REQUIRED" },
    { status: 400 },
  );

  await assert.rejects(contributionApi.submitOpenRecording(openInput()), (error) => {
    assert.equal(error.code, "CONSENT_REQUIRED");
    return true;
  });
});


test("backend HTTP status is preserved", async () => {
  installJsonFetch(
    { message: "Audio is too large.", code: "AUDIO_FILE_TOO_LARGE" },
    { status: 413 },
  );

  await assert.rejects(contributionApi.submitOpenRecording(openInput()), (error) => {
    assert.equal(error.status, 413);
    return true;
  });
});


test("malformed error JSON uses a safe fallback message", async () => {
  globalThis.fetch = async () =>
    new Response("<html>server error</html>", {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });

  await assert.rejects(contributionApi.submitOpenRecording(openInput()), (error) => {
    assert.equal(
      error.message,
      "The request could not be completed. Please try again.",
    );
    assert.equal(error.status, 500);
    return true;
  });
});


test("requests use the configured base URL", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitOpenRecording(openInput());

  assert.equal(
    request().url,
    `${appConfig.api.baseUrl}/contributions/open-recording`,
  );
});


test("multipart requests do not set a manual Content-Type header", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitVoiceDonation(voiceInput());

  const headers = new Headers(request().options.headers);
  assert.equal(headers.has("Content-Type"), false);
  assert.equal(headers.get("Accept"), "application/json");
  assert.equal(headers.get("Authorization"), `Bearer ${ACCESS_TOKEN}`);
});


test("guided and open uploads send the current bearer token", async () => {
  const guidedRequest = installJsonFetch(successBody, { status: 201 });
  await contributionApi.submitVoiceDonation(voiceInput());
  assert.equal(
    new Headers(guidedRequest().options.headers).get("Authorization"),
    `Bearer ${ACCESS_TOKEN}`,
  );

  const openRequest = installJsonFetch(successBody, { status: 201 });
  await contributionApi.submitOpenRecording(openInput());
  assert.equal(
    new Headers(openRequest().options.headers).get("Authorization"),
    `Bearer ${ACCESS_TOKEN}`,
  );
});


test("upload tokens stay out of URLs and multipart form data", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitVoiceDonation(
    voiceInput({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      userId: "another-user",
      profileId: "another-profile",
    }),
  );

  assert.equal(request().url.includes(ACCESS_TOKEN), false);
  const serializedValues = [...request().options.body.entries()]
    .map(([key, value]) => `${key}:${value instanceof Blob ? value.name : value}`)
    .join("|");
  for (const forbidden of [
    ACCESS_TOKEN,
    REFRESH_TOKEN,
    "accessToken",
    "refreshToken",
    "userId",
    "profileId",
    "another-user",
    "another-profile",
  ]) {
    assert.equal(serializedValues.includes(forbidden), false);
  }
});


test("missing session fails safely before upload fetch", async () => {
  let fetchCalls = 0;
  const api = new ContributionsApi({
    getAccessToken: () => null,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    },
  });

  await assert.rejects(api.submitVoiceDonation(voiceInput()), (error) => {
    assert.equal(error.code, "AUTHENTICATION_REQUIRED");
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(fetchCalls, 0);
});


test("blank access token fails safely before upload fetch", async () => {
  let fetchCalls = 0;
  const api = new ContributionsApi({
    getAccessToken: () => "   ",
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    },
  });

  await assert.rejects(api.submitOpenRecording(openInput()), (error) => {
    assert.equal(error.code, "AUTHENTICATION_REQUIRED");
    return true;
  });
  assert.equal(fetchCalls, 0);
});


test("backend errors cannot echo the bearer token", async () => {
  installJsonFetch(
    { message: `Rejected ${ACCESS_TOKEN}`, code: `BAD_${ACCESS_TOKEN}` },
    { status: 401 },
  );

  await assert.rejects(contributionApi.submitOpenRecording(openInput()), (error) => {
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    assert.equal(error.code.includes(ACCESS_TOKEN), false);
    return true;
  });
});


test("getMyContributions sends bearer token and validated pagination", async () => {
  const request = installJsonFetch(historyBody);

  const result = await contributionApi.getMyContributions({ limit: 20, offset: 0 });

  assert.deepEqual(result, historyBody);
  assert.equal(
    request().url,
    `${appConfig.api.baseUrl}/contributions/me?limit=20&offset=0`,
  );
  assert.equal(request().url.includes(ACCESS_TOKEN), false);
  assert.equal(request().options.method, "GET");
  assert.equal(
    new Headers(request().options.headers).get("Authorization"),
    `Bearer ${ACCESS_TOKEN}`,
  );
});


test("getMyContributions ignores identity, session, and refresh-token parameters", async () => {
  const request = installJsonFetch(historyBody);

  await contributionApi.getMyContributions({
    limit: 20,
    offset: 0,
    userId: "another-user",
    profileId: "another-profile",
    accessToken: "caller-supplied-access-token",
    refreshToken: REFRESH_TOKEN,
  });

  const requestText = `${request().url} ${JSON.stringify(request().options)}`;
  for (const forbidden of [
    "another-user",
    "another-profile",
    "caller-supplied-access-token",
    REFRESH_TOKEN,
    "userId",
    "profileId",
    "refreshToken",
  ]) {
    assert.equal(requestText.includes(forbidden), false);
  }
  assert.equal(
    new Headers(request().options.headers).get("Authorization"),
    `Bearer ${ACCESS_TOKEN}`,
  );
});


test("getMyContributions rejects invalid pagination before fetch", async () => {
  let fetchCalls = 0;
  const api = new ContributionsApi({
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    },
  });

  for (const pagination of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { offset: -1 },
    { offset: "0" },
  ]) {
    await assert.rejects(api.getMyContributions(pagination), (error) => {
      assert.equal(error.code, "INVALID_PAGINATION");
      return true;
    });
  }
  assert.equal(fetchCalls, 0);
});


test("getMyContributions preserves safe backend errors", async () => {
  installJsonFetch(
    { message: "Authentication is required.", code: "AUTHENTICATION_REQUIRED" },
    { status: 401 },
  );

  await assert.rejects(contributionApi.getMyContributions(), (error) => {
    assert.equal(error.message, "Authentication is required.");
    assert.equal(error.code, "AUTHENTICATION_REQUIRED");
    assert.equal(error.status, 401);
    return true;
  });
});


test("getMyContributions network failure uses a safe history error", async () => {
  const api = new ContributionsApi({
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async () => {
      throw new Error(`network failed with ${ACCESS_TOKEN}`);
    },
  });

  await assert.rejects(api.getMyContributions({ limit: 10, offset: 0 }), (error) => {
    assert.equal(error.message, "The KP AWAZ backend could not be reached.");
    assert.equal(error.code, "NETWORK_ERROR");
    assert.equal(error.status, 0);
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
});


test("getMyContributions backend errors cannot echo the access token", async () => {
  installJsonFetch(
    { message: `Rejected ${ACCESS_TOKEN}`, code: `BAD_${ACCESS_TOKEN}` },
    { status: 500 },
  );

  await assert.rejects(contributionApi.getMyContributions(), (error) => {
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    assert.equal(error.code.includes(ACCESS_TOKEN), false);
    return true;
  });
});


test("contribution history response is reduced to safe fields", () => {
  const result = validateMyContributionsResponse({
    ...historyBody,
    accessToken: ACCESS_TOKEN,
    items: [{ ...historyItem, userId: "private-user", storagePath: "/private" }],
  });

  assert.deepEqual(result, historyBody);
  assert.equal(JSON.stringify(result).includes("private-user"), false);
  assert.equal(JSON.stringify(result).includes(ACCESS_TOKEN), false);
});


test("contribution history accepts private rejected feedback for the owner", () => {
  const rejectionReason = "Please record in a quieter room.";
  const result = validateMyContributionsResponse({
    ...historyBody,
    items: [
      {
        ...historyItem,
        reviewStatus: "rejected",
        rejectionReason,
      },
    ],
  });

  assert.equal(result.items[0].reviewStatus, "rejected");
  assert.equal(result.items[0].rejectionReason, rejectionReason);
});


test("non-rejected contribution history cannot carry rejection feedback", () => {
  assert.throws(
    () =>
      validateMyContributionsResponse({
        ...historyBody,
        items: [
          {
            ...historyItem,
            reviewStatus: "approved",
            rejectionReason: "must not leak",
          },
        ],
      }),
    (error) => error.code === "INVALID_CONTRIBUTION_HISTORY_RESPONSE",
  );
});


test("malformed contribution history responses are rejected", async (context) => {
  for (const body of [
    null,
    {},
    { ...historyBody, items: {} },
    { ...historyBody, total: -1 },
    { ...historyBody, limit: 101 },
    { ...historyBody, offset: -1 },
    { ...historyBody, items: [{ ...historyItem, createdAt: "invalid" }] },
    { ...historyBody, items: [{ ...historyItem, durationSeconds: -1 }] },
    { ...historyBody, items: [{ ...historyItem, reviewStatus: "reviewing" }] },
    { ...historyBody, items: [{ ...historyItem, rejectionReason: undefined }] },
  ]) {
    await context.test(JSON.stringify(body), () => {
      assert.throws(
        () => validateMyContributionsResponse(body),
        (error) => error.code === "INVALID_CONTRIBUTION_HISTORY_RESPONSE",
      );
    });
  }
});


test("audio/webm maps to webm", () => {
  assert.equal(extensionForAudioMimeType("audio/webm"), "webm");
});


test("WebM codec parameters normalize and map to webm", () => {
  assert.equal(
    normalizeAudioMimeType(" audio/webm;codecs=opus "),
    "audio/webm",
  );
  assert.equal(extensionForAudioMimeType("audio/webm;codecs=opus"), "webm");
});


test("audio/ogg maps to ogg", () => {
  assert.equal(extensionForAudioMimeType("audio/ogg"), "ogg");
});


test("OGG codec parameters normalize and map to ogg", () => {
  assert.equal(extensionForAudioMimeType("audio/ogg; codecs=opus"), "ogg");
});


test("WAV MIME variants map to wav", () => {
  assert.equal(extensionForAudioMimeType("audio/wav"), "wav");
  assert.equal(extensionForAudioMimeType("audio/x-wav"), "wav");
});


test("audio/mpeg maps to mp3", () => {
  assert.equal(extensionForAudioMimeType("audio/mpeg"), "mp3");
});


test("audio/mp4 maps to m4a", () => {
  assert.equal(extensionForAudioMimeType("audio/mp4"), "m4a");
});


test("audio MIME casing and whitespace are normalized", () => {
  assert.equal(normalizeAudioMimeType("  Audio/MP4  "), "audio/mp4");
  assert.equal(extensionForAudioMimeType("Audio/MP4"), "m4a");
});


test("missing audio MIME uses the documented webm fallback", () => {
  assert.equal(extensionForAudioMimeType(""), "webm");
  assert.equal(extensionForAudioMimeType(undefined), "webm");
});


test("known unsupported audio MIME throws a clear error", () => {
  assert.throws(
    () => extensionForAudioMimeType("audio/aac"),
    /Unsupported audio MIME type: audio\/aac/,
  );
  assert.equal(Object.isFrozen(AUDIO_MIME_EXTENSION_MAP), true);
});


test("guided FormData filename matches the Blob MIME type", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitVoiceDonation(
    voiceInput({ audioBlob: new Blob(["mp3"], { type: "audio/mpeg" }) }),
  );

  assert.equal(request().options.body.get("audio").name, "recording.mp3");
});


test("open FormData filename matches the Blob MIME type", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await contributionApi.submitOpenRecording(
    openInput({ audioBlob: new Blob(["m4a"], { type: "audio/mp4" }) }),
  );

  assert.equal(request().options.body.get("audio").name, "recording.m4a");
});
