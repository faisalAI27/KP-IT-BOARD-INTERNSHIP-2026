import { getPublicLeaderboard } from "../services/leaderboard-api.js";


const PAGE_LIMIT = 20;
const SAFE_ERROR_CODES = new Set([
  "INVALID_LIMIT",
  "INVALID_OFFSET",
  "LEADERBOARD_QUERY_FAILED",
  "LEADERBOARD_REQUEST_FAILED",
  "LEADERBOARD_RESPONSE_INVALID",
  "NETWORK_ERROR",
]);


function safeLeaderboardItem(item) {
  return {
    rank: Number.isInteger(item?.rank) && item.rank >= 1 ? item.rank : 1,
    displayName:
      typeof item?.displayName === "string" ? item.displayName.trim() : "",
    approvedContributions:
      Number.isInteger(item?.approvedContributions) &&
      item.approvedContributions >= 1
        ? item.approvedContributions
        : 1,
  };
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
        : "We could not load the leaderboard.";
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


export function formatApprovedContributionCount(value) {
  const count = Number.isInteger(value) && value >= 0 ? value : 0;
  return `${count} approved ${count === 1 ? "contribution" : "contributions"}`;
}


export function formatLeaderboardRank(value) {
  const rank = Number.isInteger(value) && value >= 1 ? value : 1;
  return `#${rank}`;
}


const defaultLeaderboardApi = Object.freeze({ getPublicLeaderboard });


export class Leaderboard {
  constructor({
    root = globalThis.document,
    leaderboardApi = defaultLeaderboardApi,
  } = {}) {
    this._root = root;
    this._api = leaderboardApi;
    this._elements = null;
    this._bindings = [];
    this._initialized = false;
    this._destroyed = false;
    this._generation = 0;
    this._lifecycleId = 0;
    this._state = emptyState();
  }

  initializeLeaderboard() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;

    this._initialized = true;
    this._destroyed = false;
    this._lifecycleId += 1;
    this._bindEvents();
    this._state = emptyState();
    this._render();
    void this.refresh();
    return true;
  }

  getState() {
    return cloneState(this._state);
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

  async loadMore() {
    const retryingLoadMore =
      this._state.status === "error" &&
      this._state.error?.scope === "load-more";
    if (
      this._destroyed ||
      !this._initialized ||
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
    this._lifecycleId += 1;
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
      Object.entries(ids).map(([name, id]) => [name, this._root.getElementById(id)]),
    );
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.retryButton, "click", () => {
      void this.refresh();
    });
    this._listen(this._elements.refreshButton, "click", () => {
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

  _isCurrent(generation, lifecycleId) {
    return (
      !this._destroyed &&
      this._initialized &&
      generation === this._generation &&
      lifecycleId === this._lifecycleId
    );
  }

  _createEntry(item) {
    const entry = this._root.createElement("tr");
    entry.className =
      item.rank <= 3
        ? `leaderboard-entry leaderboard-entry-top-${item.rank}`
        : "leaderboard-entry";

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

  _renderList() {
    const entries = this._state.items.map((item) => this._createEntry(item));
    this._elements.list.replaceChildren(...entries);
  }

  _render() {
    if (!this._elements) return;
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
      ? `Showing ${this._state.items.length} of ${this._state.total} qualifying ${
          this._state.total === 1 ? "contributor" : "contributors"
        }.`
      : "";
    this._elements.empty.hidden = !empty;
    this._elements.error.hidden = !primaryError;
    this._elements.errorMessage.textContent = primaryError
      ? this._state.error.message
      : "";
    this._elements.retryButton.disabled = busy;
    this._elements.list.hidden = !hasItems;
    this._renderList();
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


const leaderboard = new Leaderboard();


export const initializeLeaderboard = () =>
  leaderboard.initializeLeaderboard();
export const destroyLeaderboard = () => leaderboard.destroyLeaderboard();
