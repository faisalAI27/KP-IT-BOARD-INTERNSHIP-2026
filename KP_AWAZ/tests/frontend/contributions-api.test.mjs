import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { appConfig } from "../../scripts/config.js";
import {
  ApiError,
  getSentencePrompts,
  submitOpenRecording,
  submitVoiceDonation,
} from "../../scripts/services/contributions-api.js";


const originalFetch = globalThis.fetch;
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

  const prompts = await getSentencePrompts("Pashto");

  assert.equal(prompts[0].id, sentence.id);
});


test("getSentencePrompts returns the complete body.data array", async () => {
  installJsonFetch({ data: [sentence] });

  const prompts = await getSentencePrompts("Pashto");

  assert.deepEqual(prompts, [sentence]);
});


test("getSentencePrompts rejects a malformed response", async () => {
  installJsonFetch({ results: [sentence] });

  await assert.rejects(getSentencePrompts(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "INVALID_SENTENCE_RESPONSE");
    return true;
  });
});


test("guided provided submission sends sentenceId", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await submitVoiceDonation(voiceInput());

  assert.equal(request().options.body.get("sentenceId"), sentence.id);
});


test("guided custom submission omits sentenceId", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await submitVoiceDonation(
    voiceInput({ sentenceSource: "custom", sentenceId: undefined }),
  );

  assert.equal(request().options.body.has("sentenceId"), false);
});


test("guided submission sends consent", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await submitVoiceDonation(voiceInput());

  assert.equal(request().options.body.get("consent"), "true");
});


test("open recording sends consent", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await submitOpenRecording(openInput());

  assert.equal(request().options.body.get("consent"), "true");
});


test("open recording sends topic", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await submitOpenRecording(openInput());

  assert.equal(request().options.body.get("topic"), "زما د کلي یوه کیسه");
});


test("open recording permits an empty topic field", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await submitOpenRecording(openInput({ topic: "" }));

  assert.equal(request().options.body.has("topic"), true);
  assert.equal(request().options.body.get("topic"), "");
});


test("guided FormData includes the audio blob", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await submitVoiceDonation(voiceInput());

  const audio = request().options.body.get("audio");
  assert.ok(audio instanceof Blob);
  assert.equal(audio.size, "guided-audio".length);
});


test("open-recording FormData includes the audio blob", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await submitOpenRecording(openInput());

  const audio = request().options.body.get("audio");
  assert.ok(audio instanceof Blob);
  assert.equal(audio.size, "open-audio".length);
});


test("successful HTTP 201 JSON is returned", async () => {
  installJsonFetch(successBody, { status: 201 });

  const result = await submitOpenRecording(openInput());

  assert.deepEqual(result, successBody);
});


test("backend error message is preserved", async () => {
  installJsonFetch(
    { message: "Consent is required.", code: "CONSENT_REQUIRED" },
    { status: 400 },
  );

  await assert.rejects(submitOpenRecording(openInput()), (error) => {
    assert.equal(error.message, "Consent is required.");
    return true;
  });
});


test("backend error code is preserved", async () => {
  installJsonFetch(
    { message: "Consent is required.", code: "CONSENT_REQUIRED" },
    { status: 400 },
  );

  await assert.rejects(submitOpenRecording(openInput()), (error) => {
    assert.equal(error.code, "CONSENT_REQUIRED");
    return true;
  });
});


test("backend HTTP status is preserved", async () => {
  installJsonFetch(
    { message: "Audio is too large.", code: "AUDIO_FILE_TOO_LARGE" },
    { status: 413 },
  );

  await assert.rejects(submitOpenRecording(openInput()), (error) => {
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

  await assert.rejects(submitOpenRecording(openInput()), (error) => {
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

  await submitOpenRecording(openInput());

  assert.equal(
    request().url,
    `${appConfig.api.baseUrl}/contributions/open-recording`,
  );
});


test("multipart requests do not set a manual Content-Type header", async () => {
  const request = installJsonFetch(successBody, { status: 201 });

  await submitVoiceDonation(voiceInput());

  const headers = new Headers(request().options.headers);
  assert.equal(headers.has("Content-Type"), false);
  assert.equal(headers.get("Accept"), "application/json");
});
