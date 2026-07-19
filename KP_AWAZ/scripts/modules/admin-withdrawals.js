import {
  getAdminWithdrawalRequests,
  resolveAdminWithdrawalRequest,
} from "../services/admin-review-api.js?v=20260719-withdrawals";
import { subscribeAdminConnection } from "./admin-review.js?v=20260719-withdrawals";


const FILTERS = new Set(["requested", "approved", "declined", "all"]);
const AUTH_ERROR_CODES = new Set(["ADMIN_KEY_REQUIRED", "INVALID_ADMIN_KEY"]);
const defaultApi = Object.freeze({
  list: getAdminWithdrawalRequests,
  resolve: resolveAdminWithdrawalRequest,
});


function formatStatus(status) {
  if (status === "approved") return "Exclusion approved";
  if (status === "declined") return "Declined";
  return "Review requested";
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


function isAuthenticationError(error) {
  return [401, 403].includes(error?.status) || AUTH_ERROR_CODES.has(error?.code);
}


export class AdminWithdrawals {
  constructor({
    root = globalThis.document,
    api = defaultApi,
    subscribeConnection = subscribeAdminConnection,
    confirmAction = (message) => globalThis.confirm(message),
    locale = undefined,
  } = {}) {
    this._root = root;
    this._api = api;
    this._subscribeConnection = subscribeConnection;
    this._confirm = confirmAction;
    this._locale = locale;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._adminKey = null;
    this._filter = "requested";
    this._items = [];
    this._total = 0;
    this._generation = 0;
    this._savingId = null;
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
      this._adminKey = state?.connected ? state.adminKey : null;
      this._generation += 1;
      this._savingId = null;
      if (this._adminKey) {
        void this.load();
      } else {
        this._items = [];
        this._total = 0;
        this._message("");
        this._render();
      }
    });
    return true;
  }

  async load() {
    if (!this._initialized || !this._adminKey) return false;
    const key = this._adminKey;
    const filter = this._filter;
    const generation = ++this._generation;
    this._setLoading(true);
    this._message("Loading withdrawal requests…");
    try {
      const page = await this._api.list({
        adminKey: key,
        status: filter,
        limit: 100,
        offset: 0,
      });
      if (!this._isCurrent(generation, key, filter)) return false;
      this._items = [...page.items];
      this._total = page.total;
      this._message("");
      this._render();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, key, filter)) return false;
      this._items = [];
      this._total = 0;
      this._message(
        isAuthenticationError(error)
          ? "The administrator session is no longer valid. Disconnect and reconnect."
          : "We could not load withdrawal requests. Please try again.",
        "error",
      );
      this._render();
      return false;
    } finally {
      if (this._isCurrent(generation, key, filter)) this._setLoading(false);
    }
  }

  async resolve(requestId, status, resolutionReason = "") {
    if (!this._initialized || !this._adminKey || this._savingId) return false;
    const decision = status === "approved" ? "approved" : "declined";
    const reason = typeof resolutionReason === "string" ? resolutionReason.trim() : "";
    if (decision === "declined" && !reason) {
      this._message("Enter a safe internal reason before declining.", "error");
      return false;
    }
    const confirmation = decision === "approved"
      ? "Approve this request and exclude the affected recording data from future exports? Source records will remain for audit."
      : "Decline this withdrawal request?";
    if (!this._confirm(confirmation)) return false;

    const key = this._adminKey;
    const filter = this._filter;
    const generation = ++this._generation;
    this._savingId = requestId;
    this._setLoading(true);
    this._message(decision === "approved" ? "Approving exclusion…" : "Declining request…");
    try {
      await this._api.resolve({
        adminKey: key,
        requestId,
        status: decision,
        resolutionReason: reason,
      });
      if (!this._isCurrent(generation, key, filter)) return false;
      this._savingId = null;
      await this.load();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, key, filter)) return false;
      this._savingId = null;
      this._message(
        isAuthenticationError(error)
          ? "The administrator session is no longer valid. Disconnect and reconnect."
          : "The withdrawal decision could not be saved. Please try again.",
        "error",
      );
      this._render();
      return false;
    } finally {
      if (this._initialized && this._adminKey === key) this._setLoading(false);
    }
  }

  destroy() {
    if (!this._initialized) return false;
    this._initialized = false;
    this._generation += 1;
    this._adminKey = null;
    this._savingId = null;
    this._items = [];
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._elements?.list.replaceChildren();
    return true;
  }

  _resolveElements() {
    const ids = {
      panel: "adminWithdrawalPanel",
      refresh: "adminRefreshWithdrawalsButton",
      status: "adminWithdrawalStatus",
      summary: "adminWithdrawalSummary",
      empty: "adminWithdrawalEmpty",
      list: "adminWithdrawalList",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, this._root?.getElementById?.(id)]),
    );
    if (!Object.values(elements).every(Boolean)) return null;
    elements.filters = [
      ...(this._root?.querySelectorAll?.("[data-withdrawal-filter]") ?? []),
    ];
    return elements.filters.length === FILTERS.size ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.refresh, "click", () => void this.load());
    for (const button of this._elements.filters) {
      this._listen(button, "click", () => {
        const filter = button.getAttribute("data-withdrawal-filter");
        if (!FILTERS.has(filter) || filter === this._filter) return;
        this._filter = filter;
        void this.load();
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

  _setLoading(loading) {
    this._elements.panel.setAttribute("aria-busy", String(loading));
    this._elements.refresh.disabled = loading || !this._adminKey;
    for (const button of this._elements.filters) button.disabled = loading;
  }

  _message(message, tone = "") {
    this._elements.status.textContent = message;
    this._elements.status.dataset.tone = tone;
  }

  _render() {
    if (!this._elements) return;
    for (const button of this._elements.filters) {
      const active = button.getAttribute("data-withdrawal-filter") === this._filter;
      button.classList?.toggle?.("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this._elements.summary.textContent = this._adminKey
      ? `${this._total} request${this._total === 1 ? "" : "s"}`
      : "Connect securely to review requests.";
    this._elements.empty.hidden = !this._adminKey || this._items.length > 0;
    const rows = this._items.map((item) => this._requestCard(item));
    this._elements.list.replaceChildren(...rows);
    this._setLoading(Boolean(this._savingId));
  }

  _requestCard(item) {
    const row = this._root.createElement("li");
    const heading = this._root.createElement("div");
    const title = this._root.createElement("strong");
    const badge = this._root.createElement("span");
    const summary = this._root.createElement("p");
    const meta = this._root.createElement("p");
    const reason = this._root.createElement("p");

    row.className = "admin-withdrawal-card";
    heading.className = "admin-withdrawal-card__heading";
    title.textContent = item.scope === "all"
      ? "All recordings owned at request time"
      : item.contributionSummary || "One owned recording";
    badge.className = "admin-status-badge";
    badge.dataset.status = item.status;
    badge.textContent = formatStatus(item.status);
    heading.append(title, badge);
    summary.textContent = `${item.ownerDisplayName} · ${item.affectedContributionCount} affected recording${item.affectedContributionCount === 1 ? "" : "s"}`;
    meta.className = "admin-withdrawal-card__meta";
    meta.textContent = `Requested ${formatDate(item.requestedAt, this._locale)}`;
    reason.className = "admin-withdrawal-card__reason";
    reason.textContent = item.reason
      ? `Contributor reason: ${item.reason}`
      : "No contributor reason was provided.";
    row.append(heading, summary, meta, reason);

    if (item.status === "requested") {
      const label = this._root.createElement("label");
      const textarea = this._root.createElement("textarea");
      const actions = this._root.createElement("div");
      const approve = this._root.createElement("button");
      const decline = this._root.createElement("button");
      label.textContent = "Internal resolution note";
      textarea.rows = 2;
      textarea.maxLength = 500;
      textarea.placeholder = "Required when declining; never shown publicly.";
      label.append(textarea);
      actions.className = "admin-withdrawal-card__actions";
      approve.type = "button";
      approve.className = "btn btn-success btn-small";
      approve.textContent = "Approve exclusion";
      decline.type = "button";
      decline.className = "btn btn-danger btn-small";
      decline.textContent = "Decline request";
      approve.addEventListener("click", () => {
        void this.resolve(item.id, "approved", textarea.value);
      });
      decline.addEventListener("click", () => {
        void this.resolve(item.id, "declined", textarea.value);
      });
      actions.append(approve, decline);
      row.append(label, actions);
    } else if (item.resolutionReason) {
      const resolution = this._root.createElement("p");
      resolution.className = "admin-withdrawal-card__reason";
      resolution.textContent = `Internal resolution: ${item.resolutionReason}`;
      row.append(resolution);
    }
    return row;
  }
}


let instance = null;


export function initializeAdminWithdrawals(options = {}) {
  if (instance) return instance;
  const withdrawals = new AdminWithdrawals(options);
  if (!withdrawals.initialize()) return null;
  instance = withdrawals;
  return withdrawals;
}


export function destroyAdminWithdrawals() {
  if (!instance) return false;
  const destroyed = instance.destroy();
  instance = null;
  return destroyed;
}
