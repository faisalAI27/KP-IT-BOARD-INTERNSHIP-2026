import { appConfig } from "../config.js";
import { pashtoSentences } from "../data/pashto-sentences.js";
import { getCurrentAccessToken } from "./auth-service.js?v=20260717-unified-auth";

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

function apiErrorFromResponse(
  response,
  body,
  fallbackMessage = SAFE_REQUEST_ERROR,
  accessToken = "",
) {
  const rawMessage =
    typeof body?.message === "string" && body.message.trim()
      ? body.message.trim()
      : fallbackMessage;
  const message =
    accessToken && rawMessage.includes(accessToken) ? fallbackMessage : rawMessage;
  const rawCode =
    typeof body?.code === "string" && body.code.trim()
      ? body.code.trim()
      : "REQUEST_FAILED";
  const code = accessToken && rawCode.includes(accessToken) ? "REQUEST_FAILED" : rawCode;

  return new ApiError(message, { code, status: response.status });
}

function requiredAccessToken(getAccessToken) {
  let token;
  try {
    token = getAccessToken();
  } catch {
    token = null;
  }
  const accessToken = typeof token === "string" ? token.trim() : "";
  if (!accessToken) {
    throw new ApiError("Authentication is required.", {
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
  }
  return accessToken;
}

function validateCreatedContribution(body, status) {
  const valid =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof body.id === "string" &&
    body.id.trim() &&
    typeof body.status === "string" &&
    body.status.trim() &&
    typeof body.createdAt === "string" &&
    !Number.isNaN(Date.parse(body.createdAt));
  if (!valid) {
    throw new ApiError(SAFE_REQUEST_ERROR, {
      code: "INVALID_API_RESPONSE",
      status,
    });
  }
  return {
    id: body.id.trim(),
    status: body.status.trim(),
    createdAt: body.createdAt,
  };
}

function optionalString(value) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value;
}

function safeContributionItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const sentenceId = optionalString(item.sentenceId);
  const sentenceText = optionalString(item.sentenceText);
  const topic = optionalString(item.topic);
  const valid =
    typeof item.id === "string" &&
    item.id.trim() &&
    typeof item.contributionType === "string" &&
    item.contributionType.trim() &&
    sentenceId !== undefined &&
    sentenceText !== undefined &&
    topic !== undefined &&
    typeof item.language === "string" &&
    item.language.trim() &&
    typeof item.originalFilename === "string" &&
    item.originalFilename.trim() &&
    typeof item.mimeType === "string" &&
    item.mimeType.trim() &&
    (item.durationSeconds === null ||
      (typeof item.durationSeconds === "number" && item.durationSeconds >= 0)) &&
    typeof item.status === "string" &&
    item.status.trim() &&
    typeof item.createdAt === "string" &&
    !Number.isNaN(Date.parse(item.createdAt));
  if (!valid) return null;
  return {
    id: item.id.trim(),
    contributionType: item.contributionType.trim(),
    sentenceId,
    sentenceText,
    topic,
    language: item.language.trim(),
    originalFilename: item.originalFilename.trim(),
    mimeType: item.mimeType.trim(),
    durationSeconds: item.durationSeconds,
    status: item.status.trim(),
    createdAt: item.createdAt,
  };
}

export function validateMyContributionsResponse(body, status = 200) {
  const items = Array.isArray(body?.items)
    ? body.items.map((item) => safeContributionItem(item))
    : null;
  const valid =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    items &&
    items.every(Boolean) &&
    Number.isInteger(body.total) &&
    body.total >= 0 &&
    Number.isInteger(body.limit) &&
    body.limit >= 1 &&
    body.limit <= 100 &&
    Number.isInteger(body.offset) &&
    body.offset >= 0 &&
    items.length <= body.limit;
  if (!valid) {
    throw new ApiError("Contribution history returned an invalid response.", {
      code: "INVALID_CONTRIBUTION_HISTORY_RESPONSE",
      status,
    });
  }
  return {
    items,
    total: body.total,
    limit: body.limit,
    offset: body.offset,
  };
}

function paginationValue(value, { name, defaultValue, minimum, maximum }) {
  const candidate = value === undefined ? defaultValue : value;
  if (
    !Number.isInteger(candidate) ||
    candidate < minimum ||
    (maximum !== undefined && candidate > maximum)
  ) {
    throw new ApiError(`${name} is outside the allowed range.`, {
      code: "INVALID_PAGINATION",
    });
  }
  return candidate;
}

function appendAudio(formData, audioBlob) {
  const extension = extensionForAudioMimeType(audioBlob.type);
  formData.append("audio", audioBlob, `recording.${extension}`);
}

export class ContributionsApi {
  constructor({
    apiBaseUrl = appConfig.api.baseUrl,
    fetchImpl = (...args) => globalThis.fetch(...args),
    getAccessToken = getCurrentAccessToken,
    useMock = appConfig.api.useMock,
    mockDelayMs = appConfig.api.mockDelayMs,
  } = {}) {
    this._apiBaseUrl =
      typeof apiBaseUrl === "string" ? apiBaseUrl.trim().replace(/\/+$/, "") : "";
    this._fetch = fetchImpl;
    this._getAccessToken = getAccessToken;
    this._useMock = useMock;
    this._mockDelayMs = mockDelayMs;
  }

  async _fetchApi(url, options) {
    try {
      return await this._fetch(url, options);
    } catch {
      throw new ApiError("The KP AWAZ backend could not be reached.", {
        code: "NETWORK_ERROR",
        status: 0,
      });
    }
  }

  async _postForm(path, formData, mockType) {
    const accessToken = requiredAccessToken(this._getAccessToken);
    if (this._useMock) {
      await wait(this._mockDelayMs);
      return createMockResponse(mockType);
    }

    const response = await this._fetchApi(`${this._apiBaseUrl}${path}`, {
      method: "POST",
      body: formData,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const body = await readJson(response);
    if (!response.ok || response.status !== 201) {
      throw apiErrorFromResponse(response, body, SAFE_REQUEST_ERROR, accessToken);
    }
    return validateCreatedContribution(body, response.status);
  }

  async getSentencePrompts(language = "Pashto") {
    if (this._useMock) {
      return language === "Pashto" ? [...pashtoSentences] : [];
    }

    const query = new URLSearchParams({ language, limit: "20" });
    const response = await this._fetchApi(`${this._apiBaseUrl}/sentences?${query}`, {
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

  submitVoiceDonation({
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
    return this._postForm("/contributions/voice", formData, "voice-donation");
  }

  submitOpenRecording({ contributorName, language, topic, consent, audioBlob }) {
    const formData = new FormData();
    formData.append("contributorName", contributorName);
    formData.append("language", language);
    formData.append("topic", topic);
    formData.append("consent", String(consent));
    appendAudio(formData, audioBlob);
    return this._postForm(
      "/contributions/open-recording",
      formData,
      "open-recording",
    );
  }

  async getMyContributions({ limit = 20, offset = 0 } = {}) {
    const safeLimit = paginationValue(limit, {
      name: "Limit",
      defaultValue: 20,
      minimum: 1,
      maximum: 100,
    });
    const safeOffset = paginationValue(offset, {
      name: "Offset",
      defaultValue: 0,
      minimum: 0,
    });
    const accessToken = requiredAccessToken(this._getAccessToken);
    const query = new URLSearchParams({
      limit: String(safeLimit),
      offset: String(safeOffset),
    });
    const response = await this._fetchApi(
      `${this._apiBaseUrl}/contributions/me?${query}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    const body = await readJson(response);
    if (!response.ok) {
      throw apiErrorFromResponse(response, body, SAFE_REQUEST_ERROR, accessToken);
    }
    return validateMyContributionsResponse(body, response.status);
  }
}


const contributionsApi = new ContributionsApi();


export const getSentencePrompts = (language = "Pashto") =>
  contributionsApi.getSentencePrompts(language);
export const submitVoiceDonation = (input) =>
  contributionsApi.submitVoiceDonation(input);
export const submitOpenRecording = (input) =>
  contributionsApi.submitOpenRecording(input);
export const getMyContributions = (pagination) =>
  contributionsApi.getMyContributions(pagination);
