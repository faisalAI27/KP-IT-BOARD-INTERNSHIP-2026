import {
  getCurrentAuthState,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
} from "../services/auth-service.js?v=20260717-auth-routing";
import { getMyPoints } from "../services/points-api.js?v=20260717-member-workspace";
import { CONTRIBUTION_CREATED_EVENT } from "./my-contributions.js?v=20260717-member-workspace";


const SCORE_REQUEST_LIMIT = 1;
const UNAUTHORIZED_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_ACCESS_TOKEN",
]);
const SAFE_ERROR_CODES = new Set([
  ...UNAUTHORIZED_CODES,
  "POINTS_RESPONSE_INVALID",
  "INVALID_LIMIT",
  "INVALID_OFFSET",
  "NETWORK_ERROR",
  "POINTS_REQUEST_FAILED",
]);


function verifiedUserId(state) {
  const userId =
    state?.status === "signed_in" && typeof state.backendUser?.id === "string"
      ? state.backendUser.id.trim()
      : "";
  return userId || null;
}


function emptyState() {
  return {
    status: "idle",
    balance: 0,
    error: null,
  };
}


function safeScoreError(error, scope) {
  const rawCode = typeof error?.code === "string" ? error.code : "";
  return {
    code: SAFE_ERROR_CODES.has(rawCode)
      ? rawCode
      : "ACCOUNT_SCORE_REQUEST_FAILED",
    message:
      scope === "refresh"
        ? "We could not refresh your score."
        : "We could not load your score.",
    status: Number.isInteger(error?.status) ? error.status : 0,
    scope,
  };
}


export function formatAccountScore(value) {
  const balance = Number.isInteger(value) ? value : 0;
  const safeBalance = Object.is(balance, -0) ? 0 : balance;
  return `${safeBalance} ${safeBalance === 1 ? "point" : "points"}`;
}


const defaultAuthApi = Object.freeze({
  getCurrentAuthState,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
});
const defaultPointsApi = Object.freeze({ getMyPoints });


export class AccountScore {
  constructor({
    root = globalThis.document,
    authApi = defaultAuthApi,
    pointsApi = defaultPointsApi,
    eventTarget = globalThis.window,
  } = {}) {
    this._root = root;
    this._auth = authApi;
    this._api = pointsApi;
    this._eventTarget = eventTarget;
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
      if (
        this._state.status === "loading" ||
        this._state.status === "refreshing"
      ) {
        this._refreshQueued = true;
        return;
      }
      void this.refresh();
    };
  }

  initializeAccountScore() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;

    this._initialized = true;
    this._destroyed = false;
    this._lifecycleId += 1;
    this._bindEvents();
    this._handleAuthState(this._auth.getCurrentAuthState());
    this._unsubscribe = this._auth.subscribeToAuthChanges((state) => {
      if (!this._destroyed) this._handleAuthState(state);
    });
    return true;
  }

  getState() {
    return {
      status: this._state.status,
      balance: this._state.balance,
      error: this._state.error ? { ...this._state.error } : null,
    };
  }

  async refresh() {
    if (
      this._destroyed ||
      !this._initialized ||
      !this._activeUserId ||
      this._state.status === "loading" ||
      this._state.status === "refreshing"
    ) {
      return false;
    }

    const generation = ++this._generation;
    const lifecycleId = this._lifecycleId;
    const userId = this._activeUserId;
    const hadScore = this._state.status === "loaded" || this._state.balance !== 0;
    this._state = {
      ...this._state,
      status: hadScore ? "refreshing" : "loading",
      error: null,
    };
    this._render();

    try {
      const response = await this._api.getMyPoints({
        limit: SCORE_REQUEST_LIMIT,
        offset: 0,
      });
      if (!this._isCurrent(generation, lifecycleId, userId)) return false;
      const balance = Number.isInteger(response?.balance) ? response.balance : null;
      if (balance === null || !Number.isFinite(balance)) {
        throw { code: "POINTS_RESPONSE_INVALID", status: 200 };
      }
      this._state = {
        status: "loaded",
        balance: Object.is(balance, -0) ? 0 : balance,
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
        status: "error",
        error: safeScoreError(error, hadScore ? "refresh" : "initial"),
      };
      this._render();
      this._runQueuedRefresh(generation, lifecycleId, userId);
      return false;
    }
  }

  destroyAccountScore() {
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
      section: "accountScoreSection",
      value: "accountScoreValue",
      status: "accountScoreStatus",
      error: "accountScoreError",
      errorMessage: "accountScoreErrorMessage",
      refreshButton: "refreshAccountScoreButton",
      retryButton: "retryAccountScoreButton",
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
    const userId = verifiedUserId(authState);
    if (!userId) {
      this._resetScore();
      return;
    }
    if (userId === this._activeUserId && this._state.status !== "idle") return;

    this._generation += 1;
    this._activeUserId = userId;
    this._refreshQueued = false;
    this._state = emptyState();
    this._render();
    void this.refresh();
  }

  _resetScore() {
    const alreadyReset =
      this._activeUserId === null &&
      this._state.status === "idle" &&
      this._state.balance === 0;
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
    this._resetScore();
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
      if (this._isCurrent(generation, lifecycleId, userId)) void this.refresh();
    });
  }

  _render() {
    if (!this._elements) return;
    const active = Boolean(this._activeUserId) && !this._destroyed;
    const loading = this._state.status === "loading";
    const refreshing = this._state.status === "refreshing";
    const busy = loading || refreshing;
    const failed = this._state.status === "error";

    this._elements.section.hidden = !active;
    this._elements.value.textContent = formatAccountScore(this._state.balance);
    this._elements.status.hidden = !busy;
    this._elements.status.textContent = loading
      ? "Loading your score…"
      : refreshing
        ? "Refreshing your score…"
        : "";
    this._elements.error.hidden = !failed;
    this._elements.errorMessage.textContent = failed
      ? this._state.error.message
      : "";
    this._elements.refreshButton.disabled = busy;
    this._elements.retryButton.disabled = busy;
  }
}


const accountScore = new AccountScore();


export const initializeAccountScore = () =>
  accountScore.initializeAccountScore();
export const destroyAccountScore = () => accountScore.destroyAccountScore();
export const refreshAccountScore = () => accountScore.refresh();
