import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  AdminReview,
  formatAdminContributionType,
  formatAdminDate,
  formatAdminDuration,
  formatReviewStatus,
} from "../../scripts/modules/admin-review.js";

const RUNTIME_KEY = randomUUID();
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

const ITEM_A = Object.freeze({
  id: ID_A,
  contributionType: "guided",
  language: "Pashto",
  sentenceText: "هر غږ ارزښت لري.",
  topic: null,
  originalFilename: "recording.webm",
  mimeType: "audio/webm",
  durationSeconds: 8.4,
  createdAt: "2026-07-16T08:30:00Z",
  reviewStatus: "pending",
  reviewedAt: null,
  rejectionReason: null,
  hasOwner: true,
  ownerDisplayName: "Test contributor",
});

const ITEM_B = Object.freeze({
  ...ITEM_A,
  id: ID_B,
  contributionType: "open_recording",
  sentenceText: null,
  topic: "A village story",
  originalFilename: "story.ogg",
  mimeType: "audio/ogg",
  durationSeconds: null,
  hasOwner: false,
  ownerDisplayName: null,
});

const ELEMENT_IDS = [
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
  "adminDownloadAudioButton",
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
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.value = "";
    this.type = "";
    this.validityMessage = "";
    this.reportValidityCalls = 0;
    this.focusCalls = 0;
    this.pauseCalls = 0;
    this.loadCalls = 0;
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
    const event = {
      type,
      target: this,
      preventDefault() {},
    };
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

  removeAttribute(name) {
    this.attributes.delete(name);
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

  pause() {
    this.pauseCalls += 1;
  }

  load() {
    this.loadCalls += 1;
  }
}


function createRoot() {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, new FakeElement()]));
  const filters = ["pending", "approved", "rejected", "all"].map((status) => {
    const button = new FakeElement("button");
    button.setAttribute("data-admin-filter", status);
    return button;
  });
  return {
    elements,
    filters,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll(selector) {
      return selector === "[data-admin-filter]" ? filters : [];
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
}


function queuePage(items = [ITEM_A], overrides = {}) {
  return {
    items: items.map((item) => ({ ...item })),
    total: items.length,
    limit: 20,
    offset: 0,
    status: "pending",
    ...overrides,
  };
}


function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}


function createApi({ list, detail, audio, review } = {}) {
  const calls = { list: [], detail: [], audio: [], review: [] };
  return {
    calls,
    async listContributions(options) {
      calls.list.push({ ...options });
      if (list) return list(options, calls.list.length);
      const status = options.status === "all" ? "pending" : options.status;
      const item = {
        ...ITEM_A,
        reviewStatus: status,
        reviewedAt: status === "pending" ? null : "2026-07-16T09:00:00Z",
      };
      return queuePage([item], {
        status: options.status,
        offset: options.offset,
      });
    },
    async getContribution(options) {
      calls.detail.push({ ...options });
      if (detail) return detail(options, calls.detail.length);
      return { ...(options.contributionId === ID_B ? ITEM_B : ITEM_A) };
    },
    async getContributionAudio(options) {
      calls.audio.push({ ...options });
      if (audio) return audio(options, calls.audio.length);
      return new Blob(["audio"], { type: "audio/webm" });
    },
    async reviewContribution(options) {
      calls.review.push({ ...options });
      if (review) return review(options, calls.review.length);
      return {
        ...(options.contributionId === ID_B ? ITEM_B : ITEM_A),
        reviewStatus: options.status,
        reviewedAt: "2026-07-16T09:30:00Z",
        rejectionReason:
          options.status === "rejected" ? options.rejectionReason : null,
      };
    },
  };
}


function createUrlApi() {
  const calls = { created: [], revoked: [] };
  return {
    calls,
    createObjectURL(blob) {
      calls.created.push(blob);
      return `blob:admin-audio-${calls.created.length}`;
    },
    revokeObjectURL(url) {
      calls.revoked.push(url);
    },
  };
}


function createFixture(options = {}) {
  const root = createRoot();
  const api = options.api ?? createApi(options);
  const urlApi = options.urlApi ?? createUrlApi();
  const review = new AdminReview({ root, api, urlApi, locale: "en-US" });
  assert.equal(review.initializeAdminReview(), true);
  return { root, api, urlApi, review };
}


function element(fixture, id) {
  return fixture.root.elements.get(id);
}


function filterButton(fixture, status) {
  return fixture.root.filters.find(
    (button) => button.getAttribute("data-admin-filter") === status,
  );
}


function renderedText(fixture) {
  return [...fixture.root.elements.values()]
    .map((entry) => entry.textContent)
    .join(" ");
}


async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}


async function connect(fixture, key = RUNTIME_KEY) {
  element(fixture, "adminKeyInput").value = key;
  assert.equal(await fixture.review.connect(), true);
}


async function openItem(fixture, id = ID_A) {
  assert.equal(await fixture.review.selectContribution(id), true);
  await flush();
}


test("1 initial state displays the key form", () => {
  const fixture = createFixture();
  assert.equal(element(fixture, "adminConnectionView").hidden, false);
  assert.equal(element(fixture, "adminDashboard").hidden, true);
  assert.equal(fixture.review.getState().connectionStatus, "idle");
});


test("2 blank key is rejected before an API request", async () => {
  const fixture = createFixture();
  assert.equal(await fixture.review.connect(), false);
  assert.equal(fixture.api.calls.list.length, 0);
  assert.equal(element(fixture, "adminKeyInput").reportValidityCalls, 1);
});


test("3 successful connection loads the pending queue", async () => {
  const fixture = createFixture();
  await connect(fixture);
  assert.equal(fixture.api.calls.list[0].status, "pending");
  assert.equal(fixture.api.calls.list[0].limit, 20);
  assert.equal(fixture.api.calls.list[0].offset, 0);
  assert.equal(element(fixture, "adminDashboard").hidden, false);
  assert.equal(element(fixture, "adminPendingCount").textContent, "Pending reviews: 1");
});


test("4 visible key field is cleared after connection", async () => {
  const fixture = createFixture();
  await connect(fixture);
  assert.equal(element(fixture, "adminKeyInput").value, "");
});


test("5 state exposes only a boolean instead of the memory-only key", async () => {
  const fixture = createFixture();
  await connect(fixture);
  const state = fixture.review.getState();
  assert.equal(state.hasAdminKey, true);
  assert.equal(JSON.stringify(state).includes(RUNTIME_KEY), false);
  assert.equal(Object.hasOwn(state, "adminKey"), false);
});


test("6 invalid key returns to disconnected view and clears the input", async () => {
  const fixture = createFixture({
    list() {
      const error = new Error("Invalid admin API key.");
      error.code = "INVALID_ADMIN_KEY";
      error.status = 403;
      throw error;
    },
  });
  element(fixture, "adminKeyInput").value = RUNTIME_KEY;
  assert.equal(await fixture.review.connect(), false);
  assert.equal(fixture.review.getState().hasAdminKey, false);
  assert.equal(element(fixture, "adminDashboard").hidden, true);
  assert.equal(element(fixture, "adminKeyInput").value, "");
});


test("7 disconnect clears queue, selection and review data", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  fixture.review.disconnect();
  const state = fixture.review.getState();
  assert.equal(state.queue.items.length, 0);
  assert.equal(state.selection.id, null);
  assert.equal(state.review.status, "idle");
  assert.equal(state.hasAdminKey, false);
});


test("8 disconnect revokes the active audio object URL", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  fixture.review.disconnect();
  assert.deepEqual(fixture.urlApi.calls.revoked, ["blob:admin-audio-1"]);
});


test("9 pending filter is selected by default", () => {
  const fixture = createFixture();
  assert.equal(fixture.review.getState().filter, "pending");
  assert.equal(filterButton(fixture, "pending").getAttribute("aria-pressed"), "true");
});


test("10 queue loading state appears while connecting", async () => {
  const deferred = createDeferred();
  const fixture = createFixture({ list: () => deferred.promise });
  element(fixture, "adminKeyInput").value = RUNTIME_KEY;
  const pending = fixture.review.connect();
  assert.equal(fixture.review.getState().queue.status, "loading");
  assert.match(element(fixture, "adminConnectionStatus").textContent, /loading/i);
  deferred.resolve(queuePage());
  await pending;
});


test("11 queue items render safe summary fields", async () => {
  const fixture = createFixture();
  await connect(fixture);
  const text = element(fixture, "adminContributionList").textContent;
  assert.match(text, /Guided recording/);
  assert.match(text, /Pashto/);
  assert.match(text, /Owned contribution/);
});


test("12 empty queue state renders", async () => {
  const fixture = createFixture({
    list: (options) => queuePage([], { status: options.status, offset: options.offset }),
  });
  await connect(fixture);
  assert.equal(element(fixture, "adminQueueEmpty").hidden, false);
  assert.equal(element(fixture, "adminContributionList").children.length, 0);
  assert.equal(
    element(fixture, "adminQueueEmptyTitle").textContent,
    "No recordings are waiting for review.",
  );
});


test("13 filter change resets offset to zero and clears selection", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  fixture.review._state.queue.offset = 20;
  filterButton(fixture, "approved").dispatch("click");
  await flush();
  assert.equal(fixture.api.calls.list.at(-1).offset, 0);
  assert.equal(fixture.review.getState().selection.id, null);
});


test("14 approved filter is requested from the backend", async () => {
  const fixture = createFixture();
  await connect(fixture);
  filterButton(fixture, "approved").dispatch("click");
  await flush();
  assert.ok(fixture.api.calls.list.some((call) => call.status === "approved"));
  assert.equal(fixture.api.calls.list.at(-1).status, "pending");
  assert.equal(fixture.api.calls.list.at(-1).limit, 1);
});


test("15 rejected filter is requested from the backend", async () => {
  const fixture = createFixture();
  await connect(fixture);
  filterButton(fixture, "rejected").dispatch("click");
  await flush();
  assert.ok(fixture.api.calls.list.some((call) => call.status === "rejected"));
  assert.equal(fixture.api.calls.list.at(-1).status, "pending");
});


test("16 all filter is requested from the backend", async () => {
  const fixture = createFixture();
  await connect(fixture);
  filterButton(fixture, "all").dispatch("click");
  await flush();
  assert.ok(fixture.api.calls.list.some((call) => call.status === "all"));
  assert.equal(fixture.api.calls.list.at(-1).status, "pending");
});


test("17 next-page pagination uses the correct offset", async () => {
  const fixture = createFixture({
    list: (options) =>
      queuePage(options.offset ? [ITEM_B] : Array.from({ length: 20 }, (_, index) => ({
        ...ITEM_A,
        id: `page-item-${index}`,
      })), {
        total: 21,
        offset: options.offset,
        status: options.status,
      }),
  });
  await connect(fixture);
  element(fixture, "adminNextPageButton").dispatch("click");
  await flush();
  assert.equal(fixture.api.calls.list.at(-1).offset, 20);
});


test("18 previous button is disabled on the first page", async () => {
  const fixture = createFixture();
  await connect(fixture);
  assert.equal(element(fixture, "adminPreviousPageButton").disabled, true);
});


test("19 next button is disabled on the final page", async () => {
  const fixture = createFixture();
  await connect(fixture);
  assert.equal(element(fixture, "adminNextPageButton").disabled, true);
});


test("20 duplicate queue requests are prevented", async () => {
  const deferred = createDeferred();
  let request = 0;
  const fixture = createFixture({
    list(options) {
      request += 1;
      if (request === 1) return queuePage([], { status: options.status });
      return deferred.promise;
    },
  });
  await connect(fixture);
  const first = fixture.review.loadQueue();
  const second = await fixture.review.loadQueue();
  assert.equal(second, false);
  assert.equal(fixture.api.calls.list.length, 2);
  deferred.resolve(queuePage());
  await first;
});


test("21 selecting an item loads contribution detail", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  assert.equal(fixture.api.calls.detail[0].contributionId, ID_A);
  assert.equal(fixture.review.getState().selection.status, "ready");
});


test("22 selecting an item loads only its protected audio", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  assert.deepEqual(fixture.api.calls.audio.map((call) => call.contributionId), [ID_A]);
});


test("23 successful audio loading creates an object URL", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  assert.equal(fixture.urlApi.calls.created.length, 1);
  assert.equal(element(fixture, "adminAudioPlayer").getAttribute("src"), "blob:admin-audio-1");
});


test("23a unsupported native playback keeps a protected original-file action", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);

  element(fixture, "adminAudioPlayer").dispatch("error");

  assert.match(
    element(fixture, "adminAudioStatus").textContent,
    /cannot play the original recording format directly/i,
  );
  assert.equal(element(fixture, "adminDownloadAudioButton").hidden, false);
  assert.equal(
    element(fixture, "adminDownloadAudioButton").getAttribute("href"),
    "blob:admin-audio-1",
  );
});


test("24 selecting another item revokes the previous object URL", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture, ID_A);
  await openItem(fixture, ID_B);
  assert.ok(fixture.urlApi.calls.revoked.includes("blob:admin-audio-1"));
  assert.equal(fixture.urlApi.calls.created.length, 2);
});


test("25 audio failure preserves usable contribution metadata", async () => {
  const fixture = createFixture({
    audio() {
      throw new Error("audio unavailable");
    },
  });
  await connect(fixture);
  await openItem(fixture);
  assert.equal(fixture.review.getState().selection.status, "ready");
  assert.equal(fixture.review.getState().selection.audioStatus, "error");
  assert.equal(element(fixture, "adminDetailContent").hidden, false);
  assert.equal(element(fixture, "adminReviewForm").hidden, false);
});


test("26 user UUID is not rendered", async () => {
  const fixture = createFixture({
    detail: () => ({ ...ITEM_A, userId: "private-user-uuid" }),
  });
  await connect(fixture);
  await openItem(fixture);
  assert.equal(renderedText(fixture).includes("private-user-uuid"), false);
});


test("27 owner email is not rendered", async () => {
  const fixture = createFixture({
    detail: () => ({ ...ITEM_A, email: "secret-owner@example.com" }),
  });
  await connect(fixture);
  await openItem(fixture);
  assert.equal(renderedText(fixture).includes("secret-owner@example.com"), false);
});


test("28 storage path is not rendered", async () => {
  const fixture = createFixture({
    detail: () => ({ ...ITEM_A, storagePath: "/private/audio/path.webm" }),
  });
  await connect(fixture);
  await openItem(fixture);
  assert.equal(renderedText(fixture).includes("/private/audio/path.webm"), false);
});


test("29 admin key is never rendered", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  assert.equal(renderedText(fixture).includes(RUNTIME_KEY), false);
});


test("30 approval sends the selected contribution and approved status", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  await fixture.review.review("approved");
  assert.equal(fixture.api.calls.review[0].contributionId, ID_A);
  assert.equal(fixture.api.calls.review[0].status, "approved");
  assert.equal(fixture.api.calls.review[0].rejectionReason, "");
});


test("31 approval disables review controls while saving", async () => {
  const deferred = createDeferred();
  const fixture = createFixture({ review: () => deferred.promise });
  await connect(fixture);
  await openItem(fixture);
  const pending = fixture.review.review("approved");
  assert.equal(element(fixture, "adminApproveButton").disabled, true);
  assert.equal(element(fixture, "adminRejectButton").disabled, true);
  assert.equal(element(fixture, "adminApproveButton").textContent, "Approving…");
  deferred.resolve({
    ...ITEM_A,
    reviewStatus: "approved",
    reviewedAt: "2026-07-16T10:00:00Z",
  });
  await pending;
});


test("32 approval removes the item from the pending queue immediately", async () => {
  const refresh = createDeferred();
  let listRequest = 0;
  const fixture = createFixture({
    list(options) {
      listRequest += 1;
      return listRequest === 1
        ? queuePage([ITEM_A], { status: options.status })
        : refresh.promise;
    },
  });
  await connect(fixture);
  await openItem(fixture);
  await fixture.review.review("approved");
  assert.equal(fixture.review.getState().queue.items.length, 0);
  assert.equal(fixture.review.getState().pendingTotal, 0);
  assert.equal(
    fixture.review.getState().review.message,
    "Contribution approved. The contributor’s score will update on their next refresh.",
  );
  refresh.resolve(queuePage([], { status: "pending" }));
  await flush();
});


test("33 rejection requires a nonblank reason", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  assert.equal(await fixture.review.review("rejected"), false);
  assert.equal(fixture.api.calls.review.length, 0);
  assert.equal(element(fixture, "adminRejectionReason").reportValidityCalls, 1);
});


test("34 rejection sends a trimmed reason", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  element(fixture, "adminRejectionReason").value = "  Audio is too noisy.  ";
  await fixture.review.review("rejected");
  assert.equal(fixture.api.calls.review[0].rejectionReason, "Audio is too noisy.");
});


test("35 rejection disables controls and reports rejecting state", async () => {
  const deferred = createDeferred();
  const fixture = createFixture({ review: () => deferred.promise });
  await connect(fixture);
  await openItem(fixture);
  element(fixture, "adminRejectionReason").value = "Noisy";
  const pending = fixture.review.review("rejected");
  assert.equal(element(fixture, "adminRejectButton").disabled, true);
  assert.equal(element(fixture, "adminRejectButton").textContent, "Rejecting…");
  deferred.resolve({
    ...ITEM_A,
    reviewStatus: "rejected",
    rejectionReason: "Noisy",
    reviewedAt: "2026-07-16T10:00:00Z",
  });
  await pending;
});


test("36 rejected recording remains represented in selected detail", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  element(fixture, "adminRejectionReason").value = "Audio is clipped.";
  await fixture.review.review("rejected");
  const selected = fixture.review.getState().selection.item;
  assert.equal(selected.reviewStatus, "rejected");
  assert.equal(selected.rejectionReason, "Audio is clipped.");
  assert.equal(element(fixture, "adminDetailPanel").hidden, false);
  assert.equal(
    fixture.review.getState().review.message,
    "Contribution rejected. It will not count toward the contributor’s score.",
  );
});


test("37 rejected contribution can be corrected to approved", async () => {
  const rejected = {
    ...ITEM_A,
    reviewStatus: "rejected",
    rejectionReason: "Earlier reason",
    reviewedAt: "2026-07-16T09:00:00Z",
  };
  const fixture = createFixture({
    detail: () => rejected,
    review: (options) => ({
      ...rejected,
      reviewStatus: options.status,
      rejectionReason: null,
      reviewedAt: "2026-07-16T10:00:00Z",
    }),
  });
  await connect(fixture);
  await openItem(fixture);
  assert.equal(await fixture.review.review("approved"), true);
  assert.equal(fixture.review.getState().selection.item.reviewStatus, "approved");
  assert.equal(fixture.api.calls.review[0].rejectionReason, "");
});


test("38 approved contribution can be corrected to rejected with a new reason", async () => {
  const approved = {
    ...ITEM_A,
    reviewStatus: "approved",
    reviewedAt: "2026-07-16T09:00:00Z",
  };
  const fixture = createFixture({ detail: () => approved });
  await connect(fixture);
  await openItem(fixture);
  element(fixture, "adminRejectionReason").value = "New review found clipping.";
  await fixture.review.review("rejected");
  assert.equal(fixture.api.calls.review[0].status, "rejected");
  assert.equal(fixture.api.calls.review[0].rejectionReason, "New review found clipping.");
});


test("39 successful approval clears the visible rejection reason", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  element(fixture, "adminRejectionReason").value = "Draft that should clear";
  await fixture.review.review("approved");
  assert.equal(element(fixture, "adminRejectionReason").value, "");
});


test("40 review failure preserves the selected contribution", async () => {
  const fixture = createFixture({
    review() {
      throw new Error("database internals");
    },
  });
  await connect(fixture);
  await openItem(fixture);
  assert.equal(await fixture.review.review("approved"), false);
  assert.equal(fixture.review.getState().selection.id, ID_A);
  assert.equal(fixture.review.getState().selection.status, "ready");
  assert.equal(
    fixture.review.getState().review.message,
    "The review action could not be completed. Please try again.",
  );
  assert.equal(renderedText(fixture).includes("database internals"), false);
});


test("41 duplicate review requests are prevented", async () => {
  const deferred = createDeferred();
  const fixture = createFixture({ review: () => deferred.promise });
  await connect(fixture);
  await openItem(fixture);
  const first = fixture.review.review("approved");
  const second = await fixture.review.review("approved");
  assert.equal(second, false);
  assert.equal(fixture.api.calls.review.length, 1);
  deferred.resolve({
    ...ITEM_A,
    reviewStatus: "approved",
    reviewedAt: "2026-07-16T10:00:00Z",
  });
  await first;
});


test("42 stale queue response is ignored after a filter change", async () => {
  const approved = createDeferred();
  const fixture = createFixture({
    list(options) {
      if (options.status === "approved") return approved.promise;
      if (options.status === "rejected") {
        return queuePage([{ ...ITEM_B, reviewStatus: "rejected" }], {
          status: "rejected",
        });
      }
      return queuePage([ITEM_A], { status: options.status });
    },
  });
  await connect(fixture);
  filterButton(fixture, "approved").dispatch("click");
  filterButton(fixture, "rejected").dispatch("click");
  await flush();
  approved.resolve(queuePage([{ ...ITEM_A, reviewStatus: "approved" }], { status: "approved" }));
  await flush();
  assert.equal(fixture.review.getState().filter, "rejected");
  assert.equal(fixture.review.getState().queue.items[0].reviewStatus, "rejected");
});


test("43 stale detail response is ignored when another item is selected", async () => {
  const firstDetail = createDeferred();
  const fixture = createFixture({
    detail: ({ contributionId }) =>
      contributionId === ID_A ? firstDetail.promise : { ...ITEM_B },
  });
  await connect(fixture);
  const openingA = fixture.review.selectContribution(ID_A);
  const openingB = fixture.review.selectContribution(ID_B);
  await openingB;
  firstDetail.resolve({ ...ITEM_A });
  await openingA;
  assert.equal(fixture.review.getState().selection.id, ID_B);
  assert.equal(fixture.review.getState().selection.item.id, ID_B);
});


test("44 stale audio response is ignored without creating its URL", async () => {
  const firstAudio = createDeferred();
  const fixture = createFixture({
    audio: ({ contributionId }) =>
      contributionId === ID_A
        ? firstAudio.promise
        : new Blob(["second"], { type: "audio/ogg" }),
  });
  await connect(fixture);
  await fixture.review.selectContribution(ID_A);
  await fixture.review.selectContribution(ID_B);
  await flush();
  firstAudio.resolve(new Blob(["first"], { type: "audio/webm" }));
  await flush();
  assert.equal(fixture.urlApi.calls.created.length, 1);
  assert.equal(element(fixture, "adminAudioPlayer").getAttribute("src"), "blob:admin-audio-1");
});


test("45 queue response after disconnect is ignored", async () => {
  const deferred = createDeferred();
  const fixture = createFixture({ list: () => deferred.promise });
  element(fixture, "adminKeyInput").value = RUNTIME_KEY;
  const connecting = fixture.review.connect();
  fixture.review.disconnect();
  deferred.resolve(queuePage());
  assert.equal(await connecting, false);
  assert.equal(fixture.review.getState().queue.items.length, 0);
  assert.equal(fixture.review.getState().hasAdminKey, false);
});


test("46 response after destruction is ignored", async () => {
  const deferred = createDeferred();
  const fixture = createFixture({ list: () => deferred.promise });
  element(fixture, "adminKeyInput").value = RUNTIME_KEY;
  const connecting = fixture.review.connect();
  fixture.review.destroy();
  deferred.resolve(queuePage());
  assert.equal(await connecting, false);
  assert.equal(fixture.review.getState().hasAdminKey, false);
});


test("47 destroy removes every bound listener", () => {
  const fixture = createFixture();
  const before = [...fixture.root.elements.values(), ...fixture.root.filters]
    .flatMap((entry) => [...entry.listeners.values()])
    .reduce((total, listeners) => total + listeners.size, 0);
  assert.ok(before > 0);
  fixture.review.destroy();
  const after = [...fixture.root.elements.values(), ...fixture.root.filters]
    .flatMap((entry) => [...entry.listeners.values()])
    .reduce((total, listeners) => total + listeners.size, 0);
  assert.equal(after, 0);
});


test("48 destroy clears the memory-only key and visible field", async () => {
  const fixture = createFixture();
  await connect(fixture);
  fixture.review.destroy();
  assert.equal(fixture.review.getState().hasAdminKey, false);
  assert.equal(element(fixture, "adminKeyInput").value, "");
});


test("49 repeated destruction is safe", () => {
  const fixture = createFixture();
  assert.equal(fixture.review.destroy(), true);
  assert.equal(fixture.review.destroy(), false);
});


test("50 browser storage APIs never receive the admin key", async () => {
  const source = await readFile(
    new URL("../../scripts/modules/admin-review.js", import.meta.url),
    "utf8",
  );
  for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    assert.equal(source.includes(forbidden), false);
  }
  const fixture = createFixture();
  await connect(fixture);
  assert.equal(JSON.stringify(fixture.review.getState()).includes(RUNTIME_KEY), false);
});


test("admin page exposes an accessible pending count and explicit refresh", async () => {
  const html = await readFile(
    new URL("../../admin.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /id="adminPendingCount"[\s\S]*aria-live="polite"/);
  assert.match(html, /id="adminRefreshQueueButton"[\s\S]*Refresh queue/);
  assert.match(html, /No recordings are waiting for review\./);
});


test("pending count refreshes from backend while another filter is active", async () => {
  const fixture = createFixture({
    list(options) {
      if (options.status === "pending") {
        return queuePage([ITEM_A], { total: 4, status: "pending" });
      }
      return queuePage([], { status: options.status });
    },
  });
  await connect(fixture);
  assert.equal(element(fixture, "adminPendingCount").textContent, "Pending reviews: 4");

  filterButton(fixture, "approved").dispatch("click");
  await flush();

  assert.equal(element(fixture, "adminPendingCount").textContent, "Pending reviews: 4");
  assert.deepEqual(fixture.api.calls.list.at(-1), {
    adminKey: RUNTIME_KEY,
    status: "pending",
    limit: 1,
    offset: 0,
  });
});


test("format helpers provide stable safe labels", () => {
  assert.equal(formatAdminContributionType("guided"), "Guided recording");
  assert.equal(formatAdminContributionType("open_recording"), "Open recording");
  assert.equal(formatAdminDuration(65), "1 min 05 sec");
  assert.equal(formatAdminDuration(null), "Not reported");
  assert.equal(formatReviewStatus("approved"), "Approved");
  assert.equal(formatAdminDate("invalid"), "Not available");
});


test("closing detail revokes audio and returns to selection prompt", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  assert.equal(fixture.review.closeSelection(), true);
  assert.equal(element(fixture, "adminDetailPanel").hidden, true);
  assert.equal(element(fixture, "adminSelectionPrompt").hidden, false);
  assert.deepEqual(fixture.urlApi.calls.revoked, ["blob:admin-audio-1"]);
});


test("authentication failure during a detail request clears dashboard data", async () => {
  const fixture = createFixture({
    detail() {
      const error = new Error("expired");
      error.status = 403;
      error.code = "INVALID_ADMIN_KEY";
      throw error;
    },
  });
  await connect(fixture);
  assert.equal(await fixture.review.selectContribution(ID_A), false);
  assert.equal(fixture.review.getState().hasAdminKey, false);
  assert.equal(element(fixture, "adminDashboard").hidden, true);
});


test("queue refresh failure keeps existing results and exposes retry", async () => {
  let request = 0;
  const fixture = createFixture({
    list() {
      request += 1;
      if (request === 1) return queuePage([ITEM_A]);
      throw new Error("network");
    },
  });
  await connect(fixture);
  assert.equal(await fixture.review.loadQueue(), false);
  assert.equal(fixture.review.getState().queue.items.length, 1);
  assert.equal(element(fixture, "adminQueueError").hidden, false);
});


test("review reason count updates without rendering reason as HTML", async () => {
  const fixture = createFixture();
  await connect(fixture);
  await openItem(fixture);
  const field = element(fixture, "adminRejectionReason");
  field.value = "<img src=x>";
  field.dispatch("input");
  assert.equal(element(fixture, "adminRejectionCount").textContent, "11 / 500");
  assert.equal(renderedText(fixture).includes("<img src=x>"), false);
});
