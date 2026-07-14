import { appConfig } from "../config.js";
import { pashtoSentences } from "../data/pashto-sentences.js";

function createMockResponse(type) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `mock-${Date.now()}`,
    type,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function postForm(path, formData, mockType) {
  if (appConfig.api.useMock) {
    await wait(appConfig.api.mockDelayMs);
    return createMockResponse(mockType);
  }

  const response = await fetch(`${appConfig.api.baseUrl}${path}`, {
    method: "POST",
    body: formData,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Submission failed (${response.status}).`);
  }

  return response.json();
}

function appendAudio(formData, audioBlob) {
  const extension = audioBlob.type.includes("ogg") ? "ogg" : "webm";
  formData.append("audio", audioBlob, `recording.${extension}`);
}

export async function getSentencePrompts(language = "Pashto") {
  if (appConfig.api.useMock) {
    return language === "Pashto" ? [...pashtoSentences] : [];
  }

  const query = new URLSearchParams({ language, limit: "20" });
  const response = await fetch(`${appConfig.api.baseUrl}/sentences?${query}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Could not load sentence prompts (${response.status}).`);
  }

  const body = await response.json();
  return body.data;
}

export function submitVoiceDonation({
  contributorName,
  language,
  sentence,
  sentenceSource,
  consent,
  audioBlob,
}) {
  const formData = new FormData();
  formData.append("contributorName", contributorName);
  formData.append("language", language);
  formData.append("sentence", sentence);
  formData.append("sentenceSource", sentenceSource);
  formData.append("consent", String(consent));
  appendAudio(formData, audioBlob);

  return postForm("/contributions/voice", formData, "voice-donation");
}

export function submitOpenRecording({ contributorName, language, topic, audioBlob }) {
  const formData = new FormData();
  formData.append("contributorName", contributorName);
  formData.append("language", language);
  formData.append("topic", topic);
  appendAudio(formData, audioBlob);

  return postForm("/contributions/open-recording", formData, "open-recording");
}
