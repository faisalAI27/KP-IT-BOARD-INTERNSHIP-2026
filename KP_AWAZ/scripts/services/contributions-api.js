import { appConfig } from "../config.js";
import { getCurrentAccessToken } from "./auth-service.js?v=20260723-auth-config-v2";
import {
  AUDIO_UPLOAD_REQUEST_TIMEOUT_MS,
  API_REQUEST_TIMEOUT_MS,
  fetchWithRequestTimeout,
} from "./request-timeout.js?v=20260718-stabilization";

const SAFE_REQUEST_ERROR = "The request could not be completed. Please try again.";
const REVIEW_STATUSES = new Set(["pending", "approved", "rejected"]);
const REVIEW_FILTERS = new Set(["all", ...REVIEW_STATUSES]);
const WITHDRAWAL_STATUSES = new Set([
  "none",
  "requested",
  "approved",
  "declined",
]);
export const CONSENT_POLICY_VERSION = "1.0";
export const CONSENT_REQUIRED_MESSAGE =
  "Please confirm the contribution consent before submitting.";
export const SUPPORTED_RECORDING_MIME_TYPES = Object.freeze([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac",
]);
const SUPPORTED_RECORDING_MIME_TYPE_SET = new Set(SUPPORTED_RECORDING_MIME_TYPES);

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
  const reviewStatus =
    typeof item.reviewStatus === "string"
      ? item.reviewStatus.trim().toLowerCase()
      : "";
  const rejectionReason = optionalString(item.rejectionReason);
  const withdrawalStatus =
    typeof item.withdrawalStatus === "string"
      ? item.withdrawalStatus.trim().toLowerCase()
      : "";
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
    REVIEW_STATUSES.has(reviewStatus) &&
    rejectionReason !== undefined &&
    (reviewStatus === "rejected" || rejectionReason === null) &&
    WITHDRAWAL_STATUSES.has(withdrawalStatus) &&
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
    reviewStatus,
    rejectionReason:
      reviewStatus === "rejected" && typeof rejectionReason === "string"
        ? rejectionReason.trim() || null
        : null,
    withdrawalStatus,
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


function reviewFilter(value) {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "all";
  if (!REVIEW_FILTERS.has(normalized)) {
    throw new ApiError("The contribution review filter is invalid.", {
      code: "INVALID_REVIEW_STATUS",
    });
  }
  return normalized;
}


function requiredContributionId(value) {
  const contributionId = typeof value === "string" ? value.trim() : "";
  if (!contributionId || contributionId.length > 200) {
    throw new ApiError("A valid contribution is required.", {
      code: "INVALID_CONTRIBUTION_ID",
    });
  }
  return contributionId;
}


function appendAudio(formData, audioBlob) {
  if (!(audioBlob instanceof Blob) || audioBlob.size <= 0) {
    throw new ApiError("No usable recording was received. Please record again.", {
      code: "EMPTY_AUDIO_FILE",
    });
  }
  const mimeType = normalizeAudioMimeType(audioBlob.type);
  if (!SUPPORTED_RECORDING_MIME_TYPE_SET.has(mimeType)) {
    throw new ApiError("This audio format could not be stored by the platform.", {
      code: "UNSUPPORTED_AUDIO_TYPE",
    });
  }
  // This generic multipart name is display metadata only. The backend derives
  // the safe extension and permanent filename exclusively from the MIME type.
  formData.append("audio", audioBlob, "recording");
}


function appendAudioDuration(formData, durationSeconds) {
  if (
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds >= 0
  ) {
    formData.append("audioDurationSeconds", String(durationSeconds));
  }
}

export function appendCurrentConsent(
  formData,
  { consentGiven, consentPolicyVersion },
) {
  if (consentGiven !== true) {
    throw new ApiError(CONSENT_REQUIRED_MESSAGE, { code: "CONSENT_REQUIRED" });
  }
  if (consentPolicyVersion !== CONSENT_POLICY_VERSION) {
    throw new ApiError(
      "Please review and accept the current contribution consent.",
      { code: "CONSENT_POLICY_VERSION_INVALID" },
    );
  }
  formData.append("consentGiven", "true");
  formData.append("consentPolicyVersion", CONSENT_POLICY_VERSION);
}

export class ContributionsApi {
  constructor({
    apiBaseUrl = appConfig.api.baseUrl,
    fetchImpl = (...args) => globalThis.fetch(...args),
    getAccessToken = getCurrentAccessToken,
    requestTimeoutMs = API_REQUEST_TIMEOUT_MS,
    audioUploadTimeoutMs = AUDIO_UPLOAD_REQUEST_TIMEOUT_MS,
  } = {}) {
    this._apiBaseUrl =
      typeof apiBaseUrl === "string" ? apiBaseUrl.trim().replace(/\/+$/, "") : "";
    this._fetch = fetchImpl;
    this._getAccessToken = getAccessToken;
    this._requestTimeoutMs = requestTimeoutMs;
    this._audioUploadTimeoutMs = audioUploadTimeoutMs;
  }

  async _fetchApi(url, options, timeoutMs = this._requestTimeoutMs) {
    try {
      return await fetchWithRequestTimeout(this._fetch, url, options, {
        timeoutMs,
      });
    } catch {
      throw new ApiError("The KP AWAZ backend could not be reached.", {
        code: "NETWORK_ERROR",
        status: 0,
      });
    }
  }

  async _postForm(path, formData) {
    const accessToken = requiredAccessToken(this._getAccessToken);

    const response = await this._fetchApi(
      `${this._apiBaseUrl}${path}`,
      {
        method: "POST",
        body: formData,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
      this._audioUploadTimeoutMs,
    );
    const body = await readJson(response);
    if (!response.ok || response.status !== 201) {
      throw apiErrorFromResponse(response, body, SAFE_REQUEST_ERROR, accessToken);
    }
    return validateCreatedContribution(body, response.status);
  }

  async getSentencePrompts(language = "Pashto") {
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
    consentGiven,
    consentPolicyVersion,
    audioBlob,
    audioDurationSeconds,
  }) {
    const formData = new FormData();
    formData.append("contributorName", contributorName);
    formData.append("language", language);
    formData.append("sentence", sentence);
    formData.append("sentenceSource", sentenceSource);
    if (typeof sentenceId === "string" && sentenceId.trim()) {
      formData.append("sentenceId", sentenceId.trim());
    }
    appendCurrentConsent(formData, { consentGiven, consentPolicyVersion });
    appendAudioDuration(formData, audioDurationSeconds);
    appendAudio(formData, audioBlob);
    return this._postForm("/contributions/voice", formData);
  }

  submitOpenRecording({
    contributorName,
    language,
    topic,
    consentGiven,
    consentPolicyVersion,
    audioBlob,
    audioDurationSeconds,
  }) {
    const formData = new FormData();
    formData.append("contributorName", contributorName);
    formData.append("language", language);
    formData.append("topic", topic);
    appendCurrentConsent(formData, { consentGiven, consentPolicyVersion });
    appendAudioDuration(formData, audioDurationSeconds);
    appendAudio(formData, audioBlob);
    return this._postForm("/contributions/open-recording", formData);
  }

  async getMyContributions({ limit = 20, offset = 0, status = "all" } = {}) {
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
    const safeStatus = reviewFilter(status);
    const accessToken = requiredAccessToken(this._getAccessToken);
    const query = new URLSearchParams({
      limit: String(safeLimit),
      offset: String(safeOffset),
      status: safeStatus,
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

  async getMyContributionAudio({ contributionId } = {}) {
    const safeContributionId = requiredContributionId(contributionId);
    const accessToken = requiredAccessToken(this._getAccessToken);
    const response = await this._fetchApi(
      `${this._apiBaseUrl}/contributions/me/${encodeURIComponent(safeContributionId)}/audio`,
      {
        method: "GET",
        headers: {
          Accept: "audio/*",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    if (!response.ok) {
      const body = await readJson(response);
      throw apiErrorFromResponse(
        response,
        body,
        "The recording could not be loaded.",
        accessToken,
      );
    }
    const mimeType = normalizeAudioMimeType(
      response.headers?.get?.("Content-Type"),
    );
    if (!SUPPORTED_RECORDING_MIME_TYPE_SET.has(mimeType)) {
      throw new ApiError("The recording format could not be played safely.", {
        code: "INVALID_AUDIO_RESPONSE",
        status: response.status,
      });
    }
    let audioBlob;
    try {
      audioBlob = await response.blob();
    } catch {
      audioBlob = null;
    }
    if (!(audioBlob instanceof Blob) || audioBlob.size <= 0) {
      throw new ApiError("The recording could not be read.", {
        code: "INVALID_AUDIO_RESPONSE",
        status: response.status,
      });
    }
    return audioBlob.type === mimeType
      ? audioBlob
      : new Blob([audioBlob], { type: mimeType });
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
export const getMyContributionAudio = (input) =>
  contributionsApi.getMyContributionAudio(input);
