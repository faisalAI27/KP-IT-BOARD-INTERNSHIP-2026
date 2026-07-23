import { appConfig } from "../config.js";
import { getCurrentAccessToken } from "./auth-service.js?v=20260717-auth-routing";
import {
  API_REQUEST_TIMEOUT_MS,
  fetchWithRequestTimeout,
} from "./request-timeout.js?v=20260718-stabilization";


const WITHDRAWAL_PATH = "/withdrawals/me";
const WITHDRAWAL_SCOPES = new Set(["contribution", "all"]);
const WITHDRAWAL_STATUSES = new Set(["requested", "approved", "declined"]);
const SAFE_REQUEST_ERROR = "The withdrawal request could not be completed.";


export class WithdrawalApiError extends Error {
  constructor(message, { code = "WITHDRAWAL_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.name = "WithdrawalApiError";
    this.code = code;
    this.status = status;
  }
}


function requiredAccessToken(getAccessToken) {
  const value = getAccessToken();
  const token = typeof value === "string" ? value.trim() : "";
  if (!token) {
    throw new WithdrawalApiError("Authentication is required.", {
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
  }
  return token;
}


function optionalString(value) {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}


export function validateOwnerWithdrawal(item, status = 200) {
  const scope = typeof item?.scope === "string" ? item.scope.trim() : "";
  const requestStatus =
    typeof item?.status === "string" ? item.status.trim() : "";
  const contributionId = optionalString(item?.contributionId);
  const reason = optionalString(item?.reason);
  const valid =
    item &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    WITHDRAWAL_SCOPES.has(scope) &&
    WITHDRAWAL_STATUSES.has(requestStatus) &&
    contributionId !== undefined &&
    reason !== undefined &&
    ((scope === "contribution" && Boolean(contributionId?.trim())) ||
      (scope === "all" && contributionId === null)) &&
    typeof item.requestedAt === "string" &&
    !Number.isNaN(Date.parse(item.requestedAt)) &&
    (item.resolvedAt === null ||
      (typeof item.resolvedAt === "string" &&
        !Number.isNaN(Date.parse(item.resolvedAt))));
  if (!valid) {
    throw new WithdrawalApiError(
      "The withdrawal service returned an invalid response.",
      { code: "INVALID_WITHDRAWAL_RESPONSE", status },
    );
  }
  return {
    scope,
    status: requestStatus,
    contributionId: contributionId === null ? null : contributionId.trim(),
    reason: reason === null ? null : reason.trim() || null,
    requestedAt: item.requestedAt,
    resolvedAt: item.resolvedAt,
  };
}


export function validateOwnerWithdrawalPage(body, status = 200) {
  let items = null;
  if (Array.isArray(body?.items)) {
    try {
      items = body.items.map((item) => validateOwnerWithdrawal(item, status));
    } catch {
      items = null;
    }
  }
  const valid =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    items &&
    Number.isInteger(body.total) &&
    body.total >= items.length &&
    Number.isInteger(body.limit) &&
    body.limit >= 1 &&
    body.limit <= 100 &&
    Number.isInteger(body.offset) &&
    body.offset >= 0;
  if (!valid) {
    throw new WithdrawalApiError(
      "The withdrawal service returned an invalid response.",
      { code: "INVALID_WITHDRAWAL_RESPONSE", status },
    );
  }
  return {
    items,
    total: body.total,
    limit: body.limit,
    offset: body.offset,
  };
}


function prepareCreatePayload({ scope, contributionId, reason = "" }) {
  const normalizedScope = typeof scope === "string" ? scope.trim() : "";
  if (!WITHDRAWAL_SCOPES.has(normalizedScope)) {
    throw new WithdrawalApiError("Choose a valid withdrawal scope.", {
      code: "INVALID_WITHDRAWAL_SCOPE",
    });
  }
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  if (normalizedReason.length > 500) {
    throw new WithdrawalApiError("The optional reason is too long.", {
      code: "INVALID_WITHDRAWAL_REASON",
    });
  }
  const payload = { scope: normalizedScope };
  if (normalizedScope === "contribution") {
    const id = typeof contributionId === "string" ? contributionId.trim() : "";
    if (!id) {
      throw new WithdrawalApiError("Choose one recording to withdraw.", {
        code: "WITHDRAWAL_CONTRIBUTION_REQUIRED",
      });
    }
    payload.contributionId = id;
  }
  if (normalizedReason) payload.reason = normalizedReason;
  return payload;
}


async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}


function errorFromResponse(response, body, accessToken) {
  const rawMessage =
    typeof body?.message === "string" && body.message.trim()
      ? body.message.trim()
      : SAFE_REQUEST_ERROR;
  const rawCode =
    typeof body?.code === "string" && body.code.trim()
      ? body.code.trim()
      : "WITHDRAWAL_REQUEST_FAILED";
  return new WithdrawalApiError(
    rawMessage.includes(accessToken) ? SAFE_REQUEST_ERROR : rawMessage,
    {
      code: rawCode.includes(accessToken) ? "WITHDRAWAL_REQUEST_FAILED" : rawCode,
      status: response.status,
    },
  );
}


export class WithdrawalsApi {
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

  async _request({ method = "GET", body } = {}) {
    const accessToken = requiredAccessToken(this._getAccessToken);
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    const options = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetchWithRequestTimeout(
        this._fetch,
        `${this._apiBaseUrl}${WITHDRAWAL_PATH}`,
        options,
        { timeoutMs: this._requestTimeoutMs },
      );
    } catch {
      throw new WithdrawalApiError("The KP AWAZ backend could not be reached.", {
        code: "NETWORK_ERROR",
      });
    }
    const responseBody = await readJson(response);
    if (!response.ok) throw errorFromResponse(response, responseBody, accessToken);
    return { body: responseBody, status: response.status };
  }

  async listMyRequests() {
    const response = await this._request();
    return validateOwnerWithdrawalPage(response.body, response.status);
  }

  async createMyRequest(input) {
    const response = await this._request({
      method: "POST",
      body: prepareCreatePayload(input),
    });
    return validateOwnerWithdrawal(response.body, response.status);
  }
}


const withdrawalsApi = new WithdrawalsApi();


export const listMyWithdrawalRequests = () => withdrawalsApi.listMyRequests();
export const createMyWithdrawalRequest = (input) =>
  withdrawalsApi.createMyRequest(input);
