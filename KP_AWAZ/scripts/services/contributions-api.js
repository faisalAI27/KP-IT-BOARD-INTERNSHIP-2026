import { appConfig } from "../config.js";
import { pashtoSentences } from "../data/pashto-sentences.js";

const SAFE_REQUEST_ERROR = "The request could not be completed. Please try again.";
export const AUDIO_MIME_EXTENSION_MAP = Object.freeze({
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
});

export class ApiError extends Error {
  constructor(message, { code = "REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeAudioMimeType(mimeType) {
  if (mimeType === undefined || mimeType === null || mimeType === "") return "";
  if (typeof mimeType !== "string") {
    throw new TypeError("Audio MIME type must be a string.");
  }
  return mimeType.trim().split(";", 1)[0].trim().toLowerCase();
}

export function extensionForAudioMimeType(mimeType) {
  const normalizedMimeType = normalizeAudioMimeType(mimeType);
  if (!normalizedMimeType) return "webm";

  const extension = AUDIO_MIME_EXTENSION_MAP[normalizedMimeType];
  if (!extension) {
    throw new Error(`Unsupported audio MIME type: ${normalizedMimeType}`);
  }
  return extension;
}

function createMockResponse(type) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `mock-${Date.now()}`,
    type,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiErrorFromResponse(response, body, fallbackMessage = SAFE_REQUEST_ERROR) {
  const message =
    typeof body?.message === "string" && body.message.trim()
      ? body.message.trim()
      : fallbackMessage;
  const code =
    typeof body?.code === "string" && body.code.trim()
      ? body.code.trim()
      : "REQUEST_FAILED";

  return new ApiError(message, { code, status: response.status });
}

async function fetchApi(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw new ApiError("The KP AWAZ backend could not be reached.", {
      code: "NETWORK_ERROR",
      status: 0,
    });
  }
}

async function postForm(path, formData, mockType) {
  if (appConfig.api.useMock) {
    await wait(appConfig.api.mockDelayMs);
    return createMockResponse(mockType);
  }

  const response = await fetchApi(`${appConfig.api.baseUrl}${path}`, {
    method: "POST",
    body: formData,
    headers: { Accept: "application/json" },
  });

  const body = await readJson(response);
  if (!response.ok || response.status !== 201) {
    throw apiErrorFromResponse(response, body);
  }

  if (!body || typeof body !== "object") {
    throw new ApiError(SAFE_REQUEST_ERROR, {
      code: "INVALID_API_RESPONSE",
      status: response.status,
    });
  }

  return body;
}

function appendAudio(formData, audioBlob) {
  const extension = extensionForAudioMimeType(audioBlob.type);
  formData.append("audio", audioBlob, `recording.${extension}`);
}

export async function getSentencePrompts(language = "Pashto") {
  if (appConfig.api.useMock) {
    return language === "Pashto" ? [...pashtoSentences] : [];
  }

  const query = new URLSearchParams({ language, limit: "20" });
  const response = await fetchApi(`${appConfig.api.baseUrl}/sentences?${query}`, {
    headers: { Accept: "application/json" },
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw apiErrorFromResponse(
      response,
      body,
      "Sentence prompts could not be loaded.",
    );
  }

  const hasValidData =
    body &&
    Array.isArray(body.data) &&
    body.data.every(
      (sentence) =>
        sentence &&
        typeof sentence === "object" &&
        typeof sentence.id === "string" &&
        sentence.id.trim() &&
        typeof sentence.language === "string" &&
        sentence.language.trim() &&
        typeof sentence.text === "string" &&
        sentence.text.trim() &&
        (sentence.meaning === null || typeof sentence.meaning === "string"),
    );

  if (!hasValidData) {
    throw new ApiError("The sentence service returned an invalid response.", {
      code: "INVALID_SENTENCE_RESPONSE",
      status: response.status,
    });
  }

  return body.data;
}

export function submitVoiceDonation({
  contributorName,
  language,
  sentence,
  sentenceSource,
  sentenceId,
  consent,
  audioBlob,
}) {
  const formData = new FormData();
  formData.append("contributorName", contributorName);
  formData.append("language", language);
  formData.append("sentence", sentence);
  formData.append("sentenceSource", sentenceSource);
  if (typeof sentenceId === "string" && sentenceId.trim()) {
    formData.append("sentenceId", sentenceId.trim());
  }
  formData.append("consent", String(consent));
  appendAudio(formData, audioBlob);

  return postForm("/contributions/voice", formData, "voice-donation");
}

export function submitOpenRecording({
  contributorName,
  language,
  topic,
  consent,
  audioBlob,
}) {
  const formData = new FormData();
  formData.append("contributorName", contributorName);
  formData.append("language", language);
  formData.append("topic", topic);
  formData.append("consent", String(consent));
  appendAudio(formData, audioBlob);

  return postForm("/contributions/open-recording", formData, "open-recording");
}
