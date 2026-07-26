import { getMyContributions } from "../services/contributions-api.js?v=20260719-withdrawals";
import {
  createMyWithdrawalRequest,
  listMyWithdrawalRequests,
} from "../services/withdrawals-api.js?v=20260719-withdrawals";
import { getCurrentAuthState } from "../services/auth-service.js?v=20260723-auth-config-v2";


const defaultApi = Object.freeze({
  createRequest: createMyWithdrawalRequest,
  getContributions: getMyContributions,
  listRequests: listMyWithdrawalRequests,
});


export function formatWithdrawalRequestStatus(status) {
  if (status === "approved") return "Approved for exclusion";
  if (status === "declined") return "Declined";
  return "Administrator review required";
}


export function formatWithdrawalContributionChoice(item, locale = undefined) {
  const kind = item?.contributionType === "open_recording"
    ? "Open recording"
    : "Guided recording";
  const prompt = typeof item?.sentenceText === "string" && item.sentenceText.trim()
    ? item.sentenceText.trim()
    : typeof item?.topic === "string" && item.topic.trim()
      ? item.topic.trim()
      : item?.originalFilename || "Voice recording";
  const shortened = prompt.length > 52 ? `${prompt.slice(0, 49)}…` : prompt;
  const date = new Date(item?.createdAt);
  let dateLabel = "date unavailable";
  if (!Number.isNaN(date.getTime())) {
    try {
      dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
    } catch {
      dateLabel = "date unavailable";
    }
  }
  return `${kind} · ${shortened} · ${dateLabel}`;
}


export class WithdrawalSettings {
  constructor({
    root = globalThis.document,
    api = defaultApi,
    confirmAction = (message) => globalThis.confirm(message),
    authApi = { getCurrentAuthState },
    locale = undefined,
  } = {}) {
    this._root = root;
    this._api = api;
    this._confirm = confirmAction;
    this._auth = authApi;
    this._locale = locale;
    this._elements = null;
    this._bindings = [];
    this._expectedUserId = "";
    this._generation = 0;
    this._initialized = false;
    this._contributions = [];
    this._requests = [];
  }

  initialize({ expectedUserId }) {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements || !expectedUserId) return false;
    this._initialized = true;
    this._expectedUserId = expectedUserId;
    this._bindEvents();
    void this.refresh();
    return true;
  }

  async refresh({ preserveMessage = false } = {}) {
    if (!this._initialized) return false;
    const generation = ++this._generation;
    this._setLoading(true);
    try {
      const [history, requests] = await Promise.all([
        this._loadAllOwnedContributions(),
        this._api.listRequests(),
      ]);
      if (!this._isCurrent(generation)) return false;
      this._contributions = [...history];
      this._requests = [...requests.items];
      this._render();
      if (!preserveMessage) this._message("", "");
      return true;
    } catch {
      if (!this._isCurrent(generation)) return false;
      this._message(
        "We could not load your withdrawal information. Please try again.",
        "error",
      );
      return false;
    } finally {
      if (this._isCurrent(generation)) this._setLoading(false);
    }
  }

  async _submit(scope) {
    if (!this._initialized || this._elements.submitOne.disabled) return false;
    const contributionId = this._elements.contribution.value;
    if (scope === "contribution" && !contributionId) {
      this._message("Choose one recording first.", "error");
      return false;
    }
    const confirmation = scope === "all"
      ? "Request withdrawal for all recordings you currently own? Audio will not be deleted immediately and an administrator must review the request."
      : "Request withdrawal for this recording? Audio will not be deleted immediately and an administrator must review the request.";
    if (!this._confirm(confirmation)) return false;

    const generation = ++this._generation;
    this._setLoading(true);
    try {
      await this._api.createRequest({
        scope,
        contributionId: scope === "contribution" ? contributionId : undefined,
        reason: this._elements.reason.value,
      });
      if (!this._isCurrent(generation)) return false;
      this._elements.reason.value = "";
      this._message(
        "Withdrawal request received. It is waiting for administrator review.",
        "success",
      );
      await this.refresh({ preserveMessage: true });
      return true;
    } catch (error) {
      if (!this._isCurrent(generation)) return false;
      const duplicate = error?.code === "WITHDRAWAL_REQUEST_ALREADY_ACTIVE";
      this._message(
        duplicate
          ? "A withdrawal request is already active for this selection."
          : "We could not create the withdrawal request. Please try again.",
        "error",
      );
      return false;
    } finally {
      if (this._initialized) this._setLoading(false);
    }
  }

  async _loadAllOwnedContributions() {
    const items = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await this._api.getContributions({ limit: 100, offset });
      total = page.total;
      if (!page.items.length) break;
      items.push(...page.items);
      offset += page.items.length;
    } while (items.length < total);
    return items;
  }

  destroy() {
    if (!this._initialized) return;
    this._initialized = false;
    this._generation += 1;
    this._expectedUserId = "";
    this._contributions = [];
    this._requests = [];
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    if (this._elements) {
      this._elements.reason.value = "";
      this._elements.contribution.replaceChildren();
      this._elements.requests.replaceChildren();
    }
  }

  _resolveElements() {
    const ids = {
      section: "withdrawalSettingsSection",
      contribution: "withdrawalContributionSelect",
      reason: "withdrawalReason",
      submitOne: "requestOneWithdrawalButton",
      submitAll: "requestAllWithdrawalButton",
      refresh: "refreshWithdrawalStatusButton",
      status: "withdrawalSettingsStatus",
      requests: "withdrawalRequestList",
      empty: "withdrawalRequestEmpty",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([key, id]) => [key, this._root.getElementById(id)]),
    );
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.submitOne, "click", () => {
      void this._submit("contribution");
    });
    this._listen(this._elements.submitAll, "click", () => {
      void this._submit("all");
    });
    this._listen(this._elements.refresh, "click", () => void this.refresh());
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _isCurrent(generation) {
    return Boolean(
      this._initialized &&
      generation === this._generation &&
      this._auth.getCurrentAuthState().backendUser?.id === this._expectedUserId
    );
  }

  _setLoading(loading) {
    this._elements.section.setAttribute("aria-busy", String(loading));
    this._elements.submitOne.disabled = loading || this._contributions.length === 0;
    this._elements.submitAll.disabled = loading || this._contributions.length === 0;
    this._elements.refresh.disabled = loading;
    this._elements.contribution.disabled = loading || this._contributions.length === 0;
  }

  _message(value, tone) {
    this._elements.status.textContent = value;
    this._elements.status.dataset.tone = tone;
    this._elements.status.hidden = !value;
  }

  _render() {
    const options = this._contributions.map((item) => {
      const option = this._root.createElement("option");
      option.value = item.id;
      option.textContent = formatWithdrawalContributionChoice(item, this._locale);
      return option;
    });
    const placeholder = this._root.createElement("option");
    placeholder.value = "";
    placeholder.textContent = options.length
      ? "Choose one of your recordings"
      : "No recordings are available";
    this._elements.contribution.replaceChildren(placeholder, ...options);

    const contributionLabels = new Map(
      this._contributions.map((item) => [
        item.id,
        formatWithdrawalContributionChoice(item, this._locale),
      ]),
    );
    const requestRows = this._requests.map((request) => {
      const item = this._root.createElement("li");
      const heading = this._root.createElement("strong");
      heading.textContent = request.scope === "all"
        ? "All recordings owned at request time"
        : contributionLabels.get(request.contributionId) || "One owned recording";
      const status = this._root.createElement("span");
      status.dataset.status = request.status;
      status.textContent = formatWithdrawalRequestStatus(request.status);
      const date = this._root.createElement("small");
      date.textContent = `Requested ${new Intl.DateTimeFormat(this._locale, {
        dateStyle: "medium",
      }).format(new Date(request.requestedAt))}`;
      item.append(heading, status, date);
      return item;
    });
    this._elements.requests.replaceChildren(...requestRows);
    this._elements.empty.hidden = requestRows.length > 0;
    this._setLoading(false);
  }
}
