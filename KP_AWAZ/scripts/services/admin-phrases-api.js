import { appConfig } from "../config.js";
import {
  API_REQUEST_TIMEOUT_MS,
  fetchWithRequestTimeout,
} from "./request-timeout.js?v=20260718-stabilization";

const IMPORT_EXTENSIONS = new Set(["csv", "json", "txt"]);
const EXPORT_FORMATS = new Set(["csv", "json"]);
const ORDERS = new Set(["newest", "oldest"]);
const SAFE_REQUEST_ERROR =
  "The phrase request could not be completed. Please try again.";


export class AdminPhrasesApiError extends Error {
  constructor(message, { code = "ADMIN_PHRASE_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.name = "AdminPhrasesApiError";
    this.code = code;
    this.status = status;
  }
}


function requiredAdminKey(adminKey) {
  const key = typeof adminKey === "string" ? adminKey.trim() : "";
  if (!key) {
    throw new AdminPhrasesApiError("An admin key is required.", {
      code: "ADMIN_KEY_REQUIRED",
      status: 401,
    });
  }
  return key;
}


function safeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}


function optionalString(value) {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}


export function validateAdminPhrase(item, status = 200) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new AdminPhrasesApiError("The phrase service returned an invalid response.", {
      code: "INVALID_PHRASE_RESPONSE",
      status,
    });
  }
  const category = optionalString(item.category);
  const dialect = optionalString(item.dialect);
  const source = optionalString(item.source);
  const difficulty = optionalString(item.difficulty);
  const valid =
    typeof item.id === "string" &&
    item.id.trim() &&
    typeof item.text === "string" &&
    item.text.trim() &&
    typeof item.language === "string" &&
    item.language.trim() &&
    category !== undefined &&
    dialect !== undefined &&
    source !== undefined &&
    difficulty !== undefined &&
    typeof item.active === "boolean" &&
    typeof item.created_at === "string" &&
    !Number.isNaN(Date.parse(item.created_at)) &&
    typeof item.updated_at === "string" &&
    !Number.isNaN(Date.parse(item.updated_at)) &&
    safeInteger(item.times_assigned) &&
    safeInteger(item.recordings_submitted) &&
    safeInteger(item.pending_count) &&
    safeInteger(item.approved_count) &&
    safeInteger(item.rejected_count);
  if (!valid) {
    throw new AdminPhrasesApiError("The phrase service returned an invalid response.", {
      code: "INVALID_PHRASE_RESPONSE",
      status,
    });
  }
  return {
    id: item.id.trim(),
    text: item.text,
    language: item.language.trim(),
    category,
    dialect,
    source,
    difficulty,
    active: item.active,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    timesAssigned: item.times_assigned,
    recordingsSubmitted: item.recordings_submitted,
    pendingCount: item.pending_count,
    approvedCount: item.approved_count,
    rejectedCount: item.rejected_count,
  };
}


export function validateAdminPhrasePage(body, status = 200) {
  const items = Array.isArray(body?.items)
    ? body.items.map((item) => validateAdminPhrase(item, status))
    : null;
  const valid =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    items &&
    safeInteger(body.total) &&
    Number.isInteger(body.limit) &&
    body.limit >= 1 &&
    body.limit <= 100 &&
    safeInteger(body.offset) &&
    typeof body.order === "string" &&
    ORDERS.has(body.order) &&
    items.length <= body.limit;
  if (!valid) {
    throw new AdminPhrasesApiError("The phrase list returned an invalid response.", {
      code: "INVALID_PHRASE_LIST_RESPONSE",
      status,
    });
  }
  return {
    items,
    total: body.total,
    limit: body.limit,
    offset: body.offset,
    order: body.order,
  };
}


export function validatePhraseImportSummary(body, status = 200) {
  const valid =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    safeInteger(body.received) &&
    safeInteger(body.created) &&
    safeInteger(body.duplicates) &&
    safeInteger(body.invalid);
  if (!valid) {
    throw new AdminPhrasesApiError("The phrase import returned an invalid summary.", {
      code: "INVALID_PHRASE_IMPORT_RESPONSE",
      status,
    });
  }
  return {
    received: body.received,
    created: body.created,
    duplicates: body.duplicates,
    invalid: body.invalid,
  };
}


function paginationValue(value, { name, defaultValue, minimum, maximum }) {
  const candidate = value === undefined ? defaultValue : value;
  if (
    !Number.isInteger(candidate) ||
    candidate < minimum ||
    (maximum !== undefined && candidate > maximum)
  ) {
    throw new AdminPhrasesApiError(`${name} is outside the allowed range.`, {
      code: "INVALID_PAGINATION",
    });
  }
  return candidate;
}


function importFilename(file) {
  const name = typeof file?.name === "string" ? file.name.trim() : "";
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  if (!name || !IMPORT_EXTENSIONS.has(extension)) {
    throw new AdminPhrasesApiError(
      "Choose a CSV, JSON, or TXT phrase file to import.",
      { code: "INVALID_PHRASE_FILE" },
    );
  }
  return name.split(/[\\/]/).pop();
}


function safeUpdatePayload(updates) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new AdminPhrasesApiError("Phrase changes are invalid.", {
      code: "INVALID_PHRASE_UPDATE",
    });
  }
  const allowed = new Set([
    "text",
    "language",
    "category",
    "dialect",
    "source",
    "difficulty",
    "active",
  ]);
  const payload = {};
  for (const [key, value] of Object.entries(updates)) {
    if (!allowed.has(key)) continue;
    payload[key] = value;
  }
  if (Object.keys(payload).length === 0) {
    throw new AdminPhrasesApiError("No supported phrase changes were supplied.", {
      code: "INVALID_PHRASE_UPDATE",
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


function apiErrorFromResponse(response, body, adminKey) {
  const fallbackCode =
    response.status === 401
      ? "ADMIN_KEY_REQUIRED"
      : response.status === 403
        ? "INVALID_ADMIN_KEY"
        : "ADMIN_PHRASE_REQUEST_FAILED";
  const rawCode = typeof body?.code === "string" ? body.code.trim() : "";
  const code = rawCode && !rawCode.includes(adminKey) ? rawCode : fallbackCode;
  return new AdminPhrasesApiError(SAFE_REQUEST_ERROR, {
    code,
    status: response.status,
  });
}


function exportFilename(response, format) {
  const header = response.headers?.get?.("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(header);
  const candidate = match?.[1]?.split(/[\\/]/).pop()?.trim() ?? "";
  const safe = candidate.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe.toLowerCase().endsWith(`.${format}`)
    ? safe
    : `kp_awaz_phrases.${format}`;
}


export class AdminPhrasesApi {
  constructor({
    apiBaseUrl = appConfig.api.baseUrl,
    fetchImpl = (...args) => globalThis.fetch(...args),
    requestTimeoutMs = API_REQUEST_TIMEOUT_MS,
  } = {}) {
    this._apiBaseUrl =
      typeof apiBaseUrl === "string" ? apiBaseUrl.trim().replace(/\/+$/, "") : "";
    this._fetch = fetchImpl;
    this._requestTimeoutMs = requestTimeoutMs;
  }

  async _request(path, {
    adminKey,
    method = "GET",
    body,
    bodyType = "json",
    responseType = "json",
  }) {
    const key = requiredAdminKey(adminKey);
    if (!this._apiBaseUrl) {
      throw new AdminPhrasesApiError("The backend API URL is not configured.", {
        code: "API_NOT_CONFIGURED",
      });
    }
    const headers = {
      Accept: responseType === "blob" ? "text/csv, application/json" : "application/json",
      "X-Admin-Key": key,
    };
    const options = { method, headers };
    if (body !== undefined) {
      if (bodyType === "form") {
        options.body = body;
      } else {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
    }
    let response;
    try {
      response = await fetchWithRequestTimeout(
        this._fetch,
        `${this._apiBaseUrl}${path}`,
        options,
        { timeoutMs: this._requestTimeoutMs },
      );
    } catch {
      throw new AdminPhrasesApiError("The phrase service could not be reached.", {
        code: "NETWORK_ERROR",
      });
    }
    if (!response.ok) {
      throw apiErrorFromResponse(response, await readJson(response), key);
    }
    if (responseType === "blob") return response;
    return { body: await readJson(response), status: response.status };
  }

  async listPhrases({
    adminKey,
    limit = 20,
    offset = 0,
    search = "",
    language = "",
    active = undefined,
    order = "newest",
  }) {
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
    const safeOrder = typeof order === "string" ? order.trim().toLowerCase() : "";
    if (!ORDERS.has(safeOrder)) {
      throw new AdminPhrasesApiError("The phrase ordering is invalid.", {
        code: "INVALID_PHRASE_ORDER",
      });
    }
    if (active !== undefined && typeof active !== "boolean") {
      throw new AdminPhrasesApiError("The phrase status filter is invalid.", {
        code: "INVALID_PHRASE_STATUS_FILTER",
      });
    }
    const query = new URLSearchParams({
      limit: String(safeLimit),
      offset: String(safeOffset),
      order: safeOrder,
    });
    const normalizedSearch = typeof search === "string" ? search.trim() : "";
    const normalizedLanguage = typeof language === "string" ? language.trim() : "";
    if (normalizedSearch) query.set("search", normalizedSearch);
    if (normalizedLanguage) query.set("language", normalizedLanguage);
    if (active !== undefined) query.set("active", String(active));
    const response = await this._request(`/admin/phrases?${query}`, { adminKey });
    return validateAdminPhrasePage(response.body, response.status);
  }

  async importPhrases({ adminKey, file }) {
    const filename = importFilename(file);
    const form = new FormData();
    form.append("file", file, filename);
    const response = await this._request("/admin/phrases/import", {
      adminKey,
      method: "POST",
      body: form,
      bodyType: "form",
    });
    return validatePhraseImportSummary(response.body, response.status);
  }

  async updatePhrase({ adminKey, phraseId, updates }) {
    const id = typeof phraseId === "string" ? phraseId.trim() : "";
    if (!id) {
      throw new AdminPhrasesApiError("A phrase reference is required.", {
        code: "INVALID_PHRASE_ID",
      });
    }
    const response = await this._request(`/admin/phrases/${encodeURIComponent(id)}`, {
      adminKey,
      method: "PATCH",
      body: safeUpdatePayload(updates),
    });
    return validateAdminPhrase(response.body, response.status);
  }

  async exportPhrases({ adminKey, format, activeOnly }) {
    const normalizedFormat = typeof format === "string" ? format.trim().toLowerCase() : "";
    if (!EXPORT_FORMATS.has(normalizedFormat) || typeof activeOnly !== "boolean") {
      throw new AdminPhrasesApiError("The phrase export choice is invalid.", {
        code: "INVALID_PHRASE_EXPORT",
      });
    }
    const query = new URLSearchParams({
      format: normalizedFormat,
      active_only: String(activeOnly),
    });
    const response = await this._request(`/admin/phrases/export?${query}`, {
      adminKey,
      responseType: "blob",
    });
    let blob;
    try {
      blob = await response.blob();
    } catch {
      blob = null;
    }
    if (!(blob instanceof Blob)) {
      throw new AdminPhrasesApiError("The phrase export could not be read.", {
        code: "INVALID_PHRASE_EXPORT_RESPONSE",
        status: response.status,
      });
    }
    return {
      blob,
      filename: exportFilename(response, normalizedFormat),
    };
  }
}


const defaultAdminPhrasesApi = new AdminPhrasesApi();


export function listAdminPhrases(options) {
  return defaultAdminPhrasesApi.listPhrases(options);
}


export function importAdminPhrases(options) {
  return defaultAdminPhrasesApi.importPhrases(options);
}


export function updateAdminPhrase(options) {
  return defaultAdminPhrasesApi.updatePhrase(options);
}


export function exportAdminPhrases(options) {
  return defaultAdminPhrasesApi.exportPhrases(options);
}
