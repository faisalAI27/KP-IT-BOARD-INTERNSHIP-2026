import { appConfig } from "../config.js";
import { getCurrentAccessToken } from "./auth-service.js?v=20260717-auth-routing";
import {
  API_REQUEST_TIMEOUT_MS,
  fetchWithRequestTimeout,
} from "./request-timeout.js?v=20260718-stabilization";

export class TextContributionApiError extends Error {
  constructor(message, { code = "TEXT_CONTRIBUTION_FAILED", status = 0 } = {}) {
    super(message);
    this.name = "TextContributionApiError";
    this.code = code;
    this.status = status;
  }
}

export function validateTextContributionResponse(body, status = 201) {
  const valid =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Array.isArray(body.ids) &&
    body.ids.length > 0 &&
    body.ids.every((id) => typeof id === "string" && id.trim()) &&
    Number.isInteger(body.itemCount) &&
    body.itemCount === body.ids.length &&
    body.status === "queued" &&
    typeof body.createdAt === "string" &&
    !Number.isNaN(Date.parse(body.createdAt));
  if (!valid) {
    throw new TextContributionApiError(
      "The text contribution service returned an invalid response.",
      { code: "INVALID_TEXT_CONTRIBUTION_RESPONSE", status },
    );
  }
  return {
    ids: body.ids.map((id) => id.trim()),
    itemCount: body.itemCount,
    status: body.status,
    createdAt: body.createdAt,
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function accessTokenFrom(getAccessToken) {
  let token = "";
  try {
    token = getAccessToken();
  } catch {
    token = "";
  }
  if (typeof token !== "string" || !token.trim()) {
    throw new TextContributionApiError("Authentication is required.", {
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
  }
  return token.trim();
}

export class TextContributionsApi {
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

  async submit({ contributorName, textType, text = "", files = [] }) {
    const accessToken = accessTokenFrom(this._getAccessToken);
    const formData = new FormData();
    formData.append("contributorName", contributorName);
    formData.append("language", "Pashto");
    formData.append("textType", textType);
    if (typeof text === "string" && text.trim()) {
      formData.append("text", text.trim());
    }
    files.forEach((file) => formData.append("files", file, file.name));

    let response;
    try {
      response = await fetchWithRequestTimeout(
        this._fetch,
        `${this._apiBaseUrl}/contributions/text`,
        {
          method: "POST",
          body: formData,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        },
        { timeoutMs: this._requestTimeoutMs },
      );
    } catch {
      throw new TextContributionApiError(
        "The KP AWAZ backend could not be reached. Your text was not submitted.",
        { code: "NETWORK_ERROR" },
      );
    }

    const body = await readJson(response);
    if (!response.ok || response.status !== 201) {
      const rawMessage =
        typeof body?.message === "string" && body.message.trim()
          ? body.message.trim()
          : "The text contribution could not be submitted.";
      const message = rawMessage.includes(accessToken)
        ? "The text contribution could not be submitted."
        : rawMessage;
      throw new TextContributionApiError(message, {
        code:
          typeof body?.code === "string" && body.code.trim()
            ? body.code.trim()
            : "TEXT_CONTRIBUTION_FAILED",
        status: response.status,
      });
    }
    return validateTextContributionResponse(body, response.status);
  }
}

const textContributionsApi = new TextContributionsApi();

export const submitTextContribution = (input) =>
  textContributionsApi.submit(input);
