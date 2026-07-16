import {
  getCurrentAuthState,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
} from "../services/auth-service.js";
import { getMyPoints } from "../services/points-api.js";


const PAGE_LIMIT = 20;
const UNAUTHORIZED_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_ACCESS_TOKEN",
]);
const SAFE_ERROR_CODES = new Set([
  ...UNAUTHORIZED_CODES,
  "POINTS_RESPONSE_INVALID",
  "POINTS_QUERY_FAILED",
  "NETWORK_ERROR",
  "INVALID_LIMIT",
  "INVALID_OFFSET",
  "POINTS_REQUEST_FAILED",
]);
const ENTRY_COPY = Object.freeze({
  approvalAward: Object.freeze({
    label: "Contribution approved",
    description:
      "You received 1 point after an administrator approved your recording.",
  }),
  approvalReversal: Object.freeze({
    label: "Approval reversed",
    description: "1 point was removed because the approval decision changed.",
  }),
  approvedBackfill: Object.freeze({
    label: "Approved contribution credited",
    description:
      "A previously approved contribution was added to your point history.",
  }),
});


function verifiedUserId(state) {
  const userId =
    state?.status === "signed_in" && typeof state.backendUser?.id === "string"
      ? state.backendUser.id.trim()
      : "";
  return userId || null;
}


function safePointItem(item) {
  return {
    id: typeof item?.id === "string" ? item.id.trim() : "",
    entryType:
      typeof item?.entryType === "string" ? item.entryType.trim() : "",
    pointsDelta: Number.isInteger(item?.pointsDelta) ? item.pointsDelta : 0,
    contributionId:
      typeof item?.contributionId === "string"
        ? item.contributionId.trim()
        : "",
    createdAt: typeof item?.createdAt === "string" ? item.createdAt : "",
  };
}


function safePage(response) {
  const balance = Number.isInteger(response?.balance) ? response.balance : 0;
  return {
    balance: Object.is(balance, -0) ? 0 : balance,
    items: Array.isArray(response?.items)
      ? response.items.map((item) => safePointItem(item))
      : [],
    total:
      Number.isInteger(response?.total) && response.total >= 0
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


function safePointsError(error, scope) {
  const rawCode = typeof error?.code === "string" ? error.code : "";
  const code = SAFE_ERROR_CODES.has(rawCode)
    ? rawCode
    : "POINTS_REQUEST_FAILED";
  const status = Number.isInteger(error?.status) ? error.status : 0;
  const message =
    scope === "load-more"
      ? "We could not load more point history."
      : scope === "refresh"
        ? "We could not refresh your points."
        : "We could not load your points.";
  return { code, message, status, scope };
}


function emptyState() {
  return {
    status: "idle",
    balance: 0,
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
    balance: state.balance,
    items: state.items.map((item) => ({ ...item })),
    total: state.total,
    limit: state.limit,
    offset: state.offset,
    error: state.error ? { ...state.error } : null,
  };
}


export function formatPointBalance(value) {
  const balance = Number.isInteger(value) && !Object.is(value, -0) ? value : 0;
  return `${balance} ${Math.abs(balance) === 1 ? "point" : "points"}`;
}


export function formatPointDelta(value) {
  const delta = Number.isInteger(value) && !Object.is(value, -0) ? value : 0;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} ${Math.abs(delta) === 1 ? "point" : "points"}`;
}


export function formatPointDate(value, locale = undefined) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "Date unavailable";
  }
}


export function pointEntryCopy(entryType) {
  return (
    ENTRY_COPY[entryType] ?? {
      label: "Point activity",
      description: "Your point history was updated.",
    }
  );
}


const defaultAuthApi = Object.freeze({
  getCurrentAuthState,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
});
const defaultPointsApi = Object.freeze({ getMyPoints });


export class MyPoints {
  constructor({
    root = globalThis.document,
    authApi = defaultAuthApi,
    pointsApi = defaultPointsApi,
    locale = undefined,
  } = {}) {
    this._root = root;
    this._auth = authApi;
    this._api = pointsApi;
    this._locale = locale;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._initialized = false;
    this._destroyed = false;
    this._generation = 0;
    this._lifecycleId = 0;
    this._activeUserId = null;
    this._state = emptyState();
  }

  initializeMyPoints() {
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
      this._state.status === "refreshing" ||
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
      status: hadItems ? "refreshing" : "loading",
      offset: 0,
      error: null,
    };
    this._render();

    try {
      const response = await this._api.getMyPoints({
        limit: PAGE_LIMIT,
        offset: 0,
      });
      if (!this._isCurrent(generation, lifecycleId, userId)) return false;
      const page = safePage(response);
      this._state = {
        status: "loaded",
        balance: page.balance,
        items: deduplicateItems(page.items),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        error: null,
      };
      this._render();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, lifecycleId, userId)) return false;
      if (this._isUnauthorized(error)) {
        this._handleUnauthorized();
        return false;
      }
      const scope = hadItems ? "refresh" : "initial";
      this._state = hadItems
        ? {
            ...this._state,
            status: "error",
            error: safePointsError(error, scope),
          }
        : {
            ...emptyState(),
            status: "error",
            error: safePointsError(error, scope),
          };
      this._render();
      return false;
    }
  }

  async loadMore() {
    const retryingLoadMore =
      this._state.status === "error" &&
      this._state.error?.scope === "load-more";
    if (
      this._destroyed ||
      !this._activeUserId ||
      (this._state.status !== "loaded" && !retryingLoadMore) ||
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
      const response = await this._api.getMyPoints({
        limit: PAGE_LIMIT,
        offset,
      });
      if (!this._isCurrent(generation, lifecycleId, userId)) return false;
      const page = safePage(response);
      this._state = {
        status: "loaded",
        balance: page.balance,
        items: deduplicateItems([...this._state.items, ...page.items]),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        error: null,
      };
      this._render();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, lifecycleId, userId)) return false;
      if (this._isUnauthorized(error)) {
        this._handleUnauthorized();
        return false;
      }
      this._state = {
        ...this._state,
        status: "error",
        error: safePointsError(error, "load-more"),
      };
      this._render();
      return false;
    }
  }

  destroyMyPoints() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._initialized = false;
    this._generation += 1;
    this._lifecycleId += 1;
    this._activeUserId = null;
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
      section: "myPointsSection",
      balance: "myPointsBalance",
      status: "myPointsStatus",
      history: "myPointsHistory",
      empty: "myPointsEmpty",
      error: "myPointsError",
      errorMessage: "myPointsErrorMessage",
      refreshButton: "refreshPointsButton",
      retryButton: "retryPointsButton",
      loadMoreButton: "loadMorePointsButton",
      loadMoreError: "myPointsLoadMoreError",
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
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _handleAuthState(authState) {
    const nextUserId = verifiedUserId(authState);
    if (!nextUserId) {
      this._resetPoints();
      return;
    }
    if (nextUserId === this._activeUserId && this._state.status !== "idle") {
      return;
    }

    this._generation += 1;
    this._activeUserId = nextUserId;
    this._state = emptyState();
    this._render();
    void this.refresh();
  }

  _resetPoints() {
    const alreadyReset =
      this._activeUserId === null &&
      this._state.status === "idle" &&
      this._state.balance === 0 &&
      this._state.items.length === 0;
    if (!alreadyReset) this._generation += 1;
    this._activeUserId = null;
    this._state = emptyState();
    this._render();
  }

  _isUnauthorized(error) {
    return error?.status === 401 || UNAUTHORIZED_CODES.has(error?.code);
  }

  _handleUnauthorized() {
    this._resetPoints();
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

  _createPointItem(item) {
    const copy = pointEntryCopy(item.entryType);
    const entry = this._root.createElement("li");
    const direction = item.pointsDelta < 0 ? "reversal" : "award";
    entry.className = `my-points-entry my-points-entry-${direction}`;

    const top = this._root.createElement("div");
    top.className = "my-points-entry-top";
    const label = this._root.createElement("h4");
    label.textContent = copy.label;
    const delta = this._root.createElement("strong");
    delta.className = `my-points-delta my-points-delta-${direction}`;
    delta.textContent = formatPointDelta(item.pointsDelta);
    delta.setAttribute("aria-label", formatPointDelta(item.pointsDelta));
    top.append(label, delta);

    const description = this._root.createElement("p");
    description.className = "my-points-entry-description";
    description.textContent = copy.description;
    const date = this._root.createElement("time");
    date.className = "my-points-entry-date";
    date.textContent = formatPointDate(item.createdAt, this._locale);
    if (!Number.isNaN(Date.parse(item.createdAt))) {
      date.setAttribute("datetime", item.createdAt);
    }
    entry.append(top, description, date);
    return entry;
  }

  _renderHistory() {
    const entries = this._state.items.map((item) => this._createPointItem(item));
    this._elements.history.replaceChildren(...entries);
  }

  _render() {
    if (!this._elements) return;
    const active = Boolean(this._activeUserId) && !this._destroyed;
    const loading = this._state.status === "loading";
    const refreshing = this._state.status === "refreshing";
    const loadingMore = this._state.status === "loading-more";
    const busy = loading || refreshing || loadingMore;
    const hasItems = this._state.items.length > 0;
    const empty = this._state.status === "loaded" && this._state.total === 0;
    const primaryError =
      this._state.error?.scope === "initial" ||
      this._state.error?.scope === "refresh";
    const loadMoreError = this._state.error?.scope === "load-more";
    const hasMore = hasItems && this._state.items.length < this._state.total;

    this._elements.section.hidden = !active;
    this._elements.balance.textContent = formatPointBalance(this._state.balance);
    this._elements.status.hidden = !busy;
    this._elements.status.textContent = loading
      ? "Loading your points…"
      : refreshing
        ? "Refreshing…"
        : loadingMore
          ? "Loading more point history…"
          : "";
    this._elements.empty.hidden = !empty;
    this._elements.error.hidden = !primaryError;
    this._elements.errorMessage.textContent = primaryError
      ? this._state.error.message
      : "";
    this._elements.retryButton.disabled = busy;
    this._elements.history.hidden = !hasItems;
    this._renderHistory();
    this._elements.refreshButton.disabled = busy;
    this._elements.loadMoreError.hidden = !loadMoreError;
    this._elements.loadMoreError.textContent = loadMoreError
      ? this._state.error.message
      : "";
    this._elements.loadMoreButton.hidden = !hasMore;
    this._elements.loadMoreButton.disabled = busy;
    this._elements.loadMoreButton.textContent = loadingMore
      ? "Loading…"
      : loadMoreError
        ? "Retry load more"
        : "Load more";
  }
}


const myPoints = new MyPoints();


export const initializeMyPoints = () => myPoints.initializeMyPoints();
export const destroyMyPoints = () => myPoints.destroyMyPoints();
