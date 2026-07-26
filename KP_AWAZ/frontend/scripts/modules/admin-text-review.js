import {
  getAdminTextContribution,
  getAdminTextContributions,
  reviewAdminTextContribution,
} from "../services/admin-review-api.js?v=20260726-text-review";
import { subscribeAdminConnection } from "./admin-review.js";


const PAGE_LIMIT = 20;
const FILTERS = new Set(["pending", "approved", "rejected", "all"]);
const AUTH_ERROR_CODES = new Set(["ADMIN_KEY_REQUIRED", "INVALID_ADMIN_KEY"]);
const defaultApi = Object.freeze({
  list: getAdminTextContributions,
  get: getAdminTextContribution,
  review: reviewAdminTextContribution,
});


function formatStatus(value) {
  if (value === "approved") return "Approved";
  if (value === "rejected") return "Rejected";
  return "Pending";
}


function formatTextType(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "proverb") return "Proverb";
  if (normalized === "phrase") return "Phrase";
  if (normalized === "story_line") return "Story line";
  if (normalized === "file_batch") return "Uploaded text file";
  return "Sentence";
}


function formatDate(value, locale) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "Date unavailable";
  }
}


function formatFileSize(value) {
  if (!Number.isInteger(value) || value < 1) return "Not applicable";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}


function pageRange(items, total, offset) {
  if (!items.length || !total) return "No results";
  return `${offset + 1}–${Math.min(offset + items.length, total)} of ${total}`;
}


function isAuthenticationError(error) {
  return [401, 403].includes(error?.status) || AUTH_ERROR_CODES.has(error?.code);
}


export class AdminTextReview {
  constructor({
    root = globalThis.document,
    api = defaultApi,
    subscribeConnection = subscribeAdminConnection,
    locale = undefined,
  } = {}) {
    this._root = root;
    this._api = api;
    this._subscribeConnection = subscribeConnection;
    this._locale = locale;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._adminKey = null;
    this._filter = "pending";
    this._items = [];
    this._total = 0;
    this._offset = 0;
    this._pendingTotal = 0;
    this._status = "idle";
    this._message = "";
    this._error = "";
    this._selection = { id: null, status: "idle", item: null };
    this._savingId = null;
    this._generation = 0;
    this._detailGeneration = 0;
    this._initialized = false;
  }

  initialize() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;
    this._initialized = true;
    this._bindEvents();
    this._render();
    this._unsubscribe = this._subscribeConnection((state) => {
      if (!this._initialized) return;
      this._generation += 1;
      this._detailGeneration += 1;
      this._adminKey = state?.connected ? state.adminKey : null;
      this._savingId = null;
      this._selection = { id: null, status: "idle", item: null };
      if (this._adminKey) {
        this._filter = "pending";
        this._offset = 0;
        void this.load();
      } else {
        this._clearPrivateState();
        this._render();
      }
    });
    return true;
  }

  getState() {
    return {
      connected: Boolean(this._adminKey),
      filter: this._filter,
      items: this._items.map((item) => ({ ...item })),
      total: this._total,
      offset: this._offset,
      pendingTotal: this._pendingTotal,
      status: this._status,
      selectedId: this._selection.id,
      selectedItem: this._selection.item
        ? { ...this._selection.item }
        : null,
      savingId: this._savingId,
    };
  }

  async load({ offset = this._offset } = {}) {
    if (!this._initialized || !this._adminKey || this._status === "loading") {
      return false;
    }
    const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const key = this._adminKey;
    const filter = this._filter;
    const generation = ++this._generation;
    this._status = "loading";
    this._message = this._items.length
      ? "Refreshing donated text…"
      : "Loading donated text…";
    this._error = "";
    this._render();
    try {
      const page = await this._api.list({
        adminKey: key,
        status: filter,
        limit: PAGE_LIMIT,
        offset: safeOffset,
      });
      if (!this._isCurrent(generation, key, filter)) return false;
      if (page.items.length === 0 && page.total > 0 && safeOffset >= page.total) {
        this._status = "ready";
        return this.load({ offset: Math.max(0, safeOffset - PAGE_LIMIT) });
      }
      this._items = page.items.map((item) => ({ ...item }));
      this._total = page.total;
      this._offset = page.offset;
      if (filter === "pending") this._pendingTotal = page.total;
      this._status = "ready";
      this._message = "";
      this._error = "";
      this._selection = { id: null, status: "idle", item: null };
      this._render();
      if (filter !== "pending") void this._refreshPendingTotal();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, key, filter)) return false;
      this._status = "error";
      this._message = "";
      this._error = isAuthenticationError(error)
        ? "The administrator session is no longer valid. Disconnect and reconnect."
        : "The donated-text queue could not be loaded. Please try again.";
      this._render();
      return false;
    }
  }

  async select(contributionId) {
    const id = typeof contributionId === "string" ? contributionId.trim() : "";
    if (!this._initialized || !this._adminKey || !id || this._savingId) {
      return false;
    }
    if (this._selection.id === id && this._selection.status === "ready") {
      this._selection = { id: null, status: "idle", item: null };
      this._render();
      return true;
    }
    const key = this._adminKey;
    const generation = ++this._detailGeneration;
    this._selection = { id, status: "loading", item: null };
    this._message = "Loading the full text contribution…";
    this._render();
    try {
      const item = await this._api.get({
        adminKey: key,
        contributionId: id,
      });
      if (!this._isDetailCurrent(generation, key, id)) return false;
      this._selection = { id, status: "ready", item: { ...item } };
      this._message = "";
      this._render();
      this._root
        ?.getElementById?.(`adminTextDetail-${id}`)
        ?.focus?.({ preventScroll: true });
      return true;
    } catch (error) {
      if (!this._isDetailCurrent(generation, key, id)) return false;
      this._selection = { id, status: "error", item: null };
      this._message = isAuthenticationError(error)
        ? "The administrator session is no longer valid. Disconnect and reconnect."
        : "The full text contribution could not be loaded. Select Retry.";
      this._render();
      return false;
    }
  }

  async review(contributionId, decision, rejectionReason = "") {
    const id = typeof contributionId === "string" ? contributionId.trim() : "";
    const status = typeof decision === "string" ? decision.trim().toLowerCase() : "";
    const reason =
      typeof rejectionReason === "string" ? rejectionReason.trim() : "";
    if (
      !this._initialized ||
      !this._adminKey ||
      !id ||
      !["approved", "rejected"].includes(status) ||
      this._savingId
    ) {
      return false;
    }
    if (status === "rejected" && !reason) {
      this._message = "Enter a reason before rejecting this text contribution.";
      this._render();
      return false;
    }
    const key = this._adminKey;
    const filter = this._filter;
    const generation = ++this._generation;
    this._savingId = id;
    this._message = status === "approved" ? "Approving donated text…" : "Rejecting donated text…";
    this._render();
    try {
      const item = await this._api.review({
        adminKey: key,
        contributionId: id,
        status,
        rejectionReason: status === "rejected" ? reason : "",
      });
      if (!this._isCurrent(generation, key, filter)) return false;
      this._savingId = null;
      this._message =
        status === "approved"
          ? "Text contribution approved."
          : "Text contribution rejected.";
      this._selection = { id, status: "ready", item: { ...item } };
      this._status = "ready";
      this._replaceReviewedItem(item);
      if (filter === "pending") {
        this._pendingTotal = Math.max(0, this._pendingTotal - 1);
      }
      this._render();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, key, filter)) return false;
      this._savingId = null;
      this._message = isAuthenticationError(error)
        ? "The administrator session is no longer valid. Disconnect and reconnect."
        : "The text review decision could not be saved. Please try again.";
      this._render();
      return false;
    }
  }

  destroy() {
    if (!this._initialized) return false;
    this._initialized = false;
    this._generation += 1;
    this._detailGeneration += 1;
    this._adminKey = null;
    this._clearPrivateState();
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._elements?.list.replaceChildren();
    return true;
  }

  async _refreshPendingTotal() {
    if (!this._initialized || !this._adminKey) return false;
    const key = this._adminKey;
    const filter = this._filter;
    const generation = ++this._generation;
    try {
      const page = await this._api.list({
        adminKey: key,
        status: "pending",
        limit: 1,
        offset: 0,
      });
      if (!this._isCurrent(generation, key, filter)) return false;
      this._pendingTotal = page.total;
      this._renderPendingCount();
      return true;
    } catch {
      return false;
    }
  }

  _replaceReviewedItem(item) {
    const index = this._items.findIndex((entry) => entry.id === item.id);
    if (index < 0) return;
    const belongs = this._filter === "all" || item.reviewStatus === this._filter;
    if (belongs) {
      this._items[index] = { ...item, textContent: null };
      return;
    }
    this._items.splice(index, 1);
    this._total = Math.max(0, this._total - 1);
  }

  _clearPrivateState() {
    this._items = [];
    this._total = 0;
    this._offset = 0;
    this._pendingTotal = 0;
    this._status = "idle";
    this._message = "";
    this._error = "";
    this._selection = { id: null, status: "idle", item: null };
    this._savingId = null;
  }

  _resolveElements() {
    const ids = {
      panel: "adminTextReviewPanel",
      summary: "adminTextReviewSummary",
      refresh: "adminRefreshTextButton",
      pendingCount: "adminTextPendingCount",
      status: "adminTextReviewStatus",
      error: "adminTextReviewError",
      errorMessage: "adminTextReviewErrorMessage",
      retry: "adminRetryTextButton",
      empty: "adminTextReviewEmpty",
      list: "adminTextContributionList",
      previous: "adminPreviousTextPageButton",
      next: "adminNextTextPageButton",
      pagination: "adminTextPaginationStatus",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [
        name,
        this._root?.getElementById?.(id),
      ]),
    );
    if (!Object.values(elements).every(Boolean)) return null;
    elements.filters = [
      ...(this._root?.querySelectorAll?.("[data-admin-text-filter]") ?? []),
    ];
    return elements.filters.length === FILTERS.size ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.refresh, "click", () => {
      void this.load({ offset: 0 });
    });
    this._listen(this._elements.retry, "click", () => {
      void this.load({ offset: this._offset });
    });
    this._listen(this._elements.previous, "click", () => {
      void this.load({ offset: Math.max(0, this._offset - PAGE_LIMIT) });
    });
    this._listen(this._elements.next, "click", () => {
      void this.load({ offset: this._offset + PAGE_LIMIT });
    });
    for (const button of this._elements.filters) {
      this._listen(button, "click", () => {
        const filter = button.getAttribute("data-admin-text-filter");
        if (!FILTERS.has(filter) || filter === this._filter) return;
        this._generation += 1;
        this._detailGeneration += 1;
        this._filter = filter;
        this._offset = 0;
        this._selection = { id: null, status: "idle", item: null };
        this._status = "ready";
        void this.load({ offset: 0 });
      });
    }
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _isCurrent(generation, key, filter) {
    return Boolean(
      this._initialized &&
      generation === this._generation &&
      key === this._adminKey &&
      filter === this._filter,
    );
  }

  _isDetailCurrent(generation, key, id) {
    return Boolean(
      this._initialized &&
      generation === this._detailGeneration &&
      key === this._adminKey &&
      id === this._selection.id,
    );
  }

  _render() {
    if (!this._elements) return;
    const loading = this._status === "loading";
    const error = this._status === "error";
    this._elements.panel.setAttribute(
      "aria-busy",
      String(loading || Boolean(this._savingId)),
    );
    this._elements.summary.textContent = this._adminKey
      ? `${this._total} ${this._filter === "all" ? "" : `${this._filter} `}text contribution${this._total === 1 ? "" : "s"}`
      : "Connect securely to review typed text and uploaded files.";
    this._elements.status.textContent = this._message;
    this._elements.status.setAttribute(
      "data-tone",
      this._message.includes("approved") ? "success" : "",
    );
    this._elements.error.hidden = !error;
    this._elements.errorMessage.textContent = error ? this._error : "";
    this._elements.empty.hidden =
      !this._adminKey || loading || error || this._items.length > 0;
    this._elements.pagination.textContent = pageRange(
      this._items,
      this._total,
      this._offset,
    );
    this._elements.previous.disabled =
      loading || Boolean(this._savingId) || this._offset <= 0;
    this._elements.next.disabled =
      loading ||
      Boolean(this._savingId) ||
      this._offset + this._items.length >= this._total;
    this._elements.refresh.disabled =
      loading || Boolean(this._savingId) || !this._adminKey;
    this._elements.retry.disabled = loading || !this._adminKey;
    for (const button of this._elements.filters) {
      const active = button.getAttribute("data-admin-text-filter") === this._filter;
      button.classList?.toggle?.("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = loading || Boolean(this._savingId);
    }
    this._renderPendingCount();
    this._renderItems();
  }

  _renderPendingCount() {
    this._elements.pendingCount.textContent = `Pending text: ${this._pendingTotal}`;
  }

  _renderItems() {
    const cards = this._items.map((item) => this._createCard(item));
    this._elements.list.replaceChildren(...cards);
  }

  _createCard(item) {
    const card = this._root.createElement("li");
    const heading = this._root.createElement("div");
    const titleWrap = this._root.createElement("div");
    const source = this._root.createElement("span");
    const title = this._root.createElement("strong");
    const badge = this._root.createElement("span");
    const preview = this._root.createElement("p");
    const meta = this._root.createElement("p");
    const open = this._root.createElement("button");

    card.className = "admin-text-card";
    heading.className = "admin-text-card__heading";
    source.className = "admin-text-source";
    source.textContent = item.submissionMethod === "file" ? "File" : "Typed";
    title.textContent = formatTextType(item.textType);
    titleWrap.append(source, title);
    badge.className = "admin-status-badge";
    badge.setAttribute("data-status", item.reviewStatus);
    badge.textContent = formatStatus(item.reviewStatus);
    heading.append(titleWrap, badge);

    preview.className = "admin-text-card__preview";
    preview.textContent = item.textPreview;
    preview.setAttribute("dir", "auto");
    if (item.language.toLowerCase() === "pashto") preview.setAttribute("lang", "ps");
    meta.className = "admin-text-card__meta";
    meta.textContent = [
      item.language,
      item.originalFilename || "Manual entry",
      formatDate(item.createdAt, this._locale),
      item.ownerDisplayName || (item.hasOwner ? "Owned contribution" : "Legacy contribution"),
    ].join(" · ");
    open.type = "button";
    open.className = "btn btn-secondary btn-small admin-text-card__open";
    open.setAttribute(
      "aria-expanded",
      String(this._selection.id === item.id),
    );
    open.textContent =
      this._selection.id === item.id &&
      this._selection.status === "ready"
        ? "Close review"
        : "Review text";
    open.addEventListener("click", () => void this.select(item.id));
    card.append(heading, preview, meta, open);

    if (this._selection.id === item.id) {
      card.append(this._createDetail(item));
    }
    return card;
  }

  _createDetail(summary) {
    const panel = this._root.createElement("section");
    panel.className = "admin-text-detail";
    panel.setAttribute("id", `adminTextDetail-${summary.id}`);
    panel.setAttribute("tabindex", "-1");
    panel.setAttribute("aria-label", "Full donated text review");
    if (this._selection.status === "loading") {
      const loading = this._root.createElement("p");
      loading.className = "admin-status";
      loading.textContent = "Loading full text…";
      panel.append(loading);
      return panel;
    }
    if (this._selection.status === "error") {
      const error = this._root.createElement("p");
      const retry = this._root.createElement("button");
      error.className = "admin-status";
      error.textContent = "The full text could not be loaded.";
      retry.type = "button";
      retry.className = "btn btn-secondary btn-small";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => void this.select(summary.id));
      panel.append(error, retry);
      return panel;
    }
    const item = this._selection.item;
    if (!item) return panel;
    const contentLabel = this._root.createElement("h3");
    const content = this._root.createElement("pre");
    const metadata = this._root.createElement("dl");
    contentLabel.textContent =
      item.submissionMethod === "file" ? "Uploaded file content" : "Submitted text";
    content.textContent = item.textContent || "";
    content.setAttribute("dir", "auto");
    if (item.language.toLowerCase() === "pashto") content.setAttribute("lang", "ps");
    metadata.className = "admin-text-metadata";
    const fields = [
      ["Type", formatTextType(item.textType)],
      ["Source", item.submissionMethod === "file" ? "Uploaded file" : "Typed entry"],
      ["Characters", String(item.contentLength)],
      ["Filename", item.originalFilename || "Not applicable"],
      ["File type", item.mimeType || "Not applicable"],
      ["File size", formatFileSize(item.fileSize)],
      ["Review status", formatStatus(item.reviewStatus)],
      ["Reviewed", item.reviewedAt ? formatDate(item.reviewedAt, this._locale) : "Not yet"],
    ];
    for (const [label, value] of fields) {
      const wrapper = this._root.createElement("div");
      const term = this._root.createElement("dt");
      const description = this._root.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      wrapper.append(term, description);
      metadata.append(wrapper);
    }
    const form = this._root.createElement("form");
    const label = this._root.createElement("label");
    const reason = this._root.createElement("textarea");
    const help = this._root.createElement("small");
    const actions = this._root.createElement("div");
    const approve = this._root.createElement("button");
    const reject = this._root.createElement("button");
    form.className = "admin-text-review-form";
    form.addEventListener("submit", (event) => event.preventDefault?.());
    label.textContent = "Rejection reason";
    reason.rows = 3;
    reason.maxLength = 500;
    reason.value = item.rejectionReason || "";
    reason.placeholder = "Required when rejecting; explain what needs correction.";
    help.textContent = "Approving clears any earlier rejection reason.";
    label.append(reason, help);
    actions.className = "admin-review__actions";
    approve.type = "button";
    approve.className = "btn btn-success";
    approve.textContent = item.reviewStatus === "rejected" ? "Approve correction" : "Approve text";
    reject.type = "button";
    reject.className = "btn btn-danger";
    reject.textContent = item.reviewStatus === "approved" ? "Change to rejected" : "Reject text";
    const saving = this._savingId === item.id;
    approve.disabled = saving;
    reject.disabled = saving;
    reason.disabled = saving;
    approve.addEventListener("click", () =>
      void this.review(item.id, "approved"),
    );
    reject.addEventListener("click", () =>
      void this.review(item.id, "rejected", reason.value),
    );
    actions.append(approve, reject);
    form.append(label, actions);
    panel.append(contentLabel, content, metadata, form);
    return panel;
  }
}


let instance = null;


export function initializeAdminTextReview(options = {}) {
  if (instance) return instance;
  const review = new AdminTextReview(options);
  if (!review.initialize()) return null;
  instance = review;
  return review;
}


export function destroyAdminTextReview() {
  if (!instance) return false;
  const destroyed = instance.destroy();
  instance = null;
  return destroyed;
}
