import { appConfig } from "../config.js";

const SAFE_REQUEST_ERROR = "The admin request could not be completed. Please try again.";
const ADMIN_FILTERS = new Set(["pending", "approved", "rejected", "all"]);
const REVIEW_STATUSES = new Set(["approved", "rejected"]);
const AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
]);


export class AdminReviewApiError extends Error {
  constructor(message, { code = "ADMIN_REVIEW_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.name = "AdminReviewApiError";
    this.code = code;
    this.status = status;
  }
}


function requiredAdminKey(adminKey) {
  const key = typeof adminKey === "string" ? adminKey.trim() : "";
  if (!key) {
    throw new AdminReviewApiError("An admin key is required.", {
      code: "ADMIN_KEY_REQUIRED",
      status: 401,
    });
  }
  return key;
}


function validContributionId(contributionId) {
  const id = typeof contributionId === "string" ? contributionId.trim() : "";
  if (!id) {
    throw new AdminReviewApiError("A contribution ID is required.", {
      code: "INVALID_CONTRIBUTION_ID",
    });
  }
  return id;
}


function validFilter(status) {
  const filter = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!ADMIN_FILTERS.has(filter)) {
    throw new AdminReviewApiError("The review filter is invalid.", {
      code: "INVALID_REVIEW_FILTER",
    });
  }
  return filter;
}


function paginationValue(value, { name, defaultValue, minimum, maximum }) {
  const candidate = value === undefined ? defaultValue : value;
  if (
    !Number.isInteger(candidate) ||
    candidate < minimum ||
    (maximum !== undefined && candidate > maximum)
  ) {
    throw new AdminReviewApiError(`${name} is outside the allowed range.`, {
      code: "INVALID_PAGINATION",
    });
  }
  return candidate;
}


function optionalString(value) {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}


export function validateAdminContribution(item, status = 200) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new AdminReviewApiError("The admin API returned an invalid contribution.", {
      code: "INVALID_ADMIN_CONTRIBUTION_RESPONSE",
      status,
    });
  }

  const sentenceText = optionalString(item.sentenceText);
  const topic = optionalString(item.topic);
  const rejectionReason = optionalString(item.rejectionReason);
  const ownerDisplayName = optionalString(item.ownerDisplayName);
  const valid =
    typeof item.id === "string" &&
    item.id.trim() &&
    typeof item.contributionType === "string" &&
    item.contributionType.trim() &&
    typeof item.language === "string" &&
    item.language.trim() &&
    sentenceText !== undefined &&
    topic !== undefined &&
    typeof item.originalFilename === "string" &&
    item.originalFilename.trim() &&
    typeof item.mimeType === "string" &&
    item.mimeType.trim() &&
    (item.durationSeconds === null ||
      (typeof item.durationSeconds === "number" &&
        Number.isFinite(item.durationSeconds) &&
        item.durationSeconds >= 0)) &&
    typeof item.createdAt === "string" &&
    !Number.isNaN(Date.parse(item.createdAt)) &&
    typeof item.reviewStatus === "string" &&
    ADMIN_FILTERS.has(item.reviewStatus.trim().toLowerCase()) &&
    item.reviewStatus.trim().toLowerCase() !== "all" &&
    (item.reviewedAt === null ||
      (typeof item.reviewedAt === "string" &&
        !Number.isNaN(Date.parse(item.reviewedAt)))) &&
    rejectionReason !== undefined &&
    typeof item.hasOwner === "boolean" &&
    ownerDisplayName !== undefined;

  if (!valid) {
    throw new AdminReviewApiError("The admin API returned an invalid contribution.", {
      code: "INVALID_ADMIN_CONTRIBUTION_RESPONSE",
      status,
    });
  }

  return {
    id: item.id.trim(),
    contributionType: item.contributionType.trim(),
    language: item.language.trim(),
    sentenceText,
    topic,
    originalFilename: item.originalFilename.trim(),
    mimeType: item.mimeType.trim(),
    durationSeconds: item.durationSeconds,
    createdAt: item.createdAt,
    reviewStatus: item.reviewStatus.trim().toLowerCase(),
    reviewedAt: item.reviewedAt,
    rejectionReason,
    hasOwner: item.hasOwner,
    ownerDisplayName,
  };
}


export function validateAdminContributionPage(body, expectedStatus, status = 200) {
  const filter = validFilter(expectedStatus);
  let items = null;
  if (Array.isArray(body?.items)) {
    try {
      items = body.items.map((item) => validateAdminContribution(item, status));
    } catch {
      items = null;
    }
  }
  const responseStatus =
    typeof body?.status === "string" ? body.status.trim().toLowerCase() : "";
  const valid =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    items &&
    Number.isInteger(body.total) &&
    body.total >= 0 &&
    Number.isInteger(body.limit) &&
    body.limit >= 1 &&
    body.limit <= 100 &&
    Number.isInteger(body.offset) &&
    body.offset >= 0 &&
    responseStatus === filter &&
    items.length <= body.limit;

  if (!valid) {
    throw new AdminReviewApiError("The admin queue returned an invalid response.", {
      code: "INVALID_ADMIN_QUEUE_RESPONSE",
      status,
    });
  }

  return {
    items,
    total: body.total,
    limit: body.limit,
    offset: body.offset,
    status: responseStatus,
  };
}


function normalizeAudioMimeType(value) {
  return typeof value === "string"
    ? value.trim().split(";", 1)[0].trim().toLowerCase()
    : "";
}


async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}


function apiErrorFromResponse(response, body, adminKey) {
  const fallbackCode =
    response.status === 401
      ? "ADMIN_KEY_REQUIRED"
      : response.status === 403
        ? "INVALID_ADMIN_KEY"
        : "ADMIN_REVIEW_REQUEST_FAILED";
  const rawCode =
    typeof body?.code === "string" && body.code.trim()
      ? body.code.trim()
      : fallbackCode;
  const rawMessage =
    typeof body?.message === "string" && body.message.trim()
      ? body.message.trim()
      : typeof body?.detail === "string" && body.detail.trim()
        ? body.detail.trim()
        : SAFE_REQUEST_ERROR;
  const code = rawCode.includes(adminKey) ? fallbackCode : rawCode;
  const message = rawMessage.includes(adminKey) ? SAFE_REQUEST_ERROR : rawMessage;
  return new AdminReviewApiError(message, { code, status: response.status });
}


export class AdminReviewApi {
  constructor({
    apiBaseUrl = appConfig.api.baseUrl,
    fetchImpl = (...args) => globalThis.fetch(...args),
  } = {}) {
    this._apiBaseUrl =
      typeof apiBaseUrl === "string" ? apiBaseUrl.trim().replace(/\/+$/, "") : "";
    this._fetch = fetchImpl;
  }

  async _request(path, { adminKey, method = "GET", body, responseType = "json" }) {
    const key = requiredAdminKey(adminKey);
    if (!this._apiBaseUrl) {
      throw new AdminReviewApiError("The backend API URL is not configured.", {
        code: "API_NOT_CONFIGURED",
      });
    }

    const headers = {
      Accept: responseType === "blob" ? "audio/*" : "application/json",
      "X-Admin-Key": key,
    };
    const options = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await this._fetch(`${this._apiBaseUrl}${path}`, options);
    } catch (error) {
      if (error instanceof AdminReviewApiError) throw error;
      throw new AdminReviewApiError("The admin API could not be reached.", {
        code: "NETWORK_ERROR",
      });
    }

    if (!response.ok) {
      throw apiErrorFromResponse(response, await readJson(response), key);
    }
    return responseType === "blob" ? response : readJson(response);
  }

  async listContributions({ adminKey, status = "pending", limit = 20, offset = 0 }) {
    const filter = validFilter(status);
    const safeLimit = paginationValue(limit, {
      name: "limit",
      defaultValue: 20,
      minimum: 1,
      maximum: 100,
    });
    const safeOffset = paginationValue(offset, {
      name: "offset",
      defaultValue: 0,
      minimum: 0,
    });
    const query = new URLSearchParams({
      status: filter,
      limit: String(safeLimit),
      offset: String(safeOffset),
    });
    const response = await this._request(`/admin/contributions?${query}`, { adminKey });
    return validateAdminContributionPage(response, filter);
  }

  async getContribution({ adminKey, contributionId }) {
    const id = encodeURIComponent(validContributionId(contributionId));
    const response = await this._request(`/admin/contributions/${id}`, { adminKey });
    return validateAdminContribution(response);
  }

  async getContributionAudio({ adminKey, contributionId }) {
    const id = encodeURIComponent(validContributionId(contributionId));
    const response = await this._request(`/admin/contributions/${id}/audio`, {
      adminKey,
      responseType: "blob",
    });
    const mimeType = normalizeAudioMimeType(response.headers?.get?.("content-type"));
    if (!AUDIO_MIME_TYPES.has(mimeType)) {
      throw new AdminReviewApiError("The contribution audio format is invalid.", {
        code: "INVALID_AUDIO_RESPONSE",
        status: response.status,
      });
    }
    let blob;
    try {
      blob = await response.blob();
    } catch {
      blob = null;
    }
    if (!(blob instanceof Blob)) {
      throw new AdminReviewApiError("The contribution audio could not be read.", {
        code: "INVALID_AUDIO_RESPONSE",
        status: response.status,
      });
    }
    return blob;
  }

  async reviewContribution({ adminKey, contributionId, status, rejectionReason = "" }) {
    const id = encodeURIComponent(validContributionId(contributionId));
    const reviewStatus = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!REVIEW_STATUSES.has(reviewStatus)) {
      throw new AdminReviewApiError("The review decision is invalid.", {
        code: "INVALID_REVIEW_STATUS",
      });
    }
    const reason = typeof rejectionReason === "string" ? rejectionReason.trim() : "";
    if (reviewStatus === "rejected" && !reason) {
      throw new AdminReviewApiError("A rejection reason is required.", {
        code: "REJECTION_REASON_REQUIRED",
      });
    }
    if (reason.length > 500) {
      throw new AdminReviewApiError("The rejection reason is too long.", {
        code: "INVALID_REJECTION_REASON",
      });
    }
    const payload = { status: reviewStatus };
    if (reviewStatus === "rejected") payload.rejectionReason = reason;
    const response = await this._request(`/admin/contributions/${id}/review`, {
      adminKey,
      method: "PATCH",
      body: payload,
    });
    return validateAdminContribution(response);
  }
}


const defaultAdminReviewApi = new AdminReviewApi();


export function getAdminContributions(options) {
  return defaultAdminReviewApi.listContributions(options);
}


export const listAdminContributions = getAdminContributions;


export function getAdminContribution(options) {
  return defaultAdminReviewApi.getContribution(options);
}


export function getAdminContributionAudio(options) {
  return defaultAdminReviewApi.getContributionAudio(options);
}


export function reviewAdminContribution(options) {
  return defaultAdminReviewApi.reviewContribution(options);
}
