import {
  getAdminContribution,
  getAdminContributionAudio,
  getAdminContributions,
  reviewAdminContribution,
} from "../services/admin-review-api.js";

const PAGE_LIMIT = 20;
const REVIEW_FILTERS = new Set(["pending", "approved", "rejected", "all"]);
const AUTH_ERROR_CODES = new Set(["ADMIN_KEY_REQUIRED", "INVALID_ADMIN_KEY"]);
const adminConnectionListeners = new Set();

const defaultAdminApi = Object.freeze({
  listContributions: getAdminContributions,
  getContribution: getAdminContribution,
  getContributionAudio: getAdminContributionAudio,
  reviewContribution: reviewAdminContribution,
});


function notifyAdminConnection(connected, adminKey = null) {
  const state = Object.freeze({
    connected: Boolean(connected),
    adminKey: connected && typeof adminKey === "string" ? adminKey : null,
  });
  for (const listener of [...adminConnectionListeners]) {
    try {
      listener(state);
    } catch {
      // A secondary protected panel must not interrupt the main review workspace.
    }
  }
}


function emptyQueue() {
  return {
    status: "idle",
    items: [],
    total: 0,
    limit: PAGE_LIMIT,
    offset: 0,
    error: null,
  };
}


function emptySelection() {
  return {
    id: null,
    status: "idle",
    item: null,
    error: null,
    audioStatus: "idle",
    audioError: null,
  };
}


function emptyReview() {
  return { status: "idle", message: "", error: null };
}


function initialState() {
  return {
    connectionStatus: "idle",
    connectionMessage: "",
    adminKey: null,
    filter: "pending",
    pendingTotal: 0,
    pendingStatus: "idle",
    queue: emptyQueue(),
    selection: emptySelection(),
    review: emptyReview(),
  };
}


function cloneItem(item) {
  return item ? { ...item } : null;
}


function safePage(page) {
  return {
    status: "ready",
    items: Array.isArray(page?.items) ? page.items.map((item) => ({ ...item })) : [],
    total: Number.isInteger(page?.total) && page.total >= 0 ? page.total : 0,
    limit:
      Number.isInteger(page?.limit) && page.limit >= 1 ? page.limit : PAGE_LIMIT,
    offset: Number.isInteger(page?.offset) && page.offset >= 0 ? page.offset : 0,
    error: null,
  };
}


function isAuthenticationError(error) {
  const status = Number.isInteger(error?.status) ? error.status : 0;
  const code = typeof error?.code === "string" ? error.code : "";
  return status === 401 || status === 403 || AUTH_ERROR_CODES.has(code);
}


function safeError(scope) {
  if (scope === "connection") {
    return "We could not connect to the review queue. Check the backend and try again.";
  }
  if (scope === "detail") {
    return "We could not load this contribution's details. The queue is still available.";
  }
  if (scope === "audio") {
    return "The protected recording could not be loaded. You can retry without losing the details.";
  }
  if (scope === "review") {
    return "The review action could not be completed. Please try again.";
  }
  return "We could not refresh this review queue. Existing results are still available.";
}


export function formatAdminContributionType(value) {
  const type = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (type === "guided") return "Guided recording";
  if (type === "open" || type === "open_recording") return "Open recording";
  return "Voice contribution";
}


export function formatAdminDuration(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "Not reported";
  }
  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} sec`;
  return `${minutes} min ${seconds.toString().padStart(2, "0")} sec`;
}


export function formatAdminDate(value, locale = undefined) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Not available";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "Not available";
  }
}


export function formatReviewStatus(value) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}


function displayPrompt(item) {
  if (typeof item?.sentenceText === "string" && item.sentenceText.trim()) {
    return item.sentenceText.trim();
  }
  if (typeof item?.topic === "string" && item.topic.trim()) return item.topic.trim();
  return "No prompt was provided.";
}


function ownerLabel(item) {
  if (!item?.hasOwner) return "Legacy contribution";
  const displayName =
    typeof item.ownerDisplayName === "string" ? item.ownerDisplayName.trim() : "";
  return displayName ? `Owned contribution — ${displayName}` : "Owned contribution";
}


function queueRange(queue) {
  if (!queue.total || !queue.items.length) return "No results";
  const start = queue.offset + 1;
  const end = Math.min(queue.offset + queue.items.length, queue.total);
  return `${start}–${end} of ${queue.total}`;
}


function formatFilter(value) {
  return value === "all" ? "All contributions" : `${formatReviewStatus(value)} contributions`;
}


export class AdminReview {
  constructor({
    root = globalThis.document,
    api = defaultAdminApi,
    urlApi = globalThis.URL,
    locale = undefined,
  } = {}) {
    this._root = root;
    this._api = api;
    this._urlApi = urlApi;
    this._locale = locale;
    this._elements = null;
    this._bindings = [];
    this._state = initialState();
    this._initialized = false;
    this._destroyed = false;
    this._lifecycleId = 0;
    this._connectionGeneration = 0;
    this._queueGeneration = 0;
    this._pendingGeneration = 0;
    this._selectionGeneration = 0;
    this._audioGeneration = 0;
    this._reviewGeneration = 0;
    this._audioUrl = null;
  }

  initializeAdminReview() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;
    this._initialized = true;
    this._destroyed = false;
    this._lifecycleId += 1;
    this._bindEvents();
    this._render();
    return true;
  }

  getState() {
    return {
      connectionStatus: this._state.connectionStatus,
      connectionMessage: this._state.connectionMessage,
      hasAdminKey: Boolean(this._state.adminKey),
      filter: this._state.filter,
      pendingTotal: this._state.pendingTotal,
      pendingStatus: this._state.pendingStatus,
      queue: {
        ...this._state.queue,
        items: this._state.queue.items.map((item) => ({ ...item })),
        error: this._state.queue.error ? { ...this._state.queue.error } : null,
      },
      selection: {
        ...this._state.selection,
        item: cloneItem(this._state.selection.item),
        error: this._state.selection.error
          ? { ...this._state.selection.error }
          : null,
        audioError: this._state.selection.audioError
          ? { ...this._state.selection.audioError }
          : null,
      },
      review: {
        ...this._state.review,
        error: this._state.review.error ? { ...this._state.review.error } : null,
      },
    };
  }

  async connect() {
    if (!this._initialized || this._destroyed) return false;
    if (this._state.connectionStatus === "connecting") return false;
    const input = this._elements.adminKeyInput;
    const key = typeof input.value === "string" ? input.value.trim() : "";
    input.setCustomValidity?.(key ? "" : "Enter the backend admin API key.");
    if (!key) {
      input.reportValidity?.();
      this._state.connectionStatus = "error";
      this._state.connectionMessage = "Enter the backend admin API key to continue.";
      this._renderConnection();
      return false;
    }

    const generation = ++this._connectionGeneration;
    const lifecycleId = this._lifecycleId;
    this._state.adminKey = key;
    this._state.connectionStatus = "connecting";
    this._state.connectionMessage = "Checking the key and loading the pending queue…";
    this._state.filter = "pending";
    this._state.pendingStatus = "loading";
    this._state.queue = { ...emptyQueue(), status: "loading" };
    input.value = "";
    this._render();

    try {
      const response = await this._api.listContributions({
        adminKey: key,
        status: "pending",
        limit: PAGE_LIMIT,
        offset: 0,
      });
      if (!this._isConnectionCurrent(generation, lifecycleId, key)) return false;
      this._state.connectionStatus = "connected";
      this._state.connectionMessage = "";
      this._state.queue = safePage(response);
      this._state.pendingTotal = this._state.queue.total;
      this._state.pendingStatus = "ready";
      this._render();
      notifyAdminConnection(true, key);
      return true;
    } catch (error) {
      if (!this._isConnectionCurrent(generation, lifecycleId, key)) return false;
      this._state.adminKey = null;
      this._state.queue = emptyQueue();
      this._state.pendingTotal = 0;
      this._state.pendingStatus = "idle";
      this._state.connectionStatus = "error";
      this._state.connectionMessage = isAuthenticationError(error)
        ? "The admin key was not accepted. Enter it again to reconnect."
        : safeError("connection");
      this._render();
      notifyAdminConnection(false);
      this._elements.adminKeyInput.focus?.();
      return false;
    }
  }

  disconnect({ message = "" } = {}) {
    if (!this._initialized) return false;
    this._invalidateRequests();
    this._revokeAudioUrl();
    const nextState = initialState();
    nextState.connectionMessage = message;
    nextState.connectionStatus = message ? "error" : "idle";
    this._state = nextState;
    notifyAdminConnection(false);
    this._elements.adminKeyInput.value = "";
    this._elements.adminRejectionReason.value = "";
    this._render();
    this._elements.adminKeyInput.focus?.();
    return true;
  }

  async loadQueue({ offset = this._state.queue.offset, keepSelection = false } = {}) {
    if (!this._isConnected() || this._state.queue.status === "loading") return false;
    const key = this._state.adminKey;
    const filter = this._state.filter;
    const lifecycleId = this._lifecycleId;
    const generation = ++this._queueGeneration;
    if (!keepSelection) this._clearSelection();
    this._state.queue = {
      ...this._state.queue,
      status: "loading",
      offset,
      error: null,
    };
    this._render();

    try {
      const response = await this._api.listContributions({
        adminKey: key,
        status: filter,
        limit: PAGE_LIMIT,
        offset,
      });
      if (!this._isQueueCurrent(generation, lifecycleId, key, filter)) return false;
      const page = safePage(response);
      if (page.items.length === 0 && page.total > 0 && page.offset >= page.total) {
        this._state.queue = { ...this._state.queue, status: "ready" };
        const priorOffset = Math.max(0, page.offset - page.limit);
        return this.loadQueue({ offset: priorOffset, keepSelection });
      }
      this._state.queue = page;
      if (filter === "pending") {
        this._state.pendingTotal = page.total;
        this._state.pendingStatus = "ready";
      }
      this._render();
      if (filter !== "pending") void this._refreshPendingTotal();
      return true;
    } catch (error) {
      if (!this._isQueueCurrent(generation, lifecycleId, key, filter)) return false;
      if (isAuthenticationError(error)) {
        this._invalidateAuthentication();
        return false;
      }
      this._state.queue = {
        ...this._state.queue,
        status: "error",
        error: { message: safeError("queue") },
      };
      this._render();
      return false;
    }
  }

  async selectContribution(contributionId, { force = false } = {}) {
    const id = typeof contributionId === "string" ? contributionId.trim() : "";
    if (!this._isConnected() || !id) return false;
    if (!force && this._state.selection.id === id) return false;
    this._revokeAudioUrl();
    const selectionGeneration = ++this._selectionGeneration;
    ++this._audioGeneration;
    ++this._reviewGeneration;
    const lifecycleId = this._lifecycleId;
    const key = this._state.adminKey;
    this._state.selection = {
      ...emptySelection(),
      id,
      status: "loading",
      audioStatus: "loading",
    };
    this._state.review = emptyReview();
    this._elements.adminRejectionReason.value = "";
    this._elements.adminRejectionReason.setCustomValidity?.("");
    this._render();

    void this._loadAudio({ id, key, lifecycleId, selectionGeneration });
    try {
      const item = await this._api.getContribution({
        adminKey: key,
        contributionId: id,
      });
      if (!this._isSelectionCurrent(selectionGeneration, lifecycleId, key, id)) {
        return false;
      }
      this._state.selection = {
        ...this._state.selection,
        status: "ready",
        item: { ...item },
        error: null,
      };
      this._render();
      this._elements.adminDetailPanel.focus?.();
      return true;
    } catch (error) {
      if (!this._isSelectionCurrent(selectionGeneration, lifecycleId, key, id)) {
        return false;
      }
      if (isAuthenticationError(error)) {
        this._invalidateAuthentication();
        return false;
      }
      ++this._audioGeneration;
      this._revokeAudioUrl();
      this._state.selection = {
        ...this._state.selection,
        status: "error",
        item: null,
        error: { message: safeError("detail") },
        audioStatus: "idle",
        audioError: null,
      };
      this._render();
      return false;
    }
  }

  async _refreshPendingTotal() {
    if (!this._isConnected()) return false;
    const key = this._state.adminKey;
    const lifecycleId = this._lifecycleId;
    const generation = ++this._pendingGeneration;
    this._state.pendingStatus = "loading";
    this._renderPendingCount();
    try {
      const response = await this._api.listContributions({
        adminKey: key,
        status: "pending",
        limit: 1,
        offset: 0,
      });
      if (!this._isPendingCurrent(generation, lifecycleId, key)) return false;
      this._state.pendingTotal =
        Number.isInteger(response?.total) && response.total >= 0
          ? response.total
          : 0;
      this._state.pendingStatus = "ready";
      this._renderPendingCount();
      return true;
    } catch (error) {
      if (!this._isPendingCurrent(generation, lifecycleId, key)) return false;
      if (isAuthenticationError(error)) {
        this._invalidateAuthentication();
        return false;
      }
      this._state.pendingStatus = "error";
      this._renderPendingCount();
      return false;
    }
  }

  async retryAudio() {
    const { id, status } = this._state.selection;
    if (!this._isConnected() || !id || status !== "ready") return false;
    const key = this._state.adminKey;
    const lifecycleId = this._lifecycleId;
    const selectionGeneration = this._selectionGeneration;
    this._revokeAudioUrl();
    this._state.selection.audioStatus = "loading";
    this._state.selection.audioError = null;
    this._renderAudio();
    return this._loadAudio({ id, key, lifecycleId, selectionGeneration });
  }

  async review(status) {
    const decision = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (
      !this._isConnected() ||
      !["approved", "rejected"].includes(decision) ||
      this._state.selection.status !== "ready" ||
      this._state.review.status === "saving"
    ) {
      return false;
    }

    const reasonField = this._elements.adminRejectionReason;
    const reason = typeof reasonField.value === "string" ? reasonField.value.trim() : "";
    reasonField.setCustomValidity?.("");
    if (decision === "rejected" && !reason) {
      reasonField.setCustomValidity?.("Enter a reason before rejecting this recording.");
      reasonField.reportValidity?.();
      this._state.review = {
        status: "error",
        message: "Enter a rejection reason before saving this decision.",
        error: { message: "A rejection reason is required." },
      };
      this._renderReview();
      return false;
    }
    if (reason.length > 500) {
      reasonField.setCustomValidity?.("Keep the rejection reason to 500 characters or fewer.");
      reasonField.reportValidity?.();
      return false;
    }

    const id = this._state.selection.id;
    const priorReviewStatus = this._state.selection.item.reviewStatus;
    const key = this._state.adminKey;
    const lifecycleId = this._lifecycleId;
    const selectionGeneration = this._selectionGeneration;
    const generation = ++this._reviewGeneration;
    this._state.review = {
      status: "saving",
      message: decision === "approved" ? "Approving…" : "Rejecting…",
      error: null,
    };
    this._renderReview();

    try {
      const item = await this._api.reviewContribution({
        adminKey: key,
        contributionId: id,
        status: decision,
        rejectionReason: decision === "rejected" ? reason : "",
      });
      if (
        !this._isReviewCurrent(
          generation,
          selectionGeneration,
          lifecycleId,
          key,
          id,
        )
      ) {
        return false;
      }
      this._state.selection.item = { ...item };
      this._state.review = {
        status: "success",
        message:
          decision === "approved"
            ? "Contribution approved. The contributor’s score will update on their next refresh."
            : "Contribution rejected. It will not count toward the contributor’s score.",
        error: null,
      };
      reasonField.value = "";
      reasonField.setCustomValidity?.("");
      this._replaceQueueItem(item);
      if (priorReviewStatus === "pending" && decision !== "pending") {
        this._state.pendingTotal = Math.max(0, this._state.pendingTotal - 1);
        this._state.pendingStatus = "ready";
      }
      this._render();
      void this.loadQueue({ offset: this._state.queue.offset, keepSelection: true });
      return true;
    } catch (error) {
      if (
        !this._isReviewCurrent(
          generation,
          selectionGeneration,
          lifecycleId,
          key,
          id,
        )
      ) {
        return false;
      }
      if (isAuthenticationError(error)) {
        this._invalidateAuthentication();
        return false;
      }
      this._state.review = {
        status: "error",
        message: safeError("review"),
        error: { message: safeError("review") },
      };
      this._renderReview();
      return false;
    }
  }

  closeSelection() {
    if (!this._state.selection.id) return false;
    this._clearSelection();
    this._render();
    return true;
  }

  destroy() {
    if (!this._initialized) return false;
    this._destroyed = true;
    this._initialized = false;
    this._lifecycleId += 1;
    this._invalidateRequests();
    this._revokeAudioUrl();
    for (const { element, type, handler } of this._bindings) {
      element.removeEventListener(type, handler);
    }
    this._bindings = [];
    this._state = initialState();
    notifyAdminConnection(false);
    if (this._elements) {
      this._elements.adminKeyInput.value = "";
      this._elements.adminRejectionReason.value = "";
      this._render();
    }
    return true;
  }

  async _loadAudio({ id, key, lifecycleId, selectionGeneration }) {
    const audioGeneration = ++this._audioGeneration;
    try {
      const blob = await this._api.getContributionAudio({
        adminKey: key,
        contributionId: id,
      });
      if (
        !this._isAudioCurrent(
          audioGeneration,
          selectionGeneration,
          lifecycleId,
          key,
          id,
        )
      ) {
        return false;
      }
      const url = this._urlApi?.createObjectURL?.(blob);
      if (typeof url !== "string" || !url) {
        throw new Error("Object URL unavailable");
      }
      if (
        !this._isAudioCurrent(
          audioGeneration,
          selectionGeneration,
          lifecycleId,
          key,
          id,
        )
      ) {
        this._urlApi?.revokeObjectURL?.(url);
        return false;
      }
      this._revokeAudioUrl();
      this._audioUrl = url;
      this._state.selection.audioStatus = "ready";
      this._state.selection.audioError = null;
      this._renderAudio();
      return true;
    } catch (error) {
      if (
        !this._isAudioCurrent(
          audioGeneration,
          selectionGeneration,
          lifecycleId,
          key,
          id,
        )
      ) {
        return false;
      }
      if (isAuthenticationError(error)) {
        this._invalidateAuthentication();
        return false;
      }
      this._state.selection.audioStatus = "error";
      this._state.selection.audioError = { message: safeError("audio") };
      this._renderAudio();
      return false;
    }
  }

  _replaceQueueItem(item) {
    const belongs =
      this._state.filter === "all" || item.reviewStatus === this._state.filter;
    const index = this._state.queue.items.findIndex((entry) => entry.id === item.id);
    if (index < 0) return;
    if (belongs) {
      this._state.queue.items[index] = { ...item };
      return;
    }
    this._state.queue.items.splice(index, 1);
    this._state.queue.total = Math.max(0, this._state.queue.total - 1);
  }

  _setFilter(filter) {
    if (!REVIEW_FILTERS.has(filter) || filter === this._state.filter) return;
    ++this._queueGeneration;
    ++this._pendingGeneration;
    this._state.queue.status = "ready";
    this._state.filter = filter;
    this._clearSelection();
    void this.loadQueue({ offset: 0 });
  }

  _clearSelection() {
    ++this._selectionGeneration;
    ++this._audioGeneration;
    ++this._reviewGeneration;
    this._revokeAudioUrl();
    this._state.selection = emptySelection();
    this._state.review = emptyReview();
    if (this._elements) {
      this._elements.adminRejectionReason.value = "";
      this._elements.adminRejectionReason.setCustomValidity?.("");
    }
  }

  _invalidateAuthentication() {
    this.disconnect({
      message: "The admin key is no longer valid. Enter it again to reconnect.",
    });
  }

  _invalidateRequests() {
    ++this._connectionGeneration;
    ++this._queueGeneration;
    ++this._pendingGeneration;
    ++this._selectionGeneration;
    ++this._audioGeneration;
    ++this._reviewGeneration;
  }

  _isConnected() {
    return (
      this._initialized &&
      !this._destroyed &&
      this._state.connectionStatus === "connected" &&
      Boolean(this._state.adminKey)
    );
  }

  _isConnectionCurrent(generation, lifecycleId, key) {
    return (
      this._initialized &&
      !this._destroyed &&
      generation === this._connectionGeneration &&
      lifecycleId === this._lifecycleId &&
      this._state.adminKey === key
    );
  }

  _isQueueCurrent(generation, lifecycleId, key, filter) {
    return (
      this._isConnected() &&
      generation === this._queueGeneration &&
      lifecycleId === this._lifecycleId &&
      this._state.adminKey === key &&
      this._state.filter === filter
    );
  }

  _isPendingCurrent(generation, lifecycleId, key) {
    return (
      this._isConnected() &&
      generation === this._pendingGeneration &&
      lifecycleId === this._lifecycleId &&
      this._state.adminKey === key
    );
  }

  _isSelectionCurrent(generation, lifecycleId, key, id) {
    return (
      this._isConnected() &&
      generation === this._selectionGeneration &&
      lifecycleId === this._lifecycleId &&
      this._state.adminKey === key &&
      this._state.selection.id === id
    );
  }

  _isAudioCurrent(audioGeneration, selectionGeneration, lifecycleId, key, id) {
    return (
      this._isSelectionCurrent(selectionGeneration, lifecycleId, key, id) &&
      audioGeneration === this._audioGeneration
    );
  }

  _isReviewCurrent(
    generation,
    selectionGeneration,
    lifecycleId,
    key,
    id,
  ) {
    return (
      this._isSelectionCurrent(selectionGeneration, lifecycleId, key, id) &&
      generation === this._reviewGeneration
    );
  }

  _revokeAudioUrl() {
    const player = this._elements?.adminAudioPlayer;
    if (player) {
      player.pause?.();
      player.removeAttribute?.("src");
      player.load?.();
    }
    if (this._audioUrl) {
      this._urlApi?.revokeObjectURL?.(this._audioUrl);
      this._audioUrl = null;
    }
  }

  _bindEvents() {
    this._bind(this._elements.adminConnectionForm, "submit", (event) => {
      event.preventDefault?.();
      void this.connect();
    });
    this._bind(this._elements.adminKeyInput, "input", () => {
      this._elements.adminKeyInput.setCustomValidity?.("");
      if (this._state.connectionStatus === "error") {
        this._state.connectionMessage = "";
        this._renderConnection();
      }
    });
    this._bind(this._elements.adminDisconnectButton, "click", () => this.disconnect());
    this._bind(this._elements.adminRetryQueueButton, "click", () => {
      void this.loadQueue();
    });
    this._bind(this._elements.adminRefreshQueueButton, "click", () => {
      void this.loadQueue({ offset: 0 });
    });
    this._bind(this._elements.adminPreviousPageButton, "click", () => {
      const offset = Math.max(0, this._state.queue.offset - this._state.queue.limit);
      void this.loadQueue({ offset });
    });
    this._bind(this._elements.adminNextPageButton, "click", () => {
      const offset = this._state.queue.offset + this._state.queue.limit;
      void this.loadQueue({ offset });
    });
    this._bind(this._elements.adminCloseDetailButton, "click", () => {
      this.closeSelection();
    });
    this._bind(this._elements.adminRetryDetailButton, "click", () => {
      const id = this._state.selection.id;
      if (id) void this.selectContribution(id, { force: true });
    });
    this._bind(this._elements.adminRetryAudioButton, "click", () => {
      void this.retryAudio();
    });
    this._bind(this._elements.adminApproveButton, "click", () => {
      void this.review("approved");
    });
    this._bind(this._elements.adminRejectButton, "click", () => {
      void this.review("rejected");
    });
    this._bind(this._elements.adminReviewForm, "submit", (event) => {
      event.preventDefault?.();
    });
    this._bind(this._elements.adminRejectionReason, "input", () => {
      this._elements.adminRejectionReason.setCustomValidity?.("");
      this._renderReasonCount();
      if (this._state.review.status === "error") {
        this._state.review = emptyReview();
        this._renderReviewStatus();
      }
    });
    for (const button of this._elements.filterButtons) {
      this._bind(button, "click", () => {
        this._setFilter(button.getAttribute("data-admin-filter"));
      });
    }
  }

  _bind(element, type, handler) {
    element.addEventListener(type, handler);
    this._bindings.push({ element, type, handler });
  }

  _resolveElements() {
    const ids = [
      "adminConnectionView",
      "adminConnectionForm",
      "adminKeyInput",
      "adminConnectButton",
      "adminConnectionStatus",
      "adminDashboard",
      "adminDisconnectButton",
      "adminPendingCount",
      "adminRefreshQueueButton",
      "adminQueueSummary",
      "adminQueueStatus",
      "adminQueueError",
      "adminQueueErrorMessage",
      "adminRetryQueueButton",
      "adminQueueEmpty",
      "adminQueueEmptyTitle",
      "adminQueueEmptyDescription",
      "adminContributionList",
      "adminPreviousPageButton",
      "adminNextPageButton",
      "adminPaginationStatus",
      "adminDetailPanel",
      "adminCloseDetailButton",
      "adminDetailStatus",
      "adminDetailError",
      "adminDetailErrorMessage",
      "adminRetryDetailButton",
      "adminDetailContent",
      "adminAudioPanel",
      "adminAudioStatus",
      "adminAudioPlayer",
      "adminRetryAudioButton",
      "adminReviewForm",
      "adminReviewNotice",
      "adminReviewBadge",
      "adminRejectionReason",
      "adminRejectionCount",
      "adminApproveButton",
      "adminRejectButton",
      "adminReviewStatus",
      "adminSelectionPrompt",
    ];
    const elements = {};
    for (const id of ids) {
      const element = this._root?.getElementById?.(id);
      if (!element) return null;
      elements[id] = element;
    }
    elements.filterButtons = [
      ...(this._root?.querySelectorAll?.("[data-admin-filter]") ?? []),
    ];
    if (elements.filterButtons.length !== REVIEW_FILTERS.size) return null;
    return elements;
  }

  _render() {
    if (!this._elements) return;
    this._renderConnection();
    this._renderPendingCount();
    this._renderFilters();
    this._renderQueue();
    this._renderSelection();
  }

  _renderConnection() {
    const connected = this._state.connectionStatus === "connected";
    this._elements.adminConnectionView.hidden = connected;
    this._elements.adminDashboard.hidden = !connected;
    this._elements.adminConnectButton.disabled =
      this._state.connectionStatus === "connecting";
    this._elements.adminKeyInput.disabled =
      this._state.connectionStatus === "connecting";
    this._elements.adminConnectButton.textContent =
      this._state.connectionStatus === "connecting" ? "Connecting…" : "Connect securely";
    this._elements.adminConnectionStatus.textContent = this._state.connectionMessage;
  }

  _renderFilters() {
    const loading = this._state.queue.status === "loading";
    for (const button of this._elements.filterButtons) {
      const active = button.getAttribute("data-admin-filter") === this._state.filter;
      button.setAttribute("aria-pressed", String(active));
      button.classList?.toggle?.("is-active", active);
      button.disabled = loading;
    }
  }

  _renderPendingCount() {
    if (!this._elements) return;
    this._elements.adminPendingCount.textContent =
      this._state.pendingStatus === "loading"
        ? "Pending reviews: loading…"
        : this._state.pendingStatus === "error"
          ? "Pending reviews unavailable"
          : `Pending reviews: ${this._state.pendingTotal}`;
  }

  _renderQueue() {
    const queue = this._state.queue;
    const loading = queue.status === "loading";
    const hasError = queue.status === "error";
    this._elements.adminQueueSummary.textContent =
      queue.status === "idle" ? "" : `${formatFilter(this._state.filter)} · ${queue.total}`;
    this._elements.adminQueueStatus.textContent = loading
      ? queue.items.length
        ? "Refreshing queue…"
        : "Loading contributions…"
      : "";
    this._elements.adminQueueError.hidden = !hasError;
    this._elements.adminQueueErrorMessage.textContent = hasError
      ? queue.error?.message ?? safeError("queue")
      : "";
    this._elements.adminQueueEmpty.hidden =
      loading || hasError || queue.items.length > 0 || queue.status === "idle";
    const pendingView = this._state.filter === "pending";
    this._elements.adminQueueEmptyTitle.textContent = pendingView
      ? "No recordings are waiting for review."
      : "No contributions in this view";
    this._elements.adminQueueEmptyDescription.textContent = pendingView
      ? "New submissions will appear here after the queue is refreshed."
      : "Choose another status or check again later.";
    this._renderQueueItems();
    this._elements.adminPaginationStatus.textContent = queueRange(queue);
    this._elements.adminPreviousPageButton.disabled = loading || queue.offset <= 0;
    this._elements.adminNextPageButton.disabled =
      loading || queue.offset + queue.items.length >= queue.total;
    this._elements.adminRetryQueueButton.disabled = loading;
    this._elements.adminRefreshQueueButton.disabled = loading;
    this._renderFilters();
  }

  _renderQueueItems() {
    const list = this._elements.adminContributionList;
    const fragment = this._root.createDocumentFragment?.();
    const parent = fragment ?? list;
    const nodes = [];
    for (const item of this._state.queue.items) {
      const listItem = this._root.createElement("li");
      const button = this._root.createElement("button");
      const top = this._root.createElement("span");
      const title = this._root.createElement("strong");
      const badge = this._root.createElement("span");
      const prompt = this._root.createElement("span");
      const meta = this._root.createElement("span");
      const language = this._root.createElement("span");
      const duration = this._root.createElement("span");
      const date = this._root.createElement("span");
      const owner = this._root.createElement("span");

      button.type = "button";
      button.className = "admin-contribution-card";
      const selected = item.id === this._state.selection.id;
      button.classList?.toggle?.("is-selected", selected);
      if (selected) button.setAttribute("aria-current", "true");
      button.setAttribute("aria-label", `Review ${formatAdminContributionType(item.contributionType)}`);
      button.addEventListener("click", () => {
        void this.selectContribution(item.id);
      });

      top.className = "admin-contribution-card__top";
      title.textContent = formatAdminContributionType(item.contributionType);
      badge.className = "admin-status-badge";
      badge.setAttribute("data-status", item.reviewStatus);
      badge.textContent = formatReviewStatus(item.reviewStatus);
      top.append(title, badge);

      prompt.className = "admin-contribution-card__prompt";
      prompt.textContent = displayPrompt(item);
      meta.className = "admin-contribution-card__meta";
      language.textContent = item.language;
      duration.textContent = formatAdminDuration(item.durationSeconds);
      date.textContent = formatAdminDate(item.createdAt, this._locale);
      owner.textContent = ownerLabel(item);
      meta.append(language, duration, date, owner);
      button.append(top, prompt, meta);
      listItem.append(button);
      if (fragment) parent.append(listItem);
      else nodes.push(listItem);
    }
    list.replaceChildren(...(fragment ? [fragment] : nodes));
  }

  _renderSelection() {
    const selection = this._state.selection;
    const hasSelection = Boolean(selection.id);
    this._elements.adminDetailPanel.hidden = !hasSelection;
    this._elements.adminSelectionPrompt.hidden = hasSelection;
    if (!hasSelection) return;

    const loading = selection.status === "loading";
    const hasError = selection.status === "error";
    const ready = selection.status === "ready" && Boolean(selection.item);
    this._elements.adminDetailStatus.textContent = loading
      ? "Loading contribution details…"
      : "";
    this._elements.adminDetailError.hidden = !hasError;
    this._elements.adminDetailErrorMessage.textContent = hasError
      ? selection.error?.message ?? safeError("detail")
      : "";
    this._elements.adminRetryDetailButton.disabled = loading;
    this._elements.adminDetailContent.hidden = !ready;
    this._elements.adminAudioPanel.hidden = !ready;
    this._elements.adminReviewForm.hidden = !ready;
    if (ready) this._renderDetailContent();
    this._renderAudio();
    this._renderReview();
  }

  _renderDetailContent() {
    const item = this._state.selection.item;
    const content = this._elements.adminDetailContent;
    const prompt = this._root.createElement("div");
    const promptLabel = this._root.createElement("span");
    const promptText = this._root.createElement("p");
    const metadata = this._root.createElement("dl");
    prompt.className = "admin-detail__prompt";
    promptLabel.textContent = item.sentenceText ? "Sentence" : item.topic ? "Topic" : "Prompt";
    promptText.textContent = displayPrompt(item);
    if (item.sentenceText) promptText.setAttribute("lang", "ps");
    prompt.append(promptLabel, promptText);
    metadata.className = "admin-metadata";

    const fields = [
      ["Type", formatAdminContributionType(item.contributionType)],
      ["Language", item.language],
      ["Duration", formatAdminDuration(item.durationSeconds)],
      ["Submitted", formatAdminDate(item.createdAt, this._locale)],
      ["Original file", item.originalFilename],
      ["Audio format", item.mimeType],
      ["Ownership", ownerLabel(item)],
      ["Review status", formatReviewStatus(item.reviewStatus)],
    ];
    if (item.reviewedAt) {
      fields.push(["Last reviewed", formatAdminDate(item.reviewedAt, this._locale)]);
    }
    if (item.rejectionReason) fields.push(["Current rejection reason", item.rejectionReason]);
    for (const [label, value] of fields) {
      const wrapper = this._root.createElement("div");
      const term = this._root.createElement("dt");
      const description = this._root.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      wrapper.append(term, description);
      metadata.append(wrapper);
    }
    content.replaceChildren(prompt, metadata);
  }

  _renderAudio() {
    const selection = this._state.selection;
    const player = this._elements.adminAudioPlayer;
    const retry = this._elements.adminRetryAudioButton;
    const ready = selection.status === "ready" && selection.audioStatus === "ready";
    const error = selection.status === "ready" && selection.audioStatus === "error";
    player.hidden = !ready;
    retry.hidden = !error;
    retry.disabled = selection.audioStatus === "loading";
    if (ready && this._audioUrl && player.getAttribute?.("src") !== this._audioUrl) {
      player.setAttribute("src", this._audioUrl);
    }
    if (!ready) player.removeAttribute?.("src");
    this._elements.adminAudioStatus.textContent =
      selection.audioStatus === "loading"
        ? "Loading the protected audio…"
        : error
          ? selection.audioError?.message ?? safeError("audio")
          : ready
            ? "Audio is ready to review."
            : "";
  }

  _renderReview() {
    const item = this._state.selection.item;
    if (!item || this._state.selection.status !== "ready") return;
    const saving = this._state.review.status === "saving";
    this._elements.adminApproveButton.disabled = saving;
    this._elements.adminRejectButton.disabled = saving;
    this._elements.adminRejectionReason.disabled = saving;
    this._elements.adminApproveButton.textContent =
      saving && this._state.review.message === "Approving…"
        ? "Approving…"
        : item.reviewStatus === "rejected"
          ? "Approve correction"
          : "Approve recording";
    this._elements.adminRejectButton.textContent =
      saving && this._state.review.message === "Rejecting…"
        ? "Rejecting…"
        : item.reviewStatus === "approved"
          ? "Change to rejected"
          : "Reject recording";
    this._elements.adminReviewBadge.textContent = formatReviewStatus(item.reviewStatus);
    this._elements.adminReviewBadge.setAttribute("data-status", item.reviewStatus);
    this._elements.adminReviewNotice.textContent =
      item.reviewStatus === "rejected"
        ? "Approving a corrected recording will clear its previous rejection reason."
        : item.reviewStatus === "approved"
          ? "A new reason is required if you change this approved recording to rejected."
          : "Approve the recording or give a clear reason for rejection.";
    this._renderReasonCount();
    this._renderReviewStatus();
  }

  _renderReasonCount() {
    const value = this._elements.adminRejectionReason.value ?? "";
    this._elements.adminRejectionCount.textContent = `${value.length} / 500`;
  }

  _renderReviewStatus() {
    this._elements.adminReviewStatus.textContent = this._state.review.message;
  }
}


let adminReviewInstance = null;


export function subscribeAdminConnection(listener) {
  if (typeof listener !== "function") return () => {};
  adminConnectionListeners.add(listener);
  const connected = Boolean(
    adminReviewInstance?._state?.connectionStatus === "connected" &&
      adminReviewInstance?._state?.adminKey,
  );
  listener({
    connected,
    adminKey: connected ? adminReviewInstance._state.adminKey : null,
  });
  return () => adminConnectionListeners.delete(listener);
}


export function initializeAdminReview(options = {}) {
  if (adminReviewInstance) return adminReviewInstance;
  const review = new AdminReview(options);
  if (!review.initializeAdminReview()) return null;
  adminReviewInstance = review;
  return review;
}


export function destroyAdminReview() {
  if (!adminReviewInstance) return false;
  const destroyed = adminReviewInstance.destroy();
  adminReviewInstance = null;
  return destroyed;
}
