import {
  getPersonalLeaderboardContext,
  getPublicLeaderboard,
} from "../services/leaderboard-api.js?v=20260717-member-workspace";
import {
  getCurrentAuthState,
  subscribeToAuthChanges,
} from "../services/auth-service.js?v=20260717-auth-routing";
import { CONTRIBUTION_CREATED_EVENT } from "./my-contributions.js?v=20260717-member-workspace";
import { animateLeaderboardCounter } from "./leaderboard-template-motion.js?v=20260723-leaderboard-flow";


const PAGE_LIMIT = 20;
const SHOWCASE_LIMIT = 3;
const SAFE_ERROR_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_ACCESS_TOKEN",
  "INVALID_LIMIT",
  "INVALID_OFFSET",
  "LEADERBOARD_CONTEXT_QUERY_FAILED",
  "LEADERBOARD_QUERY_FAILED",
  "LEADERBOARD_REQUEST_FAILED",
  "LEADERBOARD_RESPONSE_INVALID",
  "NETWORK_ERROR",
]);


function safeLeaderboardItem(item, { personal = false } = {}) {
  const safe = {
    rank: Number.isInteger(item?.rank) && item.rank >= 1 ? item.rank : 1,
    displayName:
      typeof item?.displayName === "string" ? item.displayName.trim() : "",
    approvedContributions:
      Number.isInteger(item?.approvedContributions) &&
      item.approvedContributions >= 1
        ? item.approvedContributions
        : 1,
  };
  if (personal) safe.isCurrentUser = item?.isCurrentUser === true;
  return safe;
}


function safePage(response) {
  return {
    items: Array.isArray(response?.items)
      ? response.items.map((item) => safeLeaderboardItem(item))
      : [],
    total:
      Number.isInteger(response?.total) && response.total >= 0
        ? response.total
        : 0,
    limit: Number.isInteger(response?.limit) ? response.limit : PAGE_LIMIT,
    offset: Number.isInteger(response?.offset) ? response.offset : 0,
  };
}


function safePersonalContext(response) {
  const items = Array.isArray(response?.items)
    ? response.items.map((item) => safeLeaderboardItem(item, { personal: true }))
    : [];
  const currentUser = {
    rank:
      Number.isInteger(response?.currentUser?.rank) &&
      response.currentUser.rank >= 1
        ? response.currentUser.rank
        : null,
    displayName:
      typeof response?.currentUser?.displayName === "string"
        ? response.currentUser.displayName.trim()
        : "",
    approvedContributions:
      Number.isInteger(response?.currentUser?.approvedContributions) &&
      response.currentUser.approvedContributions >= 0
        ? response.currentUser.approvedContributions
        : 0,
  };
  const eligible = response?.leaderboardEligible === true;
  const validMarkerCount = items.filter((item) => item.isCurrentUser).length;
  if (
    typeof response?.leaderboardOptIn !== "boolean" ||
    typeof response?.leaderboardEligible !== "boolean" ||
    currentUser.displayName.length < 2 ||
    currentUser.displayName.length > 80 ||
    !Number.isInteger(response?.total) ||
    response.total < 0 ||
    !Number.isInteger(response?.limit) ||
    response.limit < 1 ||
    response.limit > 100 ||
    !Number.isInteger(response?.offset) ||
    response.offset < 0 ||
    items.length > response.limit ||
    (eligible &&
      (currentUser.rank === null ||
        validMarkerCount !== 1 ||
        response.total < 1)) ||
    (!eligible &&
      (currentUser.rank !== null ||
        items.length !== 0 ||
        response.total !== 0 ||
        response.offset !== 0))
  ) {
    throw { code: "LEADERBOARD_RESPONSE_INVALID" };
  }
  return {
    leaderboardOptIn: response.leaderboardOptIn,
    leaderboardEligible: eligible,
    currentUser,
    items,
    total: response.total,
    limit: response.limit,
    offset: response.offset,
  };
}


function safeLeaderboardError(error, scope) {
  const rawCode = typeof error?.code === "string" ? error.code : "";
  const code = SAFE_ERROR_CODES.has(rawCode)
    ? rawCode
    : "LEADERBOARD_REQUEST_FAILED";
  const status = Number.isInteger(error?.status) ? error.status : 0;
  const message =
    scope === "load-more"
      ? "We could not load more contributors."
      : scope === "refresh"
        ? "We could not refresh the leaderboard."
        : scope === "personal"
          ? "We could not find your leaderboard position."
          : scope === "showcase"
            ? "We could not load the leading contributors."
            : "We could not load the leaderboard. Please try again.";
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


function emptyShowcaseState() {
  return { status: "idle", items: [], error: null };
}


function emptyPersonalState() {
  return {
    status: "idle",
    leaderboardOptIn: false,
    leaderboardEligible: false,
    currentUser: null,
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


function verifiedUserId(state) {
  const userId =
    state?.status === "signed_in" && typeof state.backendUser?.id === "string"
      ? state.backendUser.id.trim()
      : "";
  return userId || null;
}


export function formatApprovedContributionCount(value) {
  const count = Number.isInteger(value) && value >= 0 ? value : 0;
  return `${count} approved ${count === 1 ? "contribution" : "contributions"}`;
}


export function formatLeaderboardRank(value) {
  const rank = Number.isInteger(value) && value >= 1 ? value : 1;
  return `#${rank}`;
}


const defaultLeaderboardApi = Object.freeze({
  getPersonalLeaderboardContext,
  getPublicLeaderboard,
});
const defaultAuthApi = Object.freeze({
  getCurrentAuthState,
  subscribeToAuthChanges,
});


export class Leaderboard {
  constructor({
    root = globalThis.document,
    leaderboardApi = defaultLeaderboardApi,
    authApi = null,
    eventTarget = globalThis.window,
    schedule = (callback) => globalThis.requestAnimationFrame(callback),
    prefersReducedMotion = () =>
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true,
  } = {}) {
    this._root = root;
    this._api = leaderboardApi;
    this._auth = authApi;
    this._eventTarget = eventTarget;
    this._schedule = schedule;
    this._prefersReducedMotion = prefersReducedMotion;
    this._elements = null;
    this._bindings = [];
    this._unsubscribeAuth = null;
    this._initialized = false;
    this._destroyed = false;
    this._generation = 0;
    this._showcaseGeneration = 0;
    this._personalGeneration = 0;
    this._lifecycleId = 0;
    this._activeUserId = null;
    this._leaderboardOpened = false;
    this._currentRow = null;
    this._state = emptyState();
    this._showcase = emptyShowcaseState();
    this._personal = emptyPersonalState();
    this._handleContributionCreated = () => {
      if (
        this._destroyed ||
        !this._leaderboardOpened ||
        !this._activeUserId ||
        this._personal.status === "loading"
      ) {
        return;
      }
      void this.loadPersonalContext();
    };
  }

  initializeLeaderboard() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;

    this._leaderboardOpened =
      this._root.body?.dataset?.leaderboardPage === "true";

    this._initialized = true;
    this._destroyed = false;
    this._lifecycleId += 1;
    this._bindEvents();
    this._state = emptyState();
    this._showcase = emptyShowcaseState();
    this._personal = emptyPersonalState();
    this._render();
    void this.refresh();
    if (this._elements.showcaseEnabled) void this.refreshShowcase();
    this._initializeAuth();
    return true;
  }

  getState() {
    return cloneState(this._state);
  }

  getPersonalState() {
    return {
      ...this._personal,
      currentUser: this._personal.currentUser
        ? { ...this._personal.currentUser }
        : null,
      items: this._personal.items.map((item) => ({ ...item })),
      error: this._personal.error ? { ...this._personal.error } : null,
    };
  }

  async refresh() {
    if (
      this._destroyed ||
      !this._initialized ||
      this._state.status === "loading" ||
      this._state.status === "refreshing" ||
      this._state.status === "loading-more"
    ) {
      return false;
    }

    const generation = ++this._generation;
    const lifecycleId = this._lifecycleId;
    const hadItems = this._state.items.length > 0;
    this._state = {
      ...this._state,
      status: hadItems ? "refreshing" : "loading",
      offset: 0,
      error: null,
    };
    this._render();

    try {
      const response = await this._api.getPublicLeaderboard({
        limit: PAGE_LIMIT,
        offset: 0,
      });
      if (!this._isCurrent(generation, lifecycleId)) return false;
      const page = safePage(response);
      this._state = {
        status: "loaded",
        items: page.items,
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        error: null,
      };
      this._render();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, lifecycleId)) return false;
      const scope = hadItems ? "refresh" : "initial";
      this._state = hadItems
        ? {
            ...this._state,
            status: "error",
            error: safeLeaderboardError(error, scope),
          }
        : {
            ...emptyState(),
            status: "error",
            error: safeLeaderboardError(error, scope),
          };
      this._render();
      return false;
    }
  }

  async refreshShowcase() {
    if (
      this._destroyed ||
      !this._initialized ||
      !this._elements.showcaseEnabled ||
      this._showcase.status === "loading"
    ) {
      return false;
    }
    const generation = ++this._showcaseGeneration;
    const lifecycleId = this._lifecycleId;
    this._showcase = { ...this._showcase, status: "loading", error: null };
    this._renderShowcase();
    try {
      const response = await this._api.getPublicLeaderboard({
        limit: SHOWCASE_LIMIT,
        offset: 0,
      });
      if (!this._isShowcaseCurrent(generation, lifecycleId)) return false;
      const page = safePage(response);
      this._showcase = {
        status: "loaded",
        items: page.items.slice(0, SHOWCASE_LIMIT),
        error: null,
      };
      this._renderShowcase();
      return true;
    } catch (error) {
      if (!this._isShowcaseCurrent(generation, lifecycleId)) return false;
      this._showcase = {
        status: "error",
        items: [],
        error: safeLeaderboardError(error, "showcase"),
      };
      this._renderShowcase();
      return false;
    }
  }

  async loadPersonalContext() {
    if (
      this._destroyed ||
      !this._initialized ||
      !this._elements.personalEnabled ||
      !this._activeUserId ||
      this._personal.status === "loading"
    ) {
      return false;
    }
    const generation = ++this._personalGeneration;
    const lifecycleId = this._lifecycleId;
    const expectedUserId = this._activeUserId;
    this._personal = { ...emptyPersonalState(), status: "loading" };
    this._render();
    try {
      const response = await this._api.getPersonalLeaderboardContext({
        limit: PAGE_LIMIT,
      });
      if (
        !this._isPersonalCurrent(generation, lifecycleId, expectedUserId)
      ) {
        return false;
      }
      const context = safePersonalContext(response);
      this._personal = {
        status: context.leaderboardEligible ? "eligible" : "ineligible",
        ...context,
        error: null,
      };
      this._render();
      if (context.leaderboardEligible) {
        this._scheduleCurrentUserFocus(generation, lifecycleId, expectedUserId);
      }
      return true;
    } catch (error) {
      if (
        !this._isPersonalCurrent(generation, lifecycleId, expectedUserId)
      ) {
        return false;
      }
      this._personal = {
        ...emptyPersonalState(),
        status: "error",
        error: safeLeaderboardError(error, "personal"),
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
      !this._initialized ||
      this._personal.status === "eligible" ||
      (this._state.status !== "loaded" && !retryingLoadMore) ||
      this._state.items.length >= this._state.total
    ) {
      return false;
    }

    const generation = ++this._generation;
    const lifecycleId = this._lifecycleId;
    const offset = this._state.items.length;
    this._state = { ...this._state, status: "loading-more", error: null };
    this._render();

    try {
      const response = await this._api.getPublicLeaderboard({
        limit: PAGE_LIMIT,
        offset,
      });
      if (!this._isCurrent(generation, lifecycleId)) return false;
      const page = safePage(response);
      this._state = {
        status: "loaded",
        items: [...this._state.items, ...page.items],
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        error: null,
      };
      this._render();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, lifecycleId)) return false;
      this._state = {
        ...this._state,
        status: "error",
        error: safeLeaderboardError(error, "load-more"),
      };
      this._render();
      return false;
    }
  }

  destroyLeaderboard() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._initialized = false;
    this._generation += 1;
    this._showcaseGeneration += 1;
    this._personalGeneration += 1;
    this._lifecycleId += 1;
    this._activeUserId = null;
    this._leaderboardOpened = false;
    this._currentRow = null;
    this._unsubscribeAuth?.();
    this._unsubscribeAuth = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._state = emptyState();
    this._showcase = emptyShowcaseState();
    this._personal = emptyPersonalState();
    this._render();
  }

  _resolveElements() {
    if (!this._root?.getElementById) return null;
    const requiredIds = {
      section: "leaderboardSection",
      status: "leaderboardStatus",
      summary: "leaderboardSummary",
      list: "leaderboardList",
      empty: "leaderboardEmpty",
      error: "leaderboardError",
      errorMessage: "leaderboardErrorMessage",
      retryButton: "retryLeaderboardButton",
      refreshButton: "refreshLeaderboardButton",
      loadMoreButton: "loadMoreLeaderboardButton",
      loadMoreError: "leaderboardLoadMoreError",
    };
    const elements = Object.fromEntries(
      Object.entries(requiredIds).map(([name, id]) => [
        name,
        this._root.getElementById(id),
      ]),
    );
    if (!Object.values(elements).every(Boolean)) return null;

    const optionalGroups = {
      showcase: {
        showcase: "leaderboardShowcase",
        showcaseStatus: "leaderboardShowcaseStatus",
        showcaseList: "leaderboardShowcaseList",
        showcaseError: "leaderboardShowcaseError",
        showcaseRetry: "retryLeaderboardShowcaseButton",
      },
      personal: {
        personalStatus: "leaderboardPersonalStatus",
        personalMessage: "leaderboardPersonalMessage",
        personalDetails: "leaderboardPersonalDetails",
        personalRetry: "retryLeaderboardContextButton",
        manageVisibility: "leaderboardManageVisibility",
        accountButton: "authHeaderButton",
      },
      template: {
        personalRank: "leaderboardPersonalRank",
        personalApproved: "leaderboardPersonalApproved",
        personalPage: "leaderboardPersonalPage",
        personalPageMeta: "leaderboardPersonalPageMeta",
        pageChip: "leaderboardPageChip",
      },
    };
    for (const [groupName, ids] of Object.entries(optionalGroups)) {
      const group = Object.fromEntries(
        Object.entries(ids).map(([name, id]) => [
          name,
          this._root.getElementById(id),
        ]),
      );
      const enabled = Object.values(group).every(Boolean);
      elements[`${groupName}Enabled`] = enabled;
      if (enabled) Object.assign(elements, group);
    }
    return elements;
  }

  _bindEvents() {
    this._listen(this._elements.retryButton, "click", () => {
      void this.refresh();
    });
    this._listen(this._elements.refreshButton, "click", () => {
      void this.refresh();
      if (this._elements.showcaseEnabled) void this.refreshShowcase();
      if (this._leaderboardOpened && this._activeUserId) {
        void this.loadPersonalContext();
      }
    });
    this._listen(this._elements.loadMoreButton, "click", () => {
      void this.loadMore();
    });
    if (this._elements.showcaseEnabled) {
      this._listen(this._elements.showcaseRetry, "click", () => {
        void this.refreshShowcase();
      });
    }
    if (this._elements.personalEnabled) {
      this._listen(this._elements.personalRetry, "click", () => {
        void this.loadPersonalContext();
      });
      this._listen(this._elements.manageVisibility, "click", () => {
        this._elements.accountButton.click?.();
      });
      for (const link of this._root.querySelectorAll?.(
        'a[href="#leaderboard"]',
      ) ?? []) {
        this._listen(link, "click", () => {
          this._leaderboardOpened = true;
          if (this._activeUserId) void this.loadPersonalContext();
        });
      }
      if (this._eventTarget?.addEventListener) {
        this._listen(
          this._eventTarget,
          CONTRIBUTION_CREATED_EVENT,
          this._handleContributionCreated,
        );
      }
    }
  }

  _initializeAuth() {
    if (
      !this._elements.personalEnabled ||
      !this._auth?.getCurrentAuthState ||
      !this._auth?.subscribeToAuthChanges
    ) {
      return;
    }
    this._handleAuthState(this._auth.getCurrentAuthState());
    this._unsubscribeAuth = this._auth.subscribeToAuthChanges((state) => {
      if (!this._destroyed) this._handleAuthState(state);
    });
  }

  _handleAuthState(state) {
    const userId = verifiedUserId(state);
    if (!userId) {
      this._activeUserId = null;
      this._personalGeneration += 1;
      this._personal = emptyPersonalState();
      this._render();
      return;
    }
    if (userId !== this._activeUserId) {
      this._activeUserId = userId;
      this._personalGeneration += 1;
      this._personal = emptyPersonalState();
      this._render();
      if (this._leaderboardOpened) void this.loadPersonalContext();
    }
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _isCurrent(generation, lifecycleId) {
    return (
      !this._destroyed &&
      this._initialized &&
      generation === this._generation &&
      lifecycleId === this._lifecycleId
    );
  }

  _isShowcaseCurrent(generation, lifecycleId) {
    return (
      !this._destroyed &&
      this._initialized &&
      generation === this._showcaseGeneration &&
      lifecycleId === this._lifecycleId
    );
  }

  _isPersonalCurrent(generation, lifecycleId, userId) {
    return (
      !this._destroyed &&
      this._initialized &&
      generation === this._personalGeneration &&
      lifecycleId === this._lifecycleId &&
      userId === this._activeUserId
    );
  }

  _createEntry(item) {
    const entry = this._root.createElement("tr");
    entry.className =
      item.rank <= 3
        ? `leaderboard-entry leaderboard-entry-top-${item.rank}`
        : "leaderboard-entry";
    if (item.isCurrentUser) {
      entry.className += " leaderboard-entry-current";
      entry.setAttribute("tabindex", "-1");
      entry.setAttribute("aria-label", `Your leaderboard row, rank ${item.rank}`);
      this._currentRow = entry;
    }

    const rankCell = this._root.createElement("td");
    rankCell.className = "leaderboard-rank-cell";
    const rank = this._root.createElement("span");
    rank.className = "leaderboard-rank-badge";
    rank.textContent = formatLeaderboardRank(item.rank);
    rank.setAttribute("aria-label", `Rank ${item.rank}`);
    rankCell.append(rank);

    const contributor = this._root.createElement("td");
    contributor.className = "leaderboard-contributor";
    const name = this._root.createElement("span");
    name.className = "leaderboard-contributor-name";
    name.textContent = item.displayName;
    contributor.append(name);
    if (item.isCurrentUser) {
      const you = this._root.createElement("span");
      you.className = "leaderboard-you-badge";
      you.textContent = "You";
      contributor.append(you);
    }

    const approved = this._root.createElement("td");
    approved.className = "leaderboard-approved-count";
    approved.setAttribute(
      "aria-label",
      formatApprovedContributionCount(item.approvedContributions),
    );
    const approvedNumber = this._root.createElement("strong");
    approvedNumber.textContent = String(item.approvedContributions);
    const approvedLabel = this._root.createElement("span");
    approvedLabel.textContent =
      item.approvedContributions === 1
        ? " approved contribution"
        : " approved contributions";
    approved.append(approvedNumber, approvedLabel);
    entry.append(rankCell, contributor, approved);
    return entry;
  }

  _createShowcaseEntry(item, position) {
    const entry = this._root.createElement("li");
    entry.className = `leaderboard-podium-card leaderboard-podium-${position}`;
    entry.setAttribute("aria-label", `Rank ${item.rank}, ${item.displayName}`);
    const visual = this._root.createElement("span");
    visual.className = "leaderboard-podium-rank";
    visual.setAttribute("aria-hidden", "true");
    visual.textContent = String(item.rank);
    const name = this._root.createElement("strong");
    name.textContent = item.displayName;
    const score = this._root.createElement("span");
    score.textContent = formatApprovedContributionCount(
      item.approvedContributions,
    );
    entry.append(visual, name, score);
    return entry;
  }

  _displayState() {
    if (this._personal.status === "eligible") {
      return {
        status: "loaded",
        items: this._personal.items,
        total: this._personal.total,
        limit: this._personal.limit,
        offset: this._personal.offset,
        error: null,
        personal: true,
      };
    }
    return { ...this._state, personal: false };
  }

  _renderList(items) {
    this._currentRow = null;
    const entries = items.map((item) => this._createEntry(item));
    this._elements.list.replaceChildren(...entries);
  }

  _renderShowcase() {
    if (!this._elements?.showcaseEnabled) return;
    const loading = this._showcase.status === "loading";
    const error = this._showcase.status === "error";
    const hasItems = this._showcase.items.length > 0;
    this._elements.showcase.setAttribute("aria-busy", String(loading));
    this._elements.showcaseStatus.hidden = !loading;
    this._elements.showcaseStatus.textContent = loading
      ? "Loading leading contributors…"
      : "";
    this._elements.showcaseError.hidden = !error;
    this._elements.showcaseRetry.disabled = loading;
    this._elements.showcaseList.hidden = !hasItems;
    const cards = this._showcase.items.map((item, index) =>
      this._createShowcaseEntry(item, index + 1),
    );
    this._elements.showcaseList.replaceChildren(...cards);
  }

  _renderPersonalStatus() {
    if (!this._elements?.personalEnabled) return;
    const state = this._personal;
    const visible = state.status !== "idle";
    this._elements.personalStatus.hidden = !visible;
    this._elements.personalRetry.hidden = state.status !== "error";
    this._elements.manageVisibility.hidden = state.status !== "ineligible";
    if (!visible) {
      this._elements.personalMessage.textContent = "";
      this._elements.personalDetails.textContent = "";
      this._renderPersonalMetrics(state);
      return;
    }
    if (state.status === "loading") {
      this._elements.personalMessage.textContent =
        "Finding your leaderboard position…";
      this._elements.personalDetails.textContent = "";
      this._renderPersonalMetrics(state);
      return;
    }
    if (state.status === "error") {
      this._elements.personalMessage.textContent =
        "Your leaderboard position is temporarily unavailable.";
      this._elements.personalDetails.textContent = state.error?.message ?? "";
      this._renderPersonalMetrics(state);
      return;
    }
    if (state.status === "eligible") {
      this._elements.personalMessage.textContent = `You are ranked ${formatLeaderboardRank(
        state.currentUser.rank,
      )}.`;
      this._elements.personalDetails.textContent = `${formatApprovedContributionCount(
        state.currentUser.approvedContributions,
      )}. Your row is highlighted below.`;
      this._renderPersonalMetrics(state);
      return;
    }
    if (state.status === "ineligible") {
      const approved = formatApprovedContributionCount(
        state.currentUser.approvedContributions,
      );
      this._elements.personalMessage.textContent = "Not currently ranked.";
      this._elements.personalDetails.textContent = state.leaderboardOptIn
        ? `Your private score is ${approved}. You will become eligible after a recording is approved.`
        : `Your private score is ${approved}. Turn on leaderboard visibility in Account to participate.`;
      this._renderPersonalMetrics(state);
    }
  }

  _renderPersonalMetrics(state) {
    if (!this._elements?.templateEnabled) return;
    if (state.status === "eligible") {
      animateLeaderboardCounter(
        this._elements.personalRank,
        state.currentUser.rank,
      );
      animateLeaderboardCounter(
        this._elements.personalApproved,
        state.currentUser.approvedContributions,
      );
      animateLeaderboardCounter(
        this._elements.personalPage,
        state.items.length,
      );
      this._elements.personalPageMeta.textContent =
        `${state.offset + 1}–${state.offset + state.items.length} of ${state.total}`;
      return;
    }
    if (state.status === "ineligible") {
      this._elements.personalRank.textContent = "—";
      animateLeaderboardCounter(
        this._elements.personalApproved,
        state.currentUser.approvedContributions,
      );
      animateLeaderboardCounter(this._elements.personalPage, 0);
      this._elements.personalPageMeta.textContent = "Not currently ranked";
      return;
    }
    for (const element of [
      this._elements.personalRank,
      this._elements.personalApproved,
      this._elements.personalPage,
    ]) {
      element.textContent = "—";
    }
    this._elements.personalPageMeta.textContent =
      state.status === "loading" ? "Finding your ranking slice" : "Your ranking slice";
  }

  _render() {
    if (!this._elements) return;
    this._renderShowcase();
    this._renderPersonalStatus();
    const display = this._displayState();
    const loading = display.status === "loading";
    const refreshing = display.status === "refreshing";
    const loadingMore = display.status === "loading-more";
    const busy = loading || refreshing || loadingMore;
    const hasItems = display.items.length > 0;
    const empty = display.status === "loaded" && display.total === 0;
    const primaryError =
      display.error?.scope === "initial" ||
      display.error?.scope === "refresh";
    const loadMoreError = display.error?.scope === "load-more";
    const hasMore =
      !display.personal && hasItems && display.items.length < display.total;

    this._elements.section.setAttribute(
      "aria-busy",
      String(loading || refreshing),
    );
    this._elements.status.hidden = !busy;
    this._elements.status.textContent = loading
      ? "Loading leaderboard…"
      : refreshing
        ? "Refreshing leaderboard…"
        : loadingMore
          ? "Loading more contributors…"
          : "";
    this._elements.summary.hidden = !hasItems;
    this._elements.summary.textContent = hasItems
      ? display.personal
        ? `Showing the ${display.items.length}-contributor page containing your position (${display.offset + 1}–${display.offset + display.items.length} of ${display.total}).`
        : `Showing ${display.items.length} of ${display.total} qualifying ${
            display.total === 1 ? "contributor" : "contributors"
          }.`
      : "";
    if (this._elements.templateEnabled) {
      this._elements.pageChip.textContent = busy
        ? "Loading page"
        : hasItems
          ? `${display.offset + 1}–${display.offset + display.items.length} of ${display.total}`
          : empty
            ? "No rankings yet"
            : primaryError
              ? "Unavailable"
              : "All-time";
    }
    this._elements.empty.hidden = !empty;
    this._elements.error.hidden = !primaryError;
    this._elements.errorMessage.textContent = primaryError
      ? display.error.message
      : "";
    this._elements.retryButton.disabled = busy;
    this._elements.list.hidden = !hasItems;
    this._renderList(display.items);
    this._elements.refreshButton.disabled = busy;
    this._elements.loadMoreError.hidden = !loadMoreError;
    this._elements.loadMoreError.textContent = loadMoreError
      ? display.error.message
      : "";
    this._elements.loadMoreButton.hidden = !hasMore;
    this._elements.loadMoreButton.disabled = busy;
    this._elements.loadMoreButton.textContent = loadingMore
      ? "Loading…"
      : loadMoreError
        ? "Retry load more"
        : "Load more";
  }

  _scheduleCurrentUserFocus(generation, lifecycleId, userId) {
    this._schedule?.(() => {
      if (
        !this._isPersonalCurrent(generation, lifecycleId, userId) ||
        !this._currentRow
      ) {
        return;
      }
      this._currentRow.scrollIntoView?.({
        behavior: this._prefersReducedMotion() ? "auto" : "smooth",
        block: "center",
      });
      this._currentRow.focus?.({ preventScroll: true });
    });
  }
}


const leaderboard = new Leaderboard({ authApi: defaultAuthApi });


export const initializeLeaderboard = () =>
  leaderboard.initializeLeaderboard();
export const destroyLeaderboard = () => leaderboard.destroyLeaderboard();
