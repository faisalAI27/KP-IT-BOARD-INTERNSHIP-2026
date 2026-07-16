import {
  getCurrentAuthState,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
} from "../services/auth-service.js";
import { getMyContributions } from "../services/contributions-api.js";


export const CONTRIBUTION_CREATED_EVENT = "kp-awaz:contribution-created";
const PAGE_LIMIT = 10;
const UNAUTHORIZED_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_ACCESS_TOKEN",
]);
const SAFE_ERROR_CODES = new Set([
  ...UNAUTHORIZED_CODES,
  "INVALID_CONTRIBUTION_HISTORY_RESPONSE",
  "INVALID_PAGINATION",
  "NETWORK_ERROR",
  "REQUEST_FAILED",
]);


function verifiedUserId(state) {
  const userId =
    state?.status === "signed_in" && typeof state.backendUser?.id === "string"
      ? state.backendUser.id.trim()
      : "";
  return userId || null;
}


function safeHistoryItem(item) {
  const duration = item?.durationSeconds;
  return {
    id: typeof item?.id === "string" ? item.id.trim() : "",
    contributionType:
      typeof item?.contributionType === "string"
        ? item.contributionType.trim()
        : "",
    sentenceText:
      typeof item?.sentenceText === "string" ? item.sentenceText : null,
    topic: typeof item?.topic === "string" ? item.topic : null,
    language: typeof item?.language === "string" ? item.language.trim() : "",
    originalFilename:
      typeof item?.originalFilename === "string"
        ? item.originalFilename.trim()
        : "",
    mimeType: typeof item?.mimeType === "string" ? item.mimeType.trim() : "",
    durationSeconds:
      typeof duration === "number" && Number.isFinite(duration) && duration >= 0
        ? duration
        : null,
    createdAt: typeof item?.createdAt === "string" ? item.createdAt : "",
  };
}


function safePage(response) {
  return {
    items: Array.isArray(response?.items)
      ? response.items.map((item) => safeHistoryItem(item))
      : [],
    total: Number.isInteger(response?.total) && response.total >= 0
      ? response.total
      : 0,
    limit: Number.isInteger(response?.limit) ? response.limit : PAGE_LIMIT,
    offset: Number.isInteger(response?.offset) ? response.offset : 0,
  };
}


function deduplicateItems(items) {
  const seenIds = new Set();
  const unique = [];
  for (const item of items) {
    if (item.id && seenIds.has(item.id)) continue;
    if (item.id) seenIds.add(item.id);
    unique.push(item);
  }
  return unique;
}


function safeHistoryError(error, scope) {
  const rawCode = typeof error?.code === "string" ? error.code : "";
  const code = SAFE_ERROR_CODES.has(rawCode)
    ? rawCode
    : "CONTRIBUTION_HISTORY_REQUEST_FAILED";
  const status = Number.isInteger(error?.status) ? error.status : 0;
  const message =
    scope === "load-more"
      ? "We could not load more contributions."
      : scope === "refresh"
        ? "We could not refresh your contributions."
        : "We could not load your contributions.";
  return { code, message, status, scope };
}


function emptyState() {
  return {
    status: "idle",
    items: [],
    total: 0,
    limit: PAGE_LIMIT,
    offset: 0,
    error: null,
  };
}


function cloneState(state) {
  return {
    status: state.status,
    items: state.items.map((item) => ({ ...item })),
    total: state.total,
    limit: state.limit,
    offset: state.offset,
    error: state.error ? { ...state.error } : null,
  };
}


export function formatContributionType(value) {
  const type = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (type === "guided") return "Guided recording";
  if (type === "open" || type === "open_recording") return "Open recording";
  return "Voice contribution";
}


export function formatContributionDuration(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} seconds`;
}


export function formatContributionDate(value, locale = undefined) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    return "Submission date unavailable";
  }
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "Submission date unavailable";
  }
}


export function dispatchContributionCreated({
  eventTarget = globalThis.window,
  EventConstructor = globalThis.Event,
} = {}) {
  if (!eventTarget?.dispatchEvent || typeof EventConstructor !== "function") {
    return false;
  }
  eventTarget.dispatchEvent(new EventConstructor(CONTRIBUTION_CREATED_EVENT));
  return true;
}


const defaultAuthApi = Object.freeze({
  getCurrentAuthState,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
});
const defaultContributionsApi = Object.freeze({ getMyContributions });


export class MyContributions {
  constructor({
    root = globalThis.document,
    authApi = defaultAuthApi,
    contributionsApi = defaultContributionsApi,
    eventTarget = globalThis.window,
    locale = undefined,
  } = {}) {
    this._root = root;
    this._auth = authApi;
    this._api = contributionsApi;
    this._eventTarget = eventTarget;
    this._locale = locale;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._initialized = false;
    this._destroyed = false;
    this._generation = 0;
    this._lifecycleId = 0;
    this._activeUserId = null;
    this._refreshQueued = false;
    this._state = emptyState();
    this._handleContributionCreated = () => {
      if (this._destroyed || !this._activeUserId) return;
      if (this._state.status === "loading" || this._state.status === "loading-more") {
        this._refreshQueued = true;
        return;
      }
      void this.refresh();
    };
  }

  initializeMyContributions() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;

    this._destroyed = false;
    this._initialized = true;
    this._lifecycleId += 1;
    this._bindEvents();
    this._handleAuthState(this._auth.getCurrentAuthState());
    this._unsubscribe = this._auth.subscribeToAuthChanges((state) => {
      if (!this._destroyed) this._handleAuthState(state);
    });
    return true;
  }

  getState() {
    return cloneState(this._state);
  }

  async refresh() {
    if (
      this._destroyed ||
      !this._activeUserId ||
      this._state.status === "loading" ||
      this._state.status === "loading-more"
    ) {
      return false;
    }

    const generation = ++this._generation;
    const lifecycleId = this._lifecycleId;
    const userId = this._activeUserId;
    const hadItems = this._state.items.length > 0;
    this._state = {
      ...this._state,
      status: "loading",
      offset: 0,
      error: null,
    };
    this._render();

    try {
      const response = await this._api.getMyContributions({
        limit: PAGE_LIMIT,
        offset: 0,
      });
      if (!this._isCurrent(generation, lifecycleId, userId)) return false;
      const page = safePage(response);
      this._state = {
        status: "loaded",
        items: deduplicateItems(page.items),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        error: null,
      };
      this._render();
      this._runQueuedRefresh(generation, lifecycleId, userId);
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, lifecycleId, userId)) return false;
      if (this._isUnauthorized(error)) {
        this._handleUnauthorized();
        return false;
      }
      const scope = hadItems ? "refresh" : "initial";
      this._state = {
        ...this._state,
        status: hadItems ? "loaded" : "error",
        error: safeHistoryError(error, scope),
      };
      this._render();
      this._runQueuedRefresh(generation, lifecycleId, userId);
      return false;
    }
  }

  async loadMore() {
    if (
      this._destroyed ||
      !this._activeUserId ||
      this._state.status !== "loaded" ||
      this._state.items.length >= this._state.total
    ) {
      return false;
    }

    const generation = ++this._generation;
    const lifecycleId = this._lifecycleId;
    const userId = this._activeUserId;
    const offset = this._state.items.length;
    this._state = { ...this._state, status: "loading-more", error: null };
    this._render();

    try {
      const response = await this._api.getMyContributions({
        limit: PAGE_LIMIT,
        offset,
      });
      if (!this._isCurrent(generation, lifecycleId, userId)) return false;
      const page = safePage(response);
      this._state = {
        status: "loaded",
        items: deduplicateItems([...this._state.items, ...page.items]),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        error: null,
      };
      this._render();
      this._runQueuedRefresh(generation, lifecycleId, userId);
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, lifecycleId, userId)) return false;
      if (this._isUnauthorized(error)) {
        this._handleUnauthorized();
        return false;
      }
      this._state = {
        ...this._state,
        status: "loaded",
        error: safeHistoryError(error, "load-more"),
      };
      this._render();
      this._runQueuedRefresh(generation, lifecycleId, userId);
      return false;
    }
  }

  destroyMyContributions() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._initialized = false;
    this._generation += 1;
    this._lifecycleId += 1;
    this._activeUserId = null;
    this._refreshQueued = false;
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._state = emptyState();
    this._render();
  }

  _resolveElements() {
    if (!this._root?.getElementById) return null;
    const ids = {
      section: "myContributionsSection",
      status: "myContributionsStatus",
      list: "myContributionsList",
      empty: "myContributionsEmpty",
      error: "myContributionsError",
      errorMessage: "myContributionsErrorMessage",
      refreshButton: "refreshContributionsButton",
      loadMoreButton: "loadMoreContributionsButton",
      retryButton: "retryContributionsButton",
      loadMoreError: "myContributionsLoadMoreError",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, this._root.getElementById(id)]),
    );
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.refreshButton, "click", () => {
      void this.refresh();
    });
    this._listen(this._elements.retryButton, "click", () => {
      void this.refresh();
    });
    this._listen(this._elements.loadMoreButton, "click", () => {
      void this.loadMore();
    });
    if (this._eventTarget?.addEventListener) {
      this._listen(
        this._eventTarget,
        CONTRIBUTION_CREATED_EVENT,
        this._handleContributionCreated,
      );
    }
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _handleAuthState(authState) {
    const nextUserId = verifiedUserId(authState);
    if (!nextUserId) {
      this._resetHistory();
      return;
    }
    if (
      nextUserId === this._activeUserId &&
      this._state.status !== "idle"
    ) {
      return;
    }

    this._generation += 1;
    this._activeUserId = nextUserId;
    this._refreshQueued = false;
    this._state = emptyState();
    this._render();
    void this.refresh();
  }

  _resetHistory() {
    const alreadyReset =
      this._activeUserId === null &&
      this._state.status === "idle" &&
      this._state.items.length === 0;
    if (!alreadyReset) this._generation += 1;
    this._activeUserId = null;
    this._refreshQueued = false;
    this._state = emptyState();
    this._render();
  }

  _isUnauthorized(error) {
    return error?.status === 401 || UNAUTHORIZED_CODES.has(error?.code);
  }

  _handleUnauthorized() {
    this._resetHistory();
    Promise.resolve()
      .then(() => this._auth.verifyCurrentUserWithBackend())
      .catch(() => {});
  }

  _isCurrent(generation, lifecycleId, userId) {
    return (
      !this._destroyed &&
      generation === this._generation &&
      lifecycleId === this._lifecycleId &&
      userId === this._activeUserId
    );
  }

  _runQueuedRefresh(generation, lifecycleId, userId) {
    if (
      !this._refreshQueued ||
      !this._isCurrent(generation, lifecycleId, userId)
    ) {
      return;
    }
    this._refreshQueued = false;
    queueMicrotask(() => {
      if (!this._destroyed && userId === this._activeUserId) void this.refresh();
    });
  }

  _createMetadataRow(label, value, { language = null } = {}) {
    const row = this._root.createElement("div");
    row.className = "my-contribution-meta-row";
    const term = this._root.createElement("dt");
    term.textContent = label;
    const description = this._root.createElement("dd");
    description.textContent = value;
    if (language?.toLowerCase() === "pashto") {
      description.setAttribute("lang", "ps");
      description.setAttribute("dir", "rtl");
    }
    row.append(term, description);
    return row;
  }

  _createContributionItem(item) {
    const card = this._root.createElement("li");
    card.className = "my-contribution-card";
    card.tabIndex = 0;

    const title = this._root.createElement("h4");
    title.textContent = formatContributionType(item.contributionType);
    const metadata = this._root.createElement("dl");
    metadata.className = "my-contribution-metadata";
    const prompt = item.sentenceText || item.topic;
    if (prompt) {
      metadata.append(
        this._createMetadataRow(item.sentenceText ? "Sentence" : "Topic", prompt, {
          language: item.language,
        }),
      );
    }
    metadata.append(this._createMetadataRow("Language", item.language));
    const duration = formatContributionDuration(item.durationSeconds);
    if (duration) metadata.append(this._createMetadataRow("Duration", duration));
    metadata.append(
      this._createMetadataRow(
        "Submitted",
        formatContributionDate(item.createdAt, this._locale),
      ),
    );
    metadata.append(this._createMetadataRow("File", item.originalFilename));
    metadata.append(this._createMetadataRow("Format", item.mimeType));
    card.append(title, metadata);
    return card;
  }

  _renderList() {
    const cards = this._state.items.map((item) =>
      this._createContributionItem(item),
    );
    this._elements.list.replaceChildren(...cards);
  }

  _render() {
    if (!this._elements) return;
    const active = Boolean(this._activeUserId) && !this._destroyed;
    const loading = this._state.status === "loading";
    const loadingMore = this._state.status === "loading-more";
    const hasItems = this._state.items.length > 0;
    const empty = this._state.status === "loaded" && this._state.total === 0;
    const initialError =
      this._state.error?.scope === "initial" ||
      this._state.error?.scope === "refresh";
    const loadMoreError = this._state.error?.scope === "load-more";
    const hasMore = hasItems && this._state.items.length < this._state.total;

    this._elements.section.hidden = !active;
    this._elements.status.hidden = !loading;
    this._elements.status.textContent = loading
      ? hasItems
        ? "Refreshing your contributions…"
        : "Loading your contributions…"
      : "";
    this._elements.empty.hidden = !empty;
    this._elements.error.hidden = !initialError;
    this._elements.errorMessage.textContent = initialError
      ? this._state.error.message
      : "";
    this._elements.retryButton.disabled = loading || loadingMore;
    this._elements.list.hidden = !hasItems;
    this._renderList();
    this._elements.refreshButton.disabled = loading || loadingMore;
    this._elements.loadMoreError.hidden = !loadMoreError;
    this._elements.loadMoreError.textContent = loadMoreError
      ? this._state.error.message
      : "";
    this._elements.loadMoreButton.hidden = !hasMore;
    this._elements.loadMoreButton.disabled = loading || loadingMore;
    this._elements.loadMoreButton.textContent = loadingMore
      ? "Loading…"
      : loadMoreError
        ? "Retry load more"
        : "Load more";
  }
}


const myContributions = new MyContributions();


export const initializeMyContributions = () =>
  myContributions.initializeMyContributions();
export const destroyMyContributions = () =>
  myContributions.destroyMyContributions();
