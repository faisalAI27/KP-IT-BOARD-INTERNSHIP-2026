import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { AdminPhrases } from "../../scripts/modules/admin-phrases.js";
import { ContributionsApi } from "../../scripts/services/contributions-api.js";

const ADMIN_KEY = randomUUID();
const PHRASE_ID = "11111111-1111-4111-8111-111111111111";
const PASHTO_TEXT = "زه خپل کلي سره مینه لرم";

const ELEMENT_IDS = [
  "adminReviewSectionButton",
  "adminPhraseSectionButton",
  "adminReviewWorkspace",
  "adminPhrasePanel",
  "adminRefreshPhrasesButton",
  "adminPhraseTotalCount",
  "adminPhraseActiveCount",
  "adminPhraseInactiveCount",
  "adminPhraseImportForm",
  "adminPhraseFileInput",
  "adminPhraseImportButton",
  "adminPhraseImportStatus",
  "adminPhraseImportSummary",
  "adminPhraseImportReceived",
  "adminPhraseImportCreated",
  "adminPhraseImportDuplicates",
  "adminPhraseImportInvalid",
  "adminPhraseExportStatus",
  "adminPhraseFilterForm",
  "adminPhraseSearchInput",
  "adminPhraseLanguageInput",
  "adminPhraseActiveFilter",
  "adminApplyPhraseFiltersButton",
  "adminPhraseStatus",
  "adminPhraseError",
  "adminPhraseErrorMessage",
  "adminRetryPhrasesButton",
  "adminPhraseEmpty",
  "adminPhraseTableWrapper",
  "adminPhraseTableBody",
  "adminPreviousPhrasePageButton",
  "adminNextPhrasePageButton",
  "adminPhrasePaginationStatus",
  "adminPhraseEditDialog",
  "adminPhraseEditForm",
  "adminPhraseEditText",
  "adminPhraseEditLanguage",
  "adminPhraseEditCategory",
  "adminPhraseEditDialect",
  "adminPhraseEditSource",
  "adminPhraseEditDifficulty",
  "adminSavePhraseButton",
  "adminCancelPhraseEditButton",
  "adminCancelPhraseEditAction",
  "adminPhraseEditStatus",
];


function phrase(overrides = {}) {
  return {
    id: PHRASE_ID,
    text: PASHTO_TEXT,
    language: "Pashto",
    category: "general",
    dialect: null,
    source: null,
    difficulty: null,
    active: true,
    createdAt: "2026-07-19T09:00:00Z",
    updatedAt: "2026-07-19T09:00:00Z",
    timesAssigned: 3,
    recordingsSubmitted: 2,
    pendingCount: 1,
    approvedCount: 1,
    rejectedCount: 0,
    ...overrides,
  };
}


class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}


class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.className = "";
    this.classList = new FakeClassList();
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.value = "";
    this.files = [];
    this.title = "";
    this.validityMessage = "";
    this.reportValidityCalls = 0;
    this.focusCalls = 0;
    this.showModalCalls = 0;
    this.closeCalls = 0;
    this._text = "";
  }

  get textContent() {
    return `${this._text}${this.children.map((child) => child.textContent).join("")}`;
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    const event = { type, target: this, preventDefault() {} };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this._text = "";
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setCustomValidity(message) {
    this.validityMessage = String(message);
  }

  reportValidity() {
    this.reportValidityCalls += 1;
    return !this.validityMessage;
  }

  focus() {
    this.focusCalls += 1;
  }

  showModal() {
    this.showModalCalls += 1;
    this.hidden = false;
  }

  close() {
    this.closeCalls += 1;
  }
}


function createRoot() {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, new FakeElement()]));
  const exportButtons = ["csv-active", "csv-all", "json-active", "json-all"].map((choice) => {
    const button = new FakeElement("button");
    button.setAttribute("data-phrase-export", choice);
    return button;
  });
  return {
    elements,
    exportButtons,
    body: new FakeElement("body"),
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll(selector) {
      return selector === "[data-phrase-export]" ? exportButtons : [];
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
}


function page(items, options = {}) {
  return {
    items: items.map((item) => ({ ...item })),
    total: options.total ?? items.length,
    limit: options.limit ?? 20,
    offset: options.offset ?? 0,
    order: "newest",
  };
}


function createApi({ list, importFile, update, exportFile } = {}) {
  const calls = { list: [], import: [], update: [], export: [] };
  let current = phrase();
  return {
    calls,
    async list(options) {
      calls.list.push({ ...options });
      if (list) return list(options, calls.list.length);
      if (options.limit === 1) {
        const total = options.active === true
          ? Number(current.active)
          : options.active === false
            ? Number(!current.active)
            : 1;
        return page(total ? [current] : [], { total, limit: 1, offset: 0 });
      }
      return page([current], { offset: options.offset });
    },
    async import(options) {
      calls.import.push({ ...options });
      if (importFile) return importFile(options, calls.import.length);
      return { received: 4, created: 2, duplicates: 1, invalid: 1 };
    },
    async update(options) {
      calls.update.push({ ...options, updates: { ...options.updates } });
      if (update) return update(options, calls.update.length);
      current = { ...current, ...options.updates };
      return { ...current };
    },
    async export(options) {
      calls.export.push({ ...options });
      if (exportFile) return exportFile(options, calls.export.length);
      return {
        blob: new Blob([PASHTO_TEXT], { type: options.format === "csv" ? "text/csv" : "application/json" }),
        filename: `phrases.${options.format}`,
      };
    },
  };
}


function subscribeWithKey(listener) {
  listener({ connected: true, adminKey: ADMIN_KEY });
  return () => {};
}


function createFixture(options = {}) {
  const root = createRoot();
  const api = options.api ?? createApi(options);
  const downloads = [];
  const phrases = new AdminPhrases({
    root,
    api,
    subscribeConnection: options.subscribeConnection ?? subscribeWithKey,
    confirmAction: options.confirmAction ?? (() => true),
    download: options.download ?? ((document) => {
      downloads.push(document);
      return true;
    }),
    locale: "en-US",
  });
  assert.equal(phrases.initialize(), true);
  return { root, api, phrases, downloads };
}


function element(fixture, id) {
  return fixture.root.elements.get(id);
}


function renderedText(fixture) {
  return [...fixture.root.elements.values()]
    .map((entry) => entry.textContent)
    .join(" ");
}


function namedFile(name) {
  return { name };
}


async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}


function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}


async function openAndLoad(fixture) {
  assert.equal(fixture.phrases.openSection("phrases"), true);
  await flush();
}


test("Phrase Management section opens without removing contribution review", async () => {
  const fixture = createFixture();
  await openAndLoad(fixture);
  assert.equal(element(fixture, "adminPhrasePanel").hidden, false);
  assert.equal(element(fixture, "adminReviewWorkspace").hidden, true);
  fixture.phrases.openSection("review");
  assert.equal(element(fixture, "adminReviewWorkspace").hidden, false);
});


test("phrase list loads, renders Pashto as plain RTL text, and shows counts", async () => {
  const fixture = createFixture();
  await openAndLoad(fixture);
  const row = element(fixture, "adminPhraseTableBody").children[0];
  const text = row.children[0].children[0];
  assert.equal(text.textContent, PASHTO_TEXT);
  assert.equal(text.getAttribute("lang"), "ps");
  assert.equal(text.getAttribute("dir"), "rtl");
  assert.equal(element(fixture, "adminPhraseTotalCount").textContent, "1");
  assert.equal(element(fixture, "adminPhraseActiveCount").textContent, "1");
  assert.equal(element(fixture, "adminPhraseInactiveCount").textContent, "0");
});


test("search, language, and active filters send the expected query values", async () => {
  const fixture = createFixture();
  await openAndLoad(fixture);
  element(fixture, "adminPhraseSearchInput").value = PASHTO_TEXT;
  element(fixture, "adminPhraseLanguageInput").value = "Pashto";
  element(fixture, "adminPhraseActiveFilter").value = "false";
  element(fixture, "adminPhraseFilterForm").dispatch("submit");
  await flush();
  const call = fixture.api.calls.list.at(-1);
  assert.equal(call.search, PASHTO_TEXT);
  assert.equal(call.language, "Pashto");
  assert.equal(call.active, false);
  assert.equal(call.offset, 0);
});


test("phrase pagination requests the next page", async () => {
  const api = createApi({
    list: (options) => {
      if (options.limit === 1) return page([phrase()], { total: 41, limit: 1 });
      return page([phrase({ id: `${options.offset}` })], {
        total: 41,
        offset: options.offset,
      });
    },
  });
  const fixture = createFixture({ api });
  await openAndLoad(fixture);
  element(fixture, "adminNextPhrasePageButton").dispatch("click");
  await flush();
  assert.equal(api.calls.list.at(-1).offset, 20);
  assert.equal(element(fixture, "adminPhrasePaginationStatus").textContent, "21–21 of 41");
});


test("phrase actions wait for an in-progress filter refresh", async () => {
  const pending = deferred();
  const api = createApi({
    list: (options) => {
      if (options.search) return pending.promise;
      if (options.limit === 1) return page([phrase()], { total: 1, limit: 1 });
      return page([phrase()]);
    },
  });
  const fixture = createFixture({ api });
  await openAndLoad(fixture);
  element(fixture, "adminPhraseSearchInput").value = PASHTO_TEXT;
  element(fixture, "adminPhraseFilterForm").dispatch("submit");
  assert.equal(fixture.phrases.getState().status, "loading");
  assert.equal(await fixture.phrases.togglePhrase(PHRASE_ID), false);
  assert.equal(api.calls.update.length, 0);
  pending.resolve(page([phrase()]));
  await flush();
  assert.equal(fixture.phrases.getState().status, "ready");
});


test("import summary renders received, created, duplicate, and invalid counts", async () => {
  const fixture = createFixture();
  await openAndLoad(fixture);
  element(fixture, "adminPhraseFileInput").files = [namedFile("phrases.txt")];
  assert.equal(await fixture.phrases.importSelectedFile(), true);
  assert.equal(element(fixture, "adminPhraseImportSummary").hidden, false);
  assert.equal(element(fixture, "adminPhraseImportReceived").textContent, "4");
  assert.equal(element(fixture, "adminPhraseImportCreated").textContent, "2");
  assert.equal(element(fixture, "adminPhraseImportDuplicates").textContent, "1");
  assert.equal(element(fixture, "adminPhraseImportInvalid").textContent, "1");
});


test("import errors remain safe and do not render server paths", async () => {
  const api = createApi({
    importFile: async () => {
      throw new Error("/private/backend/imports/raw-parser.py: secret failure");
    },
  });
  const fixture = createFixture({ api });
  await openAndLoad(fixture);
  element(fixture, "adminPhraseFileInput").files = [namedFile("phrases.csv")];
  assert.equal(await fixture.phrases.importSelectedFile(), false);
  const status = element(fixture, "adminPhraseImportStatus").textContent;
  assert.match(status, /could not be imported/i);
  assert.doesNotMatch(status, /private|backend|parser|secret/i);
});


test("disable and enable actions update the phrase row and totals without reloading the app", async () => {
  const fixture = createFixture();
  await openAndLoad(fixture);
  assert.equal(await fixture.phrases.togglePhrase(PHRASE_ID), true);
  assert.deepEqual(fixture.api.calls.update[0].updates, { active: false });
  assert.equal(element(fixture, "adminPhraseActiveCount").textContent, "0");
  assert.equal(element(fixture, "adminPhraseInactiveCount").textContent, "1");
  assert.match(element(fixture, "adminPhraseStatus").textContent, /Phrase disabled/);
  assert.equal(await fixture.phrases.togglePhrase(PHRASE_ID), true);
  assert.deepEqual(fixture.api.calls.update[1].updates, { active: true });
  assert.match(element(fixture, "adminPhraseStatus").textContent, /Phrase enabled/);
});


test("disabling requires confirmation and cancellation makes no request", async () => {
  const fixture = createFixture({ confirmAction: () => false });
  await openAndLoad(fixture);
  assert.equal(await fixture.phrases.togglePhrase(PHRASE_ID), false);
  assert.equal(fixture.api.calls.update.length, 0);
});


test("supported phrase fields can be edited with the historical snapshot warning intact", async () => {
  const fixture = createFixture();
  await openAndLoad(fixture);
  assert.equal(fixture.phrases.startEdit(PHRASE_ID), true);
  element(fixture, "adminPhraseEditText").value = "زما غږ زما پېژندنه ده";
  element(fixture, "adminPhraseEditLanguage").value = "Pashto";
  element(fixture, "adminPhraseEditCategory").value = "identity";
  assert.equal(await fixture.phrases.saveEdit(), true);
  assert.equal(fixture.api.calls.update.at(-1).updates.text, "زما غږ زما پېژندنه ده");
  assert.equal(fixture.api.calls.update.at(-1).updates.category, "identity");
  const html = await readFile(new URL("../../admin.html", import.meta.url), "utf8");
  assert.match(html, /Historical recordings keep the exact phrase snapshot/);
});


test("all four export controls use documents returned by the protected backend", async () => {
  const fixture = createFixture();
  await openAndLoad(fixture);
  for (const [format, activeOnly] of [
    ["csv", true],
    ["csv", false],
    ["json", true],
    ["json", false],
  ]) {
    assert.equal(await fixture.phrases.exportCollection(format, activeOnly), true);
  }
  assert.deepEqual(
    fixture.api.calls.export.map(({ format, activeOnly }) => ({ format, activeOnly })),
    [
      { format: "csv", activeOnly: true },
      { format: "csv", activeOnly: false },
      { format: "json", activeOnly: true },
      { format: "json", activeOnly: false },
    ],
  );
  assert.equal(fixture.downloads.length, 4);
  assert.ok(fixture.downloads.every((document) => document.blob instanceof Blob));
});


test("admin key stays memory-only and private response extras never render", async () => {
  const unsafe = phrase({
    userEmail: "private@example.invalid",
    storagePath: "/private/audio/recording.webm",
    accessToken: "private-token",
    secret: "private-secret",
  });
  const api = createApi({
    list: (options) => page(options.limit === 1 ? [unsafe] : [unsafe], {
      total: 1,
      limit: options.limit,
      offset: options.offset,
    }),
  });
  const fixture = createFixture({ api });
  await openAndLoad(fixture);
  const text = renderedText(fixture);
  assert.doesNotMatch(text, new RegExp(ADMIN_KEY));
  assert.doesNotMatch(text, /private@example|private\/audio|private-token|private-secret/);
  assert.equal(fixture.phrases.getState().hasAdminKey, true);
  assert.equal(JSON.stringify(fixture.phrases.getState()).includes(ADMIN_KEY), false);
  const sources = await Promise.all([
    readFile(new URL("../../scripts/modules/admin-phrases.js", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/services/admin-phrases-api.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(sources.join("\n"), /localStorage|sessionStorage|console\./);
});


test("protected admin panels share one in-memory connection module instance", async () => {
  const [app, phrases, withdrawals] = await Promise.all([
    readFile(new URL("../../scripts/admin-app.js", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/modules/admin-phrases.js", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/modules/admin-withdrawals.js", import.meta.url), "utf8"),
  ]);
  assert.match(app, /from "\.\/modules\/admin-review\.js"/);
  assert.match(phrases, /from "\.\/admin-review\.js"/);
  assert.match(withdrawals, /from "\.\/admin-review\.js"/);
  assert.doesNotMatch(`${app}\n${phrases}\n${withdrawals}`, /admin-review\.js\?/);
});


test("empty phrase list has an accessible empty and retry state", async () => {
  const api = createApi({
    list: (options) => page([], { total: 0, limit: options.limit, offset: 0 }),
  });
  const fixture = createFixture({ api });
  await openAndLoad(fixture);
  assert.equal(element(fixture, "adminPhraseEmpty").hidden, false);
  assert.equal(element(fixture, "adminPhraseTableWrapper").hidden, true);
  assert.equal(element(fixture, "adminRetryPhrasesButton").disabled, false);
});


test("no-active-phrase contributor response remains safe and supports custom text fallback", async () => {
  const api = new ContributionsApi({
    apiBaseUrl: "http://127.0.0.1:8000/api",
    fetchImpl: async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.deepEqual(await api.getSentencePrompts("Pashto"), []);
  const source = await readFile(
    new URL("../../scripts/modules/contributions.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(!prompts\.length\)/);
  assert.match(source, /No reviewed sentences are available right now/);
  assert.match(source, /sentenceId: sentenceSource === "provided" \? sentence\.id : undefined/);
});
