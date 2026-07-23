import {
  getCurrentAuthState,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
} from "../services/auth-service.js?v=20260717-auth-routing";
import {
  getMyContributionAudio,
  getMyContributions,
} from "../services/contributions-api.js?v=20260723-contributions-motion";
import { getMyContributionStatistics } from "../services/profile-api.js?v=20260717-member-workspace";
import {
  MY_CONTRIBUTIONS_SECTION,
  PRIVATE_SECTION_CHANGED_EVENT,
} from "./private-navigation.js?v=20260717-member-workspace";


export const CONTRIBUTION_CREATED_EVENT = "kp-awaz:contribution-created";
const PAGE_LIMIT = 10;
const HISTORY_FILTERS = Object.freeze(["all", "pending", "approved", "rejected"]);
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
    reviewStatus: ["pending", "approved", "rejected"].includes(
      item?.reviewStatus,
    )
      ? item.reviewStatus
      : "pending",
    rejectionReason:
      item?.reviewStatus === "rejected" &&
      typeof item?.rejectionReason === "string"
        ? item.rejectionReason.trim() || null
        : null,
    withdrawalStatus: ["none", "requested", "approved", "declined"].includes(
      item?.withdrawalStatus,
    )
      ? item.withdrawalStatus
      : "none",
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


function emptyStatistics() {
  return {
    status: "idle",
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    error: null,
  };
}


function safeStatistics(response) {
  return {
    status: "loaded",
    total: response.totalContributions,
    pending: response.pendingContributions,
    approved: response.approvedContributions,
    rejected: response.rejectedContributions,
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


export function formatContributionReviewStatus(value) {
  if (value === "approved") return "Approved";
  if (value === "rejected") return "Rejected";
  return "Pending review";
}


export function contributionReviewHelper(value) {
  if (value === "approved") {
    return "Approved recordings count toward your contribution score.";
  }
  if (value === "rejected") {
    return "Rejected recordings do not count toward your contribution score.";
  }
  return "Stored safely and waiting for administrator review. It does not count toward your score yet.";
}


export function formatContributionWithdrawalStatus(value) {
  if (value === "requested") return "Withdrawal requested";
  if (value === "approved") return "Withdrawal approved";
  if (value === "declined") return "Withdrawal declined";
  return "";
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
const defaultContributionsApi = Object.freeze({
  getMyContributionAudio,
  getMyContributions,
});
const defaultStatisticsApi = Object.freeze({ getMyContributionStatistics });


function toggleClass(element, className, enabled) {
  if (element?.classList?.toggle) {
    element.classList.toggle(className, enabled);
    return;
  }
  const classes = new Set(String(element?.className ?? "").split(/\s+/).filter(Boolean));
  if (enabled) classes.add(className);
  else classes.delete(className);
  if (element) element.className = [...classes].join(" ");
}


function formatContributionClock(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "--:--";
  }
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}


function formatContributionFileType(value) {
  const normalized = typeof value === "string" ? value.split(";", 1)[0].trim() : "";
  return normalized.includes("/")
    ? normalized.split("/").at(-1).toUpperCase()
    : "Audio";
}


export class MyContributions {
  constructor({
    root = globalThis.document,
    authApi = defaultAuthApi,
    contributionsApi = defaultContributionsApi,
    statisticsApi = defaultStatisticsApi,
    eventTarget = globalThis.window,
    locale = undefined,
    audioFactory = (url) => new Audio(url),
    urlApi = globalThis.URL,
  } = {}) {
    this._root = root;
    this._auth = authApi;
    this._api = contributionsApi;
    this._statisticsApi = statisticsApi;
    this._eventTarget = eventTarget;
    this._locale = locale;
    this._audioFactory = audioFactory;
    this._urlApi = urlApi;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._initialized = false;
    this._destroyed = false;
    this._generation = 0;
    this._lifecycleId = 0;
    this._activeUserId = null;
    this._sectionOpen = false;
    this._needsRefresh = false;
    this._refreshQueued = false;
    this._filter = "all";
    this._audioRequestId = 0;
    this._activeAudio = null;
    this._activeAudioUrl = null;
    this._activeAudioBindings = [];
    this._activeAudioCard = null;
    this._activeAudioButton = null;
    this._state = emptyState();
    this._statistics = emptyStatistics();
    this._handleContributionCreated = () => {
      if (this._destroyed || !this._activeUserId) return;
      this._needsRefresh = true;
      if (!this._sectionOpen) return;
      if (this._state.status === "loading" || this._state.status === "loading-more") {
        this._refreshQueued = true;
        return;
      }
      void this.refresh();
    };
    this._handlePrivateSectionChanged = (event) => {
      const open = event?.detail?.section === MY_CONTRIBUTIONS_SECTION;
      this._sectionOpen = Boolean(this._activeUserId) && open;
      this._render();
      if (
        this._sectionOpen &&
        verifiedUserId(this._auth.getCurrentAuthState()) === this._activeUserId &&
        (this._needsRefresh || this._state.status === "idle")
      ) {
        void this.refresh();
      }
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
    return {
      ...cloneState(this._state),
      statistics: {
        ...this._statistics,
        error: this._statistics.error ? { ...this._statistics.error } : null,
      },
    };
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
    this._needsRefresh = false;
    this._state = {
      ...this._state,
      status: "loading",
      offset: 0,
      error: null,
    };
    this._statistics = {
      ...this._statistics,
      status: "loading",
      error: null,
    };
    this._render();

    const [historyResult, statisticsResult] = await Promise.allSettled([
      this._api.getMyContributions({
        limit: PAGE_LIMIT,
        offset: 0,
        ...(this._filter === "all" ? {} : { status: this._filter }),
      }),
      this._statisticsApi.getMyContributionStatistics(),
    ]);
    if (!this._isCurrent(generation, lifecycleId, userId)) return false;

    const authenticationError = [historyResult, statisticsResult].find(
      (result) =>
        result.status === "rejected" && this._isUnauthorized(result.reason),
    );
    if (authenticationError) {
      this._handleUnauthorized();
      return false;
    }

    if (statisticsResult.status === "fulfilled") {
      this._statistics = safeStatistics(statisticsResult.value);
    } else {
      this._statistics = {
        ...emptyStatistics(),
        status: "error",
        error: {
          message: "We could not load your contribution summary.",
        },
      };
    }

    if (historyResult.status === "fulfilled") {
      const page = safePage(historyResult.value);
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
    }

    {
      const scope = hadItems ? "refresh" : "initial";
      this._state = {
        ...this._state,
        status: hadItems ? "loaded" : "error",
        error: safeHistoryError(historyResult.reason, scope),
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
        ...(this._filter === "all" ? {} : { status: this._filter }),
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
    this._stopAudioPlayback();
    this._destroyed = true;
    this._initialized = false;
    this._generation += 1;
    this._lifecycleId += 1;
    this._activeUserId = null;
    this._sectionOpen = false;
    this._needsRefresh = false;
    this._refreshQueued = false;
    this._filter = "all";
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._state = emptyState();
    this._statistics = emptyStatistics();
    this._render();
  }

  _resolveElements() {
    if (!this._root?.getElementById) return null;
    const ids = {
      section: "myContributionsPageSection",
      status: "myContributionsStatus",
      summary: "myContributionsSummary",
      summaryStatus: "myContributionsSummaryStatus",
      summaryTotal: "myContributionsSummaryTotal",
      summaryPending: "myContributionsSummaryPending",
      summaryApproved: "myContributionsSummaryApproved",
      summaryRejected: "myContributionsSummaryRejected",
      scoreValue: "myContributionsScoreValue",
      updated: "myContributionsUpdated",
      visibleCount: "myContributionsVisibleCount",
      list: "myContributionsList",
      empty: "myContributionsEmpty",
      emptyTitle: "myContributionsEmptyTitle",
      emptyDescription: "myContributionsEmptyDescription",
      error: "myContributionsError",
      errorMessage: "myContributionsErrorMessage",
      refreshButton: "refreshContributionsButton",
      loadMoreButton: "loadMoreContributionsButton",
      retryButton: "retryContributionsButton",
      loadMoreError: "myContributionsLoadMoreError",
      filterAll: "filterAllContributionsButton",
      filterPending: "filterPendingContributionsButton",
      filterApproved: "filterApprovedContributionsButton",
      filterRejected: "filterRejectedContributionsButton",
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
    for (const status of HISTORY_FILTERS) {
      const element =
        status === "all"
          ? this._elements.filterAll
          : status === "pending"
            ? this._elements.filterPending
            : status === "approved"
              ? this._elements.filterApproved
              : this._elements.filterRejected;
      this._listen(element, "click", () => {
        this._setFilter(status);
      });
    }
    if (this._eventTarget?.addEventListener) {
      this._listen(
        this._eventTarget,
        CONTRIBUTION_CREATED_EVENT,
        this._handleContributionCreated,
      );
      this._listen(
        this._eventTarget,
        PRIVATE_SECTION_CHANGED_EVENT,
        this._handlePrivateSectionChanged,
      );
    }
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _setFilter(status) {
    if (
      this._destroyed ||
      !HISTORY_FILTERS.includes(status) ||
      status === this._filter ||
      !this._activeUserId ||
      this._state.status === "loading" ||
      this._state.status === "loading-more"
    ) {
      return false;
    }
    this._stopAudioPlayback();
    this._generation += 1;
    this._filter = status;
    this._needsRefresh = false;
    this._refreshQueued = false;
    this._state = emptyState();
    this._render();
    if (this._sectionOpen) void this.refresh();
    return true;
  }

  _handleAuthState(authState) {
    const nextUserId = verifiedUserId(authState);
    if (!nextUserId) {
      this._resetHistory();
      return;
    }
    if (nextUserId === this._activeUserId) return;

    const sectionOpen = !this._elements.section.hidden;
    this._stopAudioPlayback();
    this._generation += 1;
    this._activeUserId = nextUserId;
    this._sectionOpen = sectionOpen;
    this._needsRefresh = true;
    this._refreshQueued = false;
    this._filter = "all";
    this._state = emptyState();
    this._statistics = emptyStatistics();
    this._render();
    if (this._sectionOpen) void this.refresh();
  }

  _resetHistory() {
    const alreadyReset =
      this._activeUserId === null &&
      this._state.status === "idle" &&
      this._state.items.length === 0;
    if (!alreadyReset) this._generation += 1;
    this._stopAudioPlayback();
    this._activeUserId = null;
    this._sectionOpen = false;
    this._needsRefresh = false;
    this._refreshQueued = false;
    this._filter = "all";
    this._state = emptyState();
    this._statistics = emptyStatistics();
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
    this._needsRefresh = true;
    if (this._sectionOpen) {
      queueMicrotask(() => {
        if (
          !this._destroyed &&
          this._sectionOpen &&
          userId === this._activeUserId
        ) {
          void this.refresh();
        }
      });
    }
  }

  _createMetadataRow(label, value, { language = null } = {}) {
    const row = this._root.createElement("div");
    row.className = "my-contribution-detail-row";
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

  _createSvgIcon(pathData, { label = null } = {}) {
    if (typeof this._root.createElementNS !== "function") {
      const fallback = this._root.createElement("span");
      fallback.setAttribute("aria-hidden", "true");
      return fallback;
    }
    const namespace = "http://www.w3.org/2000/svg";
    const svg = this._root.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    if (label) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", label);
    } else {
      svg.setAttribute("aria-hidden", "true");
    }
    for (const data of pathData) {
      const path = this._root.createElementNS(namespace, "path");
      path.setAttribute("d", data);
      svg.append(path);
    }
    return svg;
  }

  _createText(value) {
    if (typeof this._root.createTextNode === "function") {
      return this._root.createTextNode(value);
    }
    const fallback = this._root.createElement("span");
    fallback.textContent = value;
    return fallback;
  }

  _createMetaItem(label, value) {
    const item = this._root.createElement("div");
    item.className = "my-contribution-meta-item";
    const term = this._root.createElement("span");
    term.textContent = label;
    const description = this._root.createElement("strong");
    description.textContent = value;
    item.append(term, description);
    return item;
  }

  _createContributionItem(item, index) {
    const card = this._root.createElement("li");
    card.className = "my-contribution-card";
    card.setAttribute("data-status", item.reviewStatus);
    card.setAttribute("style", `--card-index: ${Math.min(index, 8)}`);

    const glow = this._root.createElement("span");
    glow.className = "my-contribution-motion-glow";
    glow.setAttribute("aria-hidden", "true");
    const scan = this._root.createElement("span");
    scan.className = "my-contribution-motion-scan";
    scan.setAttribute("aria-hidden", "true");

    const title = this._root.createElement("h3");
    title.textContent = formatContributionType(item.contributionType);
    const submitted = this._root.createElement("span");
    submitted.className = "my-contribution-submitted";
    submitted.textContent = formatContributionDate(item.createdAt, this._locale);
    const titleCopy = this._root.createElement("div");
    titleCopy.append(title, submitted);
    const typeIcon = this._root.createElement("span");
    typeIcon.className = "my-contribution-type-icon";
    typeIcon.append(
      this._createSvgIcon(["M4 12h2l2-5 3 10 2-7 2 4h5"]),
    );
    const titleWrap = this._root.createElement("div");
    titleWrap.className = "my-contribution-title-wrap";
    titleWrap.append(typeIcon, titleCopy);
    const heading = this._root.createElement("div");
    heading.className = "my-contribution-card-heading";
    const badge = this._root.createElement("span");
    badge.className = "my-contribution-status-badge";
    badge.setAttribute("data-status", item.reviewStatus);
    const statusDot = this._root.createElement("i");
    statusDot.className = "my-contribution-status-dot";
    statusDot.setAttribute("aria-hidden", "true");
    badge.append(
      statusDot,
      this._createText(formatContributionReviewStatus(item.reviewStatus)),
    );
    heading.append(titleWrap, badge);

    const prompt = item.sentenceText || item.topic;
    const sentenceBox = this._root.createElement("div");
    sentenceBox.className = "my-contribution-sentence";
    const sentenceLabel = this._root.createElement("div");
    sentenceLabel.className = "my-contribution-sentence-label";
    sentenceLabel.textContent = item.sentenceText ? "Sentence" : "Topic";
    const sentence = this._root.createElement("p");
    sentence.textContent = prompt || "No sentence or topic was supplied.";
    if (item.sentenceText && item.language.toLowerCase() === "pashto") {
      sentence.setAttribute("lang", "ps");
      sentence.setAttribute("dir", "rtl");
    }
    sentenceBox.append(sentenceLabel, sentence);

    const audioRow = this._root.createElement("div");
    audioRow.className = "my-contribution-audio";
    const playButton = this._root.createElement("button");
    playButton.className = "my-contribution-play";
    playButton.setAttribute("type", "button");
    playButton.setAttribute(
      "aria-label",
      `Play ${formatContributionType(item.contributionType).toLowerCase()}`,
    );
    playButton.append(this._createSvgIcon(["M8 5v14l11-7z"]));
    const wave = this._root.createElement("span");
    wave.className = "my-contribution-wave";
    wave.setAttribute("aria-hidden", "true");
    for (let barIndex = 0; barIndex < 34; barIndex += 1) {
      const bar = this._root.createElement("i");
      bar.setAttribute(
        "style",
        `--bar-height: ${9 + ((barIndex * 13 + index * 7) % 24)}px; --bar-delay: ${(barIndex % 8) * -0.07}s`,
      );
      wave.append(bar);
    }
    const duration = this._root.createElement("span");
    duration.className = "my-contribution-duration";
    duration.textContent = formatContributionClock(item.durationSeconds);
    const progress = this._root.createElement("span");
    progress.className = "my-contribution-audio-progress";
    progress.setAttribute("aria-hidden", "true");
    audioRow.append(playButton, wave, duration, progress);

    const audioError = this._root.createElement("p");
    audioError.className = "my-contribution-audio-error";
    audioError.setAttribute("role", "alert");
    audioError.hidden = true;
    playButton.addEventListener("click", () => {
      void this._toggleAudioPlayback({ item, button: playButton, card, audioError });
    });

    const metaStrip = this._root.createElement("div");
    metaStrip.className = "my-contribution-meta-strip";
    metaStrip.append(
      this._createMetaItem("Language", item.language),
      this._createMetaItem("Format", formatContributionFileType(item.mimeType)),
      this._createMetaItem(
        item.reviewStatus === "approved" ? "Score" : "Privacy",
        item.reviewStatus === "approved" ? "+1 voice" : "Private",
      ),
    );

    const privacy = this._root.createElement("span");
    privacy.className = "my-contribution-privacy";
    privacy.append(
      item.reviewStatus === "approved"
        ? this._createSvgIcon(["m5 12 4 4L19 6"])
        : this._createSvgIcon([
            "M5 10h14v10H5z",
            "M8 10V7a4 4 0 0 1 8 0v3",
          ]),
      this._createText(
        item.reviewStatus === "approved"
          ? "Added to contribution score"
          : "Safe until reviewed",
      ),
    );

    const details = this._root.createElement("details");
    details.className = "my-contribution-details";
    const detailsSummary = this._root.createElement("summary");
    detailsSummary.textContent = "Details →";
    const detailsPanel = this._root.createElement("dl");
    detailsPanel.className = "my-contribution-details-panel";
    detailsPanel.append(
      this._createMetadataRow(
        "Review",
        contributionReviewHelper(item.reviewStatus),
      ),
      this._createMetadataRow("Submitted", submitted.textContent),
      this._createMetadataRow("File", item.originalFilename),
      this._createMetadataRow("Format", item.mimeType),
    );
    const readableDuration = formatContributionDuration(item.durationSeconds);
    if (readableDuration) {
      detailsPanel.append(this._createMetadataRow("Duration", readableDuration));
    }
    const withdrawalLabel = formatContributionWithdrawalStatus(
      item.withdrawalStatus,
    );
    if (withdrawalLabel) {
      const withdrawal = this._root.createElement("p");
      withdrawal.className = "my-contribution-withdrawal";
      withdrawal.setAttribute("data-status", item.withdrawalStatus);
      withdrawal.textContent = withdrawalLabel;
      detailsPanel.append(withdrawal);
    }
    if (item.reviewStatus === "rejected" && item.rejectionReason) {
      const feedback = this._root.createElement("div");
      feedback.className = "my-contribution-feedback";
      const feedbackLabel = this._root.createElement("strong");
      feedbackLabel.textContent = "Administrator feedback";
      const feedbackText = this._root.createElement("p");
      feedbackText.textContent = item.rejectionReason;
      feedback.append(feedbackLabel, feedbackText);
      detailsPanel.append(feedback);
    }
    details.append(detailsSummary, detailsPanel);
    const cardFoot = this._root.createElement("div");
    cardFoot.className = "my-contribution-card-foot";
    cardFoot.append(privacy, details);

    card.append(
      glow,
      scan,
      heading,
      sentenceBox,
      audioRow,
      audioError,
      metaStrip,
      cardFoot,
    );
    return card;
  }

  _setPlayButtonIcon(button, playing) {
    button.replaceChildren(
      playing
        ? this._createSvgIcon(["M7 5h4v14H7z", "M14 5h4v14h-4z"])
        : this._createSvgIcon(["M8 5v14l11-7z"]),
    );
    button.setAttribute(
      "aria-label",
      playing ? "Pause recording playback" : "Play recording",
    );
  }

  _bindActiveAudioEvent(type, listener) {
    this._activeAudio?.addEventListener?.(type, listener);
    this._activeAudioBindings.push({ type, listener });
  }

  _stopAudioPlayback({ keepError = false } = {}) {
    this._audioRequestId += 1;
    const audio = this._activeAudio;
    if (audio) {
      for (const { type, listener } of this._activeAudioBindings) {
        audio.removeEventListener?.(type, listener);
      }
      try {
        audio.pause?.();
      } catch {
        // The private Blob URL is still revoked below.
      }
    }
    toggleClass(this._activeAudioCard, "playing", false);
    this._activeAudioCard?.style?.removeProperty?.("--audio-progress");
    if (this._activeAudioButton) {
      this._activeAudioButton.disabled = false;
      this._activeAudioButton.removeAttribute?.("aria-busy");
      this._setPlayButtonIcon(this._activeAudioButton, false);
    }
    if (
      this._activeAudioUrl &&
      typeof this._urlApi?.revokeObjectURL === "function"
    ) {
      this._urlApi.revokeObjectURL(this._activeAudioUrl);
    }
    if (!keepError && this._activeAudioCard) {
      const error = this._activeAudioCard.querySelector?.(
        ".my-contribution-audio-error",
      );
      if (error) {
        error.hidden = true;
        error.textContent = "";
      }
    }
    this._activeAudio = null;
    this._activeAudioUrl = null;
    this._activeAudioBindings = [];
    this._activeAudioCard = null;
    this._activeAudioButton = null;
  }

  async _toggleAudioPlayback({ item, button, card, audioError }) {
    if (this._destroyed || !this._activeUserId) return false;
    audioError.hidden = true;
    audioError.textContent = "";

    if (this._activeAudio && this._activeAudioCard === card) {
      if (this._activeAudio.paused) {
        try {
          await Promise.resolve(this._activeAudio.play?.());
          return true;
        } catch {
          audioError.textContent = "This recording could not be played.";
          audioError.hidden = false;
          this._stopAudioPlayback({ keepError: true });
          return false;
        }
      }
      this._activeAudio.pause?.();
      return true;
    }

    this._stopAudioPlayback();
    const requestId = this._audioRequestId;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-label", "Loading recording");

    let audioBlob;
    try {
      audioBlob = await this._api.getMyContributionAudio({
        contributionId: item.id,
      });
    } catch (error) {
      if (requestId !== this._audioRequestId || this._destroyed) return false;
      button.disabled = false;
      button.removeAttribute?.("aria-busy");
      this._setPlayButtonIcon(button, false);
      if (this._isUnauthorized(error)) {
        this._handleUnauthorized();
        return false;
      }
      audioError.textContent = "This recording could not be loaded. Please try again.";
      audioError.hidden = false;
      return false;
    }
    if (requestId !== this._audioRequestId || this._destroyed) return false;

    try {
      const objectUrl = this._urlApi.createObjectURL(audioBlob);
      const audio = this._audioFactory(objectUrl);
      this._activeAudio = audio;
      this._activeAudioUrl = objectUrl;
      this._activeAudioCard = card;
      this._activeAudioButton = button;
      this._bindActiveAudioEvent("play", () => {
        toggleClass(card, "playing", true);
        this._setPlayButtonIcon(button, true);
      });
      this._bindActiveAudioEvent("pause", () => {
        toggleClass(card, "playing", false);
        this._setPlayButtonIcon(button, false);
      });
      this._bindActiveAudioEvent("timeupdate", () => {
        const duration = Number(audio.duration);
        const currentTime = Number(audio.currentTime);
        const progressValue =
          Number.isFinite(duration) && duration > 0 && Number.isFinite(currentTime)
            ? Math.min(1, Math.max(0, currentTime / duration))
            : 0;
        card.style?.setProperty?.("--audio-progress", String(progressValue));
      });
      this._bindActiveAudioEvent("ended", () => {
        this._stopAudioPlayback();
      });
      this._bindActiveAudioEvent("error", () => {
        audioError.textContent = "This recording could not be played.";
        audioError.hidden = false;
        this._stopAudioPlayback({ keepError: true });
      });
      button.disabled = false;
      button.removeAttribute?.("aria-busy");
      await Promise.resolve(audio.play?.());
      return true;
    } catch {
      audioError.textContent = "This recording could not be played.";
      audioError.hidden = false;
      this._stopAudioPlayback({ keepError: true });
      return false;
    }
  }

  _renderList() {
    this._stopAudioPlayback();
    const cards = this._state.items.map((item, index) =>
      this._createContributionItem(item, index),
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
    const statisticsLoading = this._statistics.status === "loading";
    const statisticsReady = this._statistics.status === "loaded";
    const statisticsError = this._statistics.status === "error";

    this._elements.section.hidden = !active || !this._sectionOpen;
    this._elements.summary.hidden = !active;
    this._elements.summary.setAttribute(
      "aria-busy",
      String(statisticsLoading),
    );
    this._elements.summaryStatus.textContent = statisticsLoading
      ? "Loading contribution summary…"
      : statisticsError
        ? this._statistics.error?.message ??
          "We could not load your contribution summary."
        : "";
    this._elements.summaryStatus.hidden = statisticsReady;
    const neutralValue = statisticsReady ? null : "—";
    this._elements.summaryTotal.textContent =
      neutralValue ?? String(this._statistics.total);
    this._elements.summaryPending.textContent =
      neutralValue ?? String(this._statistics.pending);
    this._elements.summaryApproved.textContent =
      neutralValue ?? String(this._statistics.approved);
    this._elements.summaryRejected.textContent =
      neutralValue ?? String(this._statistics.rejected);
    this._elements.scoreValue.textContent =
      neutralValue ?? String(this._statistics.approved);
    this._elements.updated.textContent = loading
      ? "Checking for updates…"
      : this._state.status === "loaded"
        ? "Updated just now"
        : "Ready to refresh";
    this._elements.visibleCount.textContent = loading && !hasItems
      ? "Loading recordings…"
      : this._state.status === "idle"
        ? "No recordings loaded"
        : `Showing ${this._state.items.length} of ${this._state.total} recording${
            this._state.total === 1 ? "" : "s"
          }`;
    const filters = {
      all: this._elements.filterAll,
      pending: this._elements.filterPending,
      approved: this._elements.filterApproved,
      rejected: this._elements.filterRejected,
    };
    for (const [status, button] of Object.entries(filters)) {
      const selected = status === this._filter;
      toggleClass(button, "active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = loading || loadingMore;
    }
    this._elements.status.hidden = !loading;
    this._elements.status.textContent = loading
      ? hasItems
        ? "Refreshing your contributions…"
        : "Loading your contributions…"
      : "";
    this._elements.empty.hidden = !empty;
    this._elements.emptyTitle.textContent =
      this._filter === "all"
        ? "You have not submitted any voice contributions yet."
        : `No ${this._filter} recordings were found.`;
    this._elements.emptyDescription.textContent =
      this._filter === "all"
        ? "Record your first contribution to help improve KP AWAZ."
        : "Choose another review filter to continue browsing your history.";
    this._elements.error.hidden = !initialError;
    this._elements.errorMessage.textContent = initialError
      ? this._state.error.message
      : "";
    this._elements.retryButton.disabled = loading || loadingMore;
    this._elements.list.hidden = !hasItems;
    this._renderList();
    this._elements.refreshButton.disabled = loading || loadingMore;
    this._elements.refreshButton.setAttribute(
      "aria-busy",
      String(loading || loadingMore),
    );
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
