import { appConfig } from "../config.js";
import { getCurrentAccessToken } from "./auth-service.js?v=20260717-unified-auth";


const LEADERBOARD_PATH = "/leaderboard";
const PERSONAL_CONTEXT_PATH = "/leaderboard/me/context";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SAFE_REQUEST_ERROR = "The leaderboard request could not be completed.";
const SAFE_BACKEND_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_ACCESS_TOKEN",
  "LEADERBOARD_CONTEXT_QUERY_FAILED",
  "LEADERBOARD_QUERY_FAILED",
  "LEADERBOARD_REQUEST_FAILED",
]);
const UNSAFE_ERROR_DETAIL =
  /(?:access[_ -]?token|refresh[_ -]?token|bearer\s|admin[_ -]?key|secret|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\/(?:users|private|var|home)\/)/i;


export class LeaderboardApiError extends Error {
  constructor(message, { code = "LEADERBOARD_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.name = "LeaderboardApiError";
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
    throw new LeaderboardApiError(`${name} is outside the allowed range.`, {
      code,
    });
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
    throw new LeaderboardApiError("Authentication is required.", {
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
  }
  return accessToken;
}


function safeLeaderboardItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const displayName =
    typeof item.displayName === "string" ? item.displayName.trim() : "";
  const valid =
    Number.isInteger(item.rank) &&
    item.rank >= 1 &&
    displayName.length >= 1 &&
    displayName.length <= 80 &&
    Number.isInteger(item.approvedContributions) &&
    item.approvedContributions >= 1;
  if (!valid) return null;
  return {
    rank: item.rank,
    displayName,
    approvedContributions: item.approvedContributions,
  };
}


export function validateLeaderboardResponse(payload, status = 200) {
  const items = Array.isArray(payload?.items)
    ? payload.items.map((item) => safeLeaderboardItem(item))
    : null;
  const valid =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
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
    throw new LeaderboardApiError(
      "The leaderboard service returned an invalid response.",
      { code: "LEADERBOARD_RESPONSE_INVALID", status },
    );
  }
  return {
    items,
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
  };
}


function safePersonalLeaderboardItem(item) {
  const publicItem = safeLeaderboardItem(item);
  if (!publicItem || typeof item?.isCurrentUser !== "boolean") return null;
  return { ...publicItem, isCurrentUser: item.isCurrentUser };
}


function safeCurrentUser(currentUser) {
  if (!currentUser || typeof currentUser !== "object") return null;
  const displayName =
    typeof currentUser.displayName === "string"
      ? currentUser.displayName.trim()
      : "";
  const rankValid =
    currentUser.rank === null ||
    (Number.isInteger(currentUser.rank) && currentUser.rank >= 1);
  if (
    !rankValid ||
    displayName.length < 2 ||
    displayName.length > 80 ||
    !Number.isInteger(currentUser.approvedContributions) ||
    currentUser.approvedContributions < 0
  ) {
    return null;
  }
  return {
    rank: currentUser.rank,
    displayName,
    approvedContributions: currentUser.approvedContributions,
  };
}


export function validatePersonalLeaderboardContext(payload, status = 200) {
  const items = Array.isArray(payload?.items)
    ? payload.items.map((item) => safePersonalLeaderboardItem(item))
    : null;
  const currentUser = safeCurrentUser(payload?.currentUser);
  const validPage =
    Number.isInteger(payload?.total) &&
    payload.total >= 0 &&
    Number.isInteger(payload?.limit) &&
    payload.limit >= 1 &&
    payload.limit <= MAX_LIMIT &&
    Number.isInteger(payload?.offset) &&
    payload.offset >= 0 &&
    items &&
    items.every(Boolean) &&
    items.length <= payload.limit;
  const eligible = payload?.leaderboardEligible === true;
  const validEligibility =
    typeof payload?.leaderboardOptIn === "boolean" &&
    typeof payload?.leaderboardEligible === "boolean" &&
    currentUser &&
    items &&
    (eligible
      ? currentUser.rank !== null &&
        payload.total > 0 &&
        items.filter((item) => item.isCurrentUser).length === 1
      : currentUser.rank === null &&
        payload.total === 0 &&
        payload.offset === 0 &&
        items.length === 0);
  if (!validPage || !validEligibility) {
    throw new LeaderboardApiError(
      "The leaderboard service returned an invalid response.",
      { code: "LEADERBOARD_RESPONSE_INVALID", status },
    );
  }
  return {
    leaderboardOptIn: payload.leaderboardOptIn,
    leaderboardEligible: payload.leaderboardEligible,
    currentUser,
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


function safeBackendError(response, body) {
  const rawCode =
    typeof body?.code === "string" && body.code.trim()
      ? body.code.trim()
      : "LEADERBOARD_REQUEST_FAILED";
  const code = SAFE_BACKEND_CODES.has(rawCode)
    ? rawCode
    : "LEADERBOARD_REQUEST_FAILED";
  const rawMessage =
    typeof body?.message === "string" && body.message.trim()
      ? body.message.trim()
      : SAFE_REQUEST_ERROR;
  const message =
    SAFE_BACKEND_CODES.has(rawCode) &&
    rawMessage.length <= 240 &&
    !UNSAFE_ERROR_DETAIL.test(rawMessage)
      ? rawMessage
      : SAFE_REQUEST_ERROR;
  return new LeaderboardApiError(message, { code, status: response.status });
}


export class LeaderboardApi {
  constructor({
    apiBaseUrl = appConfig.api.baseUrl,
    fetchImpl = (...args) => globalThis.fetch(...args),
    getAccessToken = getCurrentAccessToken,
  } = {}) {
    this._apiBaseUrl =
      typeof apiBaseUrl === "string" ? apiBaseUrl.trim().replace(/\/+$/, "") : "";
    this._fetch = fetchImpl;
    this._getAccessToken = getAccessToken;
  }

  async getPublicLeaderboard({ limit = DEFAULT_LIMIT, offset = 0 } = {}) {
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
    const query = new URLSearchParams({
      limit: String(safeLimit),
      offset: String(safeOffset),
    });

    let response;
    try {
      response = await this._fetch(
        `${this._apiBaseUrl}${LEADERBOARD_PATH}?${query}`,
        {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          headers: { Accept: "application/json" },
        },
      );
    } catch {
      throw new LeaderboardApiError("The KP AWAZ backend could not be reached.", {
        code: "NETWORK_ERROR",
      });
    }

    const body = await readJson(response);
    if (!response.ok) throw safeBackendError(response, body);
    return validateLeaderboardResponse(body, response.status);
  }

  async getPersonalLeaderboardContext({ limit = DEFAULT_LIMIT } = {}) {
    const safeLimit = paginationValue(limit, {
      name: "limit",
      defaultValue: DEFAULT_LIMIT,
      minimum: 1,
      maximum: MAX_LIMIT,
      code: "INVALID_LIMIT",
    });
    const accessToken = requiredAccessToken(this._getAccessToken);
    const query = new URLSearchParams({ limit: String(safeLimit) });

    let response;
    try {
      response = await this._fetch(
        `${this._apiBaseUrl}${PERSONAL_CONTEXT_PATH}?${query}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
    } catch {
      throw new LeaderboardApiError("The KP AWAZ backend could not be reached.", {
        code: "NETWORK_ERROR",
      });
    }

    const body = await readJson(response);
    if (!response.ok) throw safeBackendError(response, body);
    return validatePersonalLeaderboardContext(body, response.status);
  }
}


const leaderboardApi = new LeaderboardApi();


export const getPublicLeaderboard = (pagination) =>
  leaderboardApi.getPublicLeaderboard(pagination);
export const getPersonalLeaderboardContext = (pagination) =>
  leaderboardApi.getPersonalLeaderboardContext(pagination);
