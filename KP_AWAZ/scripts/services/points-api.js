import { appConfig } from "../config.js";
import { getCurrentAccessToken } from "./auth-service.js?v=20260723-auth-config-v2";
import {
  API_REQUEST_TIMEOUT_MS,
  fetchWithRequestTimeout,
} from "./request-timeout.js?v=20260718-stabilization";


const POINTS_PATH = "/profile/me/points";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SAFE_REQUEST_ERROR = "The points request could not be completed.";
const ENTRY_TYPES = new Set([
  "approvalAward",
  "approvalReversal",
  "approvedBackfill",
]);


export class PointsApiError extends Error {
  constructor(message, { code = "POINTS_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.name = "PointsApiError";
    this.code = code;
    this.status = status;
  }
}


function paginationValue(value, { name, defaultValue, minimum, maximum, code }) {
  const candidate = value === undefined ? defaultValue : value;
  if (
    !Number.isInteger(candidate) ||
    candidate < minimum ||
    (maximum !== undefined && candidate > maximum)
  ) {
    throw new PointsApiError(`${name} is outside the allowed range.`, { code });
  }
  return candidate;
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
    throw new PointsApiError("Authentication is required.", {
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
  }
  return accessToken;
}


function safeLedgerItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const entryType =
    typeof item.entryType === "string" ? item.entryType.trim() : "";
  const contributionId =
    typeof item.contributionId === "string" ? item.contributionId.trim() : "";
  const createdAt =
    typeof item.createdAt === "string" ? item.createdAt.trim() : "";
  const valid =
    id &&
    ENTRY_TYPES.has(entryType) &&
    Number.isInteger(item.pointsDelta) &&
    contributionId &&
    createdAt &&
    !Number.isNaN(Date.parse(createdAt));
  if (!valid) return null;
  return {
    id,
    entryType,
    pointsDelta: item.pointsDelta,
    contributionId,
    createdAt,
  };
}


export function validatePointsResponse(payload, status = 200) {
  const items = Array.isArray(payload?.items)
    ? payload.items.map((item) => safeLedgerItem(item))
    : null;
  const valid =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Number.isInteger(payload.balance) &&
    Number.isFinite(payload.balance) &&
    items &&
    items.every(Boolean) &&
    Number.isInteger(payload.total) &&
    payload.total >= 0 &&
    Number.isInteger(payload.limit) &&
    payload.limit >= 1 &&
    payload.limit <= MAX_LIMIT &&
    Number.isInteger(payload.offset) &&
    payload.offset >= 0 &&
    items.length <= payload.limit;
  if (!valid) {
    throw new PointsApiError("The points service returned an invalid response.", {
      code: "POINTS_RESPONSE_INVALID",
      status,
    });
  }
  return {
    balance: Object.is(payload.balance, -0) ? 0 : payload.balance,
    items,
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
  };
}


async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}


function safeBackendError(response, body, accessToken) {
  const rawMessage =
    typeof body?.message === "string" && body.message.trim()
      ? body.message.trim()
      : SAFE_REQUEST_ERROR;
  const rawCode =
    typeof body?.code === "string" && body.code.trim()
      ? body.code.trim()
      : "POINTS_REQUEST_FAILED";
  const message =
    accessToken && rawMessage.includes(accessToken)
      ? SAFE_REQUEST_ERROR
      : rawMessage;
  const code =
    accessToken && rawCode.includes(accessToken)
      ? "POINTS_REQUEST_FAILED"
      : rawCode;
  return new PointsApiError(message, { code, status: response.status });
}


export class PointsApi {
  constructor({
    apiBaseUrl = appConfig.api.baseUrl,
    fetchImpl = (...args) => globalThis.fetch(...args),
    getAccessToken = getCurrentAccessToken,
    requestTimeoutMs = API_REQUEST_TIMEOUT_MS,
  } = {}) {
    this._apiBaseUrl =
      typeof apiBaseUrl === "string" ? apiBaseUrl.trim().replace(/\/+$/, "") : "";
    this._fetch = fetchImpl;
    this._getAccessToken = getAccessToken;
    this._requestTimeoutMs = requestTimeoutMs;
  }

  async getMyPoints({ limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const safeLimit = paginationValue(limit, {
      name: "limit",
      defaultValue: DEFAULT_LIMIT,
      minimum: 1,
      maximum: MAX_LIMIT,
      code: "INVALID_LIMIT",
    });
    const safeOffset = paginationValue(offset, {
      name: "offset",
      defaultValue: 0,
      minimum: 0,
      code: "INVALID_OFFSET",
    });
    const accessToken = requiredAccessToken(this._getAccessToken);
    const query = new URLSearchParams({
      limit: String(safeLimit),
      offset: String(safeOffset),
    });

    let response;
    try {
      response = await fetchWithRequestTimeout(
        this._fetch,
        `${this._apiBaseUrl}${POINTS_PATH}?${query}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        },
        { timeoutMs: this._requestTimeoutMs },
      );
    } catch {
      throw new PointsApiError("The KP AWAZ backend could not be reached.", {
        code: "NETWORK_ERROR",
      });
    }

    const body = await readJson(response);
    if (!response.ok) throw safeBackendError(response, body, accessToken);
    return validatePointsResponse(body, response.status);
  }
}


const pointsApi = new PointsApi();


export const getMyPoints = (pagination) => pointsApi.getMyPoints(pagination);
