import {
  exportAdminPhrases,
  importAdminPhrases,
  listAdminPhrases,
  updateAdminPhrase,
} from "../services/admin-phrases-api.js";
import { subscribeAdminConnection } from "./admin-review.js";

const PAGE_LIMIT = 20;
const AUTH_ERROR_CODES = new Set(["ADMIN_KEY_REQUIRED", "INVALID_ADMIN_KEY"]);
const defaultApi = Object.freeze({
  list: listAdminPhrases,
  import: importAdminPhrases,
  update: updateAdminPhrase,
  export: exportAdminPhrases,
});


function isAuthenticationError(error) {
  return [401, 403].includes(error?.status) || AUTH_ERROR_CODES.has(error?.code);
}


function safeMessage(scope) {
  if (scope === "import") {
    return "The phrase file could not be imported. Check the format and try again.";
  }
  if (scope === "update") {
    return "The phrase change could not be saved. Please try again.";
  }
  if (scope === "export") {
    return "The phrase export could not be prepared. Please try again.";
  }
  return "We could not load the phrase collection. Please try again.";
}


function formatDate(value, locale) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  } catch {
    return "Date unavailable";
  }
}


function pageRange({ items, total, offset }) {
  if (!items.length || !total) return "No results";
  return `${offset + 1}–${Math.min(offset + items.length, total)} of ${total}`;
}


function nullableValue(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}


function selectedActiveFilter(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}


export function downloadPhraseExport(
  document,
  {
    root = globalThis.document,
    urlApi = globalThis.URL,
  } = {},
) {
  if (!(document?.blob instanceof Blob) || typeof document?.filename !== "string") {
    return false;
  }
  const link = root?.createElement?.("a");
  if (!link || typeof urlApi?.createObjectURL !== "function") return false;
  const url = urlApi.createObjectURL(document.blob);
  try {
    link.href = url;
    link.download = document.filename;
    link.hidden = true;
    root.body?.append?.(link);
    link.click?.();
    link.remove?.();
    return true;
  } finally {
    urlApi.revokeObjectURL?.(url);
  }
}


export class AdminPhrases {
  constructor({
    root = globalThis.document,
    api = defaultApi,
    subscribeConnection = subscribeAdminConnection,
    confirmAction = (message) => globalThis.confirm(message),
    download = (document) => downloadPhraseExport(document, { root }),
    locale = undefined,
  } = {}) {
    this._root = root;
    this._api = api;
    this._subscribeConnection = subscribeConnection;
    this._confirm = confirmAction;
    this._download = download;
    this._locale = locale;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._adminKey = null;
    this._view = "review";
    this._items = [];
    this._total = 0;
    this._offset = 0;
    this._counts = { total: 0, active: 0, inactive: 0 };
    this._filters = { search: "", language: "", active: undefined };
    this._status = "idle";
    this._errorMessage = "";
    this._messageText = "";
    this._savingId = null;
    this._editingId = null;
    this._importing = false;
    this._exporting = false;
    this._loaded = false;
    this._generation = 0;
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
      this._importing = false;
      this._exporting = false;
      if (!this._adminKey) {
        this._clearPrivateState();
        this._render();
      } else if (this._view === "phrases") {
        void this.load({ offset: 0, refreshCounts: true });
      }
    });
    return true;
  }

  getState() {
    return {
      connected: Boolean(this._adminKey),
      view: this._view,
      items: this._items.map((item) => ({ ...item })),
      total: this._total,
      offset: this._offset,
      counts: { ...this._counts },
      filters: { ...this._filters },
      status: this._status,
      hasAdminKey: Boolean(this._adminKey),
      importing: this._importing,
      exporting: this._exporting,
      editingId: this._editingId,
    };
  }

  openSection(section) {
    if (!this._initialized) return false;
    const next = section === "phrases" ? "phrases" : "review";
    this._view = next;
    this._renderSection();
    if (next === "phrases" && this._adminKey && !this._loaded) {
      void this.load({ offset: 0, refreshCounts: true });
    }
    return true;
  }

  async load({ offset = this._offset, refreshCounts = false } = {}) {
    if (!this._initialized || !this._adminKey || this._status === "loading") {
      return false;
    }
    const key = this._adminKey;
    const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const generation = ++this._generation;
    this._status = "loading";
    this._errorMessage = "";
    this._messageText = this._loaded ? "Refreshing phrases…" : "Loading phrases…";
    this._render();
    try {
      const listRequest = this._api.list({
        adminKey: key,
        limit: PAGE_LIMIT,
        offset: safeOffset,
        ...this._filters,
        order: "newest",
      });
      const requests = [listRequest];
      if (refreshCounts) {
        requests.push(
          this._api.list({ adminKey: key, limit: 1, offset: 0, order: "newest" }),
          this._api.list({ adminKey: key, limit: 1, offset: 0, active: true, order: "newest" }),
          this._api.list({ adminKey: key, limit: 1, offset: 0, active: false, order: "newest" }),
        );
      }
      const [page, totalPage, activePage, inactivePage] = await Promise.all(requests);
      if (!this._isCurrent(generation, key)) return false;
      this._items = page.items.map((item) => ({ ...item }));
      this._total = page.total;
      this._offset = page.offset;
      if (refreshCounts) {
        this._counts = {
          total: totalPage.total,
          active: activePage.total,
          inactive: inactivePage.total,
        };
      }
      this._status = "ready";
      this._loaded = true;
      this._messageText = "";
      this._render();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, key)) return false;
      this._status = "error";
      this._errorMessage = isAuthenticationError(error)
        ? "The administrator session is no longer valid. Disconnect and reconnect."
        : safeMessage("list");
      this._messageText = "";
      this._render();
      return false;
    }
  }

  async importSelectedFile() {
    if (
      !this._initialized ||
      !this._adminKey ||
      this._importing ||
      this._status === "loading"
    ) return false;
    const file = this._elements.fileInput.files?.[0];
    this._elements.fileInput.setCustomValidity?.(
      file ? "" : "Choose a CSV, JSON, or TXT phrase file.",
    );
    if (!file) {
      this._elements.fileInput.reportValidity?.();
      this._setImportMessage("Choose a CSV, JSON, or TXT phrase file.", "error");
      return false;
    }
    const key = this._adminKey;
    const generation = ++this._generation;
    this._importing = true;
    this._elements.importSummary.hidden = true;
    this._setImportMessage("Importing phrases…");
    this._renderControls();
    try {
      const summary = await this._api.import({ adminKey: key, file });
      if (!this._isCurrent(generation, key)) return false;
      this._renderImportSummary(summary);
      this._elements.fileInput.value = "";
      this._setImportMessage(
        `${summary.created} phrase${summary.created === 1 ? "" : "s"} added to the collection.`,
        "success",
      );
      this._importing = false;
      await this.load({ offset: 0, refreshCounts: true });
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, key)) return false;
      this._importing = false;
      this._setImportMessage(
        isAuthenticationError(error)
          ? "The administrator session is no longer valid. Disconnect and reconnect."
          : safeMessage("import"),
        "error",
      );
      this._renderControls();
      return false;
    }
  }

  async togglePhrase(phraseId) {
    const phrase = this._items.find((item) => item.id === phraseId);
    if (
      !phrase ||
      !this._adminKey ||
      this._savingId ||
      this._status === "loading"
    ) return false;
    const nextActive = !phrase.active;
    if (
      !nextActive &&
      !this._confirm(
        "Disable this phrase? It will no longer be assigned to new contributors.",
      )
    ) {
      return false;
    }
    const key = this._adminKey;
    const generation = ++this._generation;
    this._savingId = phrase.id;
    this._messageText = nextActive ? "Enabling phrase…" : "Disabling phrase…";
    this._render();
    try {
      await this._api.update({
        adminKey: key,
        phraseId: phrase.id,
        updates: { active: nextActive },
      });
      if (!this._isCurrent(generation, key)) return false;
      this._savingId = null;
      await this.load({ offset: this._offset, refreshCounts: true });
      this._messageText = nextActive
        ? "Phrase enabled. It can now be assigned to contributors."
        : "Phrase disabled. It will not be assigned to new contributors.";
      this._renderListState();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, key)) return false;
      this._savingId = null;
      this._messageText = isAuthenticationError(error)
        ? "The administrator session is no longer valid. Disconnect and reconnect."
        : safeMessage("update");
      this._render();
      return false;
    }
  }

  startEdit(phraseId) {
    const phrase = this._items.find((item) => item.id === phraseId);
    if (!phrase || !this._adminKey || this._status === "loading") return false;
    this._editingId = phrase.id;
    this._elements.editText.value = phrase.text;
    this._elements.editLanguage.value = phrase.language;
    this._elements.editCategory.value = phrase.category ?? "";
    this._elements.editDialect.value = phrase.dialect ?? "";
    this._elements.editSource.value = phrase.source ?? "";
    this._elements.editDifficulty.value = phrase.difficulty ?? "";
    this._elements.editStatus.textContent = "";
    this._elements.editDialog.hidden = false;
    try {
      this._elements.editDialog.showModal?.();
    } catch {
      this._elements.editDialog.hidden = false;
    }
    this._elements.editText.focus?.();
    return true;
  }

  closeEditor() {
    this._editingId = null;
    this._elements.editStatus.textContent = "";
    try {
      this._elements.editDialog.close?.();
    } catch {
      // The fallback hidden state below also works when dialog APIs are unavailable.
    }
    this._elements.editDialog.hidden = true;
  }

  async saveEdit() {
    if (!this._editingId || !this._adminKey || this._savingId) return false;
    const text = this._elements.editText.value.trim();
    const language = this._elements.editLanguage.value.trim();
    this._elements.editText.setCustomValidity?.(
      text.length >= 3 && text.length <= 500
        ? ""
        : "Enter a phrase between 3 and 500 characters.",
    );
    this._elements.editLanguage.setCustomValidity?.(
      language ? "" : "Enter the phrase language.",
    );
    if (!text || text.length < 3 || text.length > 500 || !language) {
      this._elements.editForm.reportValidity?.();
      this._elements.editStatus.textContent =
        "Enter valid phrase text and language before saving.";
      return false;
    }
    const key = this._adminKey;
    const phraseId = this._editingId;
    const generation = ++this._generation;
    this._savingId = phraseId;
    this._elements.editStatus.textContent = "Saving phrase…";
    this._renderControls();
    try {
      await this._api.update({
        adminKey: key,
        phraseId,
        updates: {
          text,
          language,
          category: nullableValue(this._elements.editCategory.value),
          dialect: nullableValue(this._elements.editDialect.value),
          source: nullableValue(this._elements.editSource.value),
          difficulty: nullableValue(this._elements.editDifficulty.value),
        },
      });
      if (!this._isCurrent(generation, key)) return false;
      this._savingId = null;
      this.closeEditor();
      await this.load({ offset: this._offset, refreshCounts: false });
      this._messageText = "Phrase updated. Historical recording snapshots were preserved.";
      this._renderListState();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, key)) return false;
      this._savingId = null;
      this._elements.editStatus.textContent = isAuthenticationError(error)
        ? "The administrator session is no longer valid. Disconnect and reconnect."
        : safeMessage("update");
      this._renderControls();
      return false;
    }
  }

  async exportCollection(format, activeOnly) {
    if (!this._adminKey || this._exporting || this._status === "loading") return false;
    const key = this._adminKey;
    const generation = ++this._generation;
    this._exporting = true;
    this._setExportMessage("Preparing the protected export…");
    this._renderControls();
    try {
      const document = await this._api.export({ adminKey: key, format, activeOnly });
      if (!this._isCurrent(generation, key)) return false;
      if (!this._download(document)) throw new Error("Download unavailable");
      this._setExportMessage("Phrase export is ready.", "success");
      this._exporting = false;
      this._renderControls();
      return true;
    } catch (error) {
      if (!this._isCurrent(generation, key)) return false;
      this._exporting = false;
      this._setExportMessage(
        isAuthenticationError(error)
          ? "The administrator session is no longer valid. Disconnect and reconnect."
          : safeMessage("export"),
        "error",
      );
      this._renderControls();
      return false;
    }
  }

  destroy() {
    if (!this._initialized) return false;
    this._initialized = false;
    this._generation += 1;
    this._adminKey = null;
    this._clearPrivateState();
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._elements?.tableBody.replaceChildren();
    return true;
  }

  _resolveElements() {
    const ids = {
      reviewButton: "adminReviewSectionButton",
      phraseButton: "adminPhraseSectionButton",
      reviewWorkspace: "adminReviewWorkspace",
      panel: "adminPhrasePanel",
      refresh: "adminRefreshPhrasesButton",
      totalCount: "adminPhraseTotalCount",
      activeCount: "adminPhraseActiveCount",
      inactiveCount: "adminPhraseInactiveCount",
      importForm: "adminPhraseImportForm",
      fileInput: "adminPhraseFileInput",
      importButton: "adminPhraseImportButton",
      importStatus: "adminPhraseImportStatus",
      importSummary: "adminPhraseImportSummary",
      importReceived: "adminPhraseImportReceived",
      importCreated: "adminPhraseImportCreated",
      importDuplicates: "adminPhraseImportDuplicates",
      importInvalid: "adminPhraseImportInvalid",
      exportStatus: "adminPhraseExportStatus",
      filterForm: "adminPhraseFilterForm",
      searchInput: "adminPhraseSearchInput",
      languageInput: "adminPhraseLanguageInput",
      activeFilter: "adminPhraseActiveFilter",
      applyFilters: "adminApplyPhraseFiltersButton",
      status: "adminPhraseStatus",
      error: "adminPhraseError",
      errorMessage: "adminPhraseErrorMessage",
      retry: "adminRetryPhrasesButton",
      empty: "adminPhraseEmpty",
      tableWrapper: "adminPhraseTableWrapper",
      tableBody: "adminPhraseTableBody",
      previous: "adminPreviousPhrasePageButton",
      next: "adminNextPhrasePageButton",
      pagination: "adminPhrasePaginationStatus",
      editDialog: "adminPhraseEditDialog",
      editForm: "adminPhraseEditForm",
      editText: "adminPhraseEditText",
      editLanguage: "adminPhraseEditLanguage",
      editCategory: "adminPhraseEditCategory",
      editDialect: "adminPhraseEditDialect",
      editSource: "adminPhraseEditSource",
      editDifficulty: "adminPhraseEditDifficulty",
      saveEdit: "adminSavePhraseButton",
      cancelEdit: "adminCancelPhraseEditButton",
      cancelEditAction: "adminCancelPhraseEditAction",
      editStatus: "adminPhraseEditStatus",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, this._root?.getElementById?.(id)]),
    );
    if (!Object.values(elements).every(Boolean)) return null;
    elements.exportButtons = [
      ...(this._root?.querySelectorAll?.("[data-phrase-export]") ?? []),
    ];
    return elements.exportButtons.length === 4 ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.reviewButton, "click", () => this.openSection("review"));
    this._listen(this._elements.phraseButton, "click", () => this.openSection("phrases"));
    this._listen(this._elements.refresh, "click", () => {
      void this.load({ offset: this._offset, refreshCounts: true });
    });
    this._listen(this._elements.retry, "click", () => {
      void this.load({ offset: this._offset, refreshCounts: true });
    });
    this._listen(this._elements.filterForm, "submit", (event) => {
      event.preventDefault?.();
      this._filters = {
        search: this._elements.searchInput.value.trim(),
        language: this._elements.languageInput.value.trim(),
        active: selectedActiveFilter(this._elements.activeFilter.value),
      };
      void this.load({ offset: 0, refreshCounts: false });
    });
    this._listen(this._elements.importForm, "submit", (event) => {
      event.preventDefault?.();
      void this.importSelectedFile();
    });
    this._listen(this._elements.previous, "click", () => {
      void this.load({
        offset: Math.max(0, this._offset - PAGE_LIMIT),
        refreshCounts: false,
      });
    });
    this._listen(this._elements.next, "click", () => {
      void this.load({ offset: this._offset + PAGE_LIMIT, refreshCounts: false });
    });
    for (const button of this._elements.exportButtons) {
      this._listen(button, "click", () => {
        const [format, scope] = button.getAttribute("data-phrase-export").split("-");
        void this.exportCollection(format, scope === "active");
      });
    }
    this._listen(this._elements.editForm, "submit", (event) => {
      event.preventDefault?.();
      void this.saveEdit();
    });
    this._listen(this._elements.cancelEdit, "click", () => this.closeEditor());
    this._listen(this._elements.cancelEditAction, "click", () => this.closeEditor());
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _isCurrent(generation, key) {
    return Boolean(
      this._initialized && generation === this._generation && key === this._adminKey,
    );
  }

  _clearPrivateState() {
    this._items = [];
    this._total = 0;
    this._offset = 0;
    this._counts = { total: 0, active: 0, inactive: 0 };
    this._status = "idle";
    this._errorMessage = "";
    this._messageText = "";
    this._loaded = false;
    this.closeEditor?.();
    if (this._elements?.fileInput) this._elements.fileInput.value = "";
    if (this._elements?.importSummary) this._elements.importSummary.hidden = true;
  }

  _render() {
    if (!this._elements) return;
    this._renderSection();
    this._renderCounts();
    this._renderListState();
    this._renderRows();
    this._renderControls();
  }

  _renderSection() {
    const phrases = this._view === "phrases";
    this._elements.reviewWorkspace.hidden = phrases;
    this._elements.panel.hidden = !phrases;
    this._elements.reviewButton.classList?.toggle?.("is-active", !phrases);
    this._elements.phraseButton.classList?.toggle?.("is-active", phrases);
    this._elements.reviewButton.setAttribute("aria-selected", String(!phrases));
    this._elements.phraseButton.setAttribute("aria-selected", String(phrases));
  }

  _renderCounts() {
    this._elements.totalCount.textContent = String(this._counts.total);
    this._elements.activeCount.textContent = String(this._counts.active);
    this._elements.inactiveCount.textContent = String(this._counts.inactive);
  }

  _renderListState() {
    const loading = this._status === "loading";
    const error = this._status === "error";
    this._elements.status.textContent = loading ? this._messageText : this._messageText;
    this._elements.status.dataset.tone = error ? "error" : "";
    this._elements.error.hidden = !error;
    this._elements.errorMessage.textContent = error ? this._errorMessage : "";
    this._elements.empty.hidden =
      loading || error || this._status === "idle" || this._items.length > 0;
    this._elements.tableWrapper.hidden = this._items.length === 0;
    this._elements.pagination.textContent = pageRange({
      items: this._items,
      total: this._total,
      offset: this._offset,
    });
    this._elements.previous.disabled = loading || this._offset === 0;
    this._elements.next.disabled =
      loading || this._offset + this._items.length >= this._total;
  }

  _renderRows() {
    const rows = this._items.map((phrase) => {
      const row = this._root.createElement("tr");
      const textCell = this._root.createElement("td");
      const text = this._root.createElement("span");
      const language = this._root.createElement("td");
      const category = this._root.createElement("td");
      const status = this._root.createElement("td");
      const badge = this._root.createElement("span");
      const usage = this._root.createElement("td");
      const created = this._root.createElement("td");
      const actions = this._root.createElement("td");
      const actionGroup = this._root.createElement("div");
      const toggle = this._root.createElement("button");
      const edit = this._root.createElement("button");

      text.className = "admin-phrase-text";
      text.textContent = phrase.text;
      text.setAttribute("dir", "auto");
      if (phrase.language.toLowerCase() === "pashto") {
        text.setAttribute("lang", "ps");
        text.setAttribute("dir", "rtl");
      }
      textCell.append(text);
      language.textContent = phrase.language;
      category.textContent = phrase.category || "—";
      badge.className = "admin-status-badge";
      badge.dataset.status = phrase.active ? "approved" : "rejected";
      badge.textContent = phrase.active ? "Active" : "Inactive";
      status.append(badge);
      usage.textContent = String(phrase.timesAssigned);
      usage.title = `${phrase.recordingsSubmitted} recording${phrase.recordingsSubmitted === 1 ? "" : "s"} submitted`;
      created.textContent = formatDate(phrase.createdAt, this._locale);
      actionGroup.className = "admin-phrase-row-actions";
      toggle.type = "button";
      toggle.className = phrase.active
        ? "btn btn-danger btn-small"
        : "btn btn-success btn-small";
      toggle.textContent = phrase.active ? "Disable" : "Enable";
      toggle.disabled = Boolean(this._savingId) || this._status === "loading";
      toggle.addEventListener("click", () => void this.togglePhrase(phrase.id));
      edit.type = "button";
      edit.className = "btn btn-secondary btn-small";
      edit.textContent = "Edit";
      edit.disabled = Boolean(this._savingId) || this._status === "loading";
      edit.addEventListener("click", () => this.startEdit(phrase.id));
      actionGroup.append(toggle, edit);
      actions.append(actionGroup);
      row.append(textCell, language, category, status, usage, created, actions);
      return row;
    });
    this._elements.tableBody.replaceChildren(...rows);
  }

  _renderControls() {
    const loading = this._status === "loading";
    this._elements.panel.setAttribute(
      "aria-busy",
      String(loading || this._importing || this._exporting || Boolean(this._savingId)),
    );
    this._elements.refresh.disabled = loading || !this._adminKey;
    this._elements.retry.disabled = loading || !this._adminKey;
    this._elements.applyFilters.disabled = loading || !this._adminKey;
    this._elements.importButton.disabled =
      loading || this._importing || !this._adminKey;
    this._elements.fileInput.disabled = loading || this._importing || !this._adminKey;
    this._elements.importButton.textContent = this._importing
      ? "Importing…"
      : "Import phrases";
    for (const button of this._elements.exportButtons) {
      button.disabled = loading || this._exporting || !this._adminKey;
    }
    this._elements.saveEdit.disabled = Boolean(this._savingId);
    this._elements.saveEdit.textContent = this._savingId === this._editingId
      ? "Saving…"
      : "Save phrase";
  }

  _renderImportSummary(summary) {
    this._elements.importReceived.textContent = String(summary.received);
    this._elements.importCreated.textContent = String(summary.created);
    this._elements.importDuplicates.textContent = String(summary.duplicates);
    this._elements.importInvalid.textContent = String(summary.invalid);
    this._elements.importSummary.hidden = false;
  }

  _setImportMessage(message, tone = "") {
    this._elements.importStatus.textContent = message;
    this._elements.importStatus.dataset.tone = tone;
  }

  _setExportMessage(message, tone = "") {
    this._elements.exportStatus.textContent = message;
    this._elements.exportStatus.dataset.tone = tone;
  }
}


let instance = null;


export function initializeAdminPhrases(options = {}) {
  if (instance) return instance;
  const phrases = new AdminPhrases(options);
  if (!phrases.initialize()) return null;
  instance = phrases;
  return phrases;
}


export function destroyAdminPhrases() {
  if (!instance) return false;
  const destroyed = instance.destroy();
  instance = null;
  return destroyed;
}
