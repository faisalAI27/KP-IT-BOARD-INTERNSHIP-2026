import { appConfig } from "../config.js";
import { getCurrentAccessToken } from "./auth-service.js?v=20260717-email-otp";


const PROFILE_PATH = "/profile/me";
const ALLOWED_UPDATE_FIELDS = new Set([
  "displayName",
  "preferredLanguage",
  "leaderboardOptIn",
]);
const SAFE_REQUEST_ERROR = "The profile request could not be completed.";


export class ProfileApiError extends Error {
  constructor(message, { code = "PROFILE_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.name = "ProfileApiError";
    this.code = code;
    this.status = status;
  }
}


function safeNullableString(value) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
}


export function validateProfileResponse(payload, status = 200) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProfileApiError("The profile service returned an invalid response.", {
      code: "PROFILE_RESPONSE_INVALID",
      status,
    });
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const displayName =
    typeof payload.displayName === "string" ? payload.displayName.trim() : "";
  const preferredLanguage =
    typeof payload.preferredLanguage === "string"
      ? payload.preferredLanguage.trim()
      : "";
  const email = safeNullableString(payload.email);
  const authProvider = safeNullableString(payload.authProvider);
  const valid =
    id &&
    displayName.length >= 2 &&
    displayName.length <= 80 &&
    preferredLanguage.length >= 1 &&
    preferredLanguage.length <= 100 &&
    typeof payload.leaderboardOptIn === "boolean" &&
    email !== undefined &&
    authProvider !== undefined;

  if (!valid) {
    throw new ProfileApiError("The profile service returned an invalid response.", {
      code: "PROFILE_RESPONSE_INVALID",
      status,
    });
  }

  return {
    id,
    email,
    authProvider,
    displayName,
    preferredLanguage,
    leaderboardOptIn: payload.leaderboardOptIn,
  };
}


function prepareProfileUpdates(updates) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new ProfileApiError("At least one profile field must be supplied.", {
      code: "EMPTY_PROFILE_UPDATE",
    });
  }

  for (const fieldName of Object.keys(updates)) {
    if (!ALLOWED_UPDATE_FIELDS.has(fieldName)) {
      throw new ProfileApiError("Only profile preferences can be updated.", {
        code: "INVALID_PROFILE_UPDATE",
      });
    }
  }

  const payload = {};
  if (updates.displayName !== undefined) {
    const value =
      typeof updates.displayName === "string" ? updates.displayName.trim() : "";
    if (value.length < 2 || value.length > 80) {
      throw new ProfileApiError(
        "Display name must contain between 2 and 80 characters.",
        { code: "INVALID_DISPLAY_NAME" },
      );
    }
    payload.displayName = value;
  }
  if (updates.preferredLanguage !== undefined) {
    const value =
      typeof updates.preferredLanguage === "string"
        ? updates.preferredLanguage.trim()
        : "";
    if (!value || value.length > 100) {
      throw new ProfileApiError(
        "Preferred language must contain between 1 and 100 characters.",
        { code: "INVALID_PREFERRED_LANGUAGE" },
      );
    }
    payload.preferredLanguage = value;
  }
  if (updates.leaderboardOptIn !== undefined) {
    if (typeof updates.leaderboardOptIn !== "boolean") {
      throw new ProfileApiError("Leaderboard preference must be true or false.", {
        code: "INVALID_LEADERBOARD_PREFERENCE",
      });
    }
    payload.leaderboardOptIn = updates.leaderboardOptIn;
  }

  if (Object.keys(payload).length === 0) {
    throw new ProfileApiError("At least one profile field must be supplied.", {
      code: "EMPTY_PROFILE_UPDATE",
    });
  }
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
  const message =
    accessToken && rawMessage.includes(accessToken) ? SAFE_REQUEST_ERROR : rawMessage;
  const code =
    typeof body?.code === "string" && body.code.trim()
      ? body.code.trim()
      : "PROFILE_REQUEST_FAILED";
  return new ProfileApiError(message, { code, status: response.status });
}


export class ProfileApi {
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

  async getMyProfile() {
    return this._request("GET");
  }

  async updateMyProfile(updates) {
    return this._request("PATCH", prepareProfileUpdates(updates));
  }

  async _request(method, payload = null) {
    const token = this._getAccessToken();
    const accessToken = typeof token === "string" ? token.trim() : "";
    if (!accessToken) {
      throw new ProfileApiError("Authentication is required.", {
        code: "AUTHENTICATION_REQUIRED",
        status: 401,
      });
    }

    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    const options = { method, headers };
    if (payload) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(payload);
    }

    let response;
    try {
      response = await this._fetch(`${this._apiBaseUrl}${PROFILE_PATH}`, options);
    } catch {
      throw new ProfileApiError("The KP AWAZ backend could not be reached.", {
        code: "NETWORK_ERROR",
      });
    }

    const body = await readJson(response);
    if (!response.ok) throw errorFromResponse(response, body, accessToken);
    return validateProfileResponse(body, response.status);
  }
}


const profileApi = new ProfileApi();


export const getMyProfile = () => profileApi.getMyProfile();
export const updateMyProfile = (updates) => profileApi.updateMyProfile(updates);
