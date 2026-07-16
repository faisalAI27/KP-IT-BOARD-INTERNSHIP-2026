import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  CONTRIBUTION_CREATED_EVENT,
  MyContributions,
  dispatchContributionCreated,
  formatContributionDate,
  formatContributionDuration,
  formatContributionType,
} from "../../scripts/modules/my-contributions.js";


const USER_A = "0d5dd8f5-93df-462b-b234-a16973089092";
const USER_B = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31";
const SECRET = "private-token-must-not-render";
const ITEM_A = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  contributionType: "guided",
  sentenceId: "22222222-2222-4222-8222-222222222222",
  sentenceText: "هر غږ ارزښت لري.",
  topic: null,
  language: "Pashto",
  originalFilename: "recording.webm",
  mimeType: "audio/webm",
  durationSeconds: 7.4,
  status: "queued",
  createdAt: "2026-07-15T10:20:00Z",
});
const ITEM_B = Object.freeze({
  ...ITEM_A,
  id: "33333333-3333-4333-8333-333333333333",
  contributionType: "open_recording",
  sentenceId: null,
  sentenceText: null,
  topic: "A village story",
  originalFilename: "story.ogg",
  mimeType: "audio/ogg",
  durationSeconds: null,
  createdAt: "2026-07-16T11:30:00Z",
});


function authState(status, userId = null) {
  return {
    status,
    session: null,
    backendUser: userId
      ? { id: userId, email: "person@example.com", provider: "google" }
      : null,
    error: null,
  };
}


class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.className = "";
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.tabIndex = -1;
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

  dispatch(type, detail = undefined) {
    const event = { detail, target: this, type };
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
}


class FakeEventTarget extends FakeElement {
  constructor() {
    super("event-target");
    this.removals = 0;
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type);
    if (listeners?.delete(listener)) this.removals += 1;
  }
}


const ELEMENT_IDS = [
  "myContributionsSection",
  "myContributionsStatus",
  "myContributionsList",
  "myContributionsEmpty",
  "myContributionsError",
  "myContributionsErrorMessage",
  "refreshContributionsButton",
  "loadMoreContributionsButton",
  "retryContributionsButton",
  "myContributionsLoadMoreError",
];


function createRoot() {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, new FakeElement()]));
  return {
    elements,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
}


function createAuthApi(initialState = authState("signed_out")) {
  let state = initialState;
  const listeners = new Set();
  const calls = { subscriptions: 0, unsubscriptions: 0, verify: 0 };
  return {
    calls,
    getCurrentAuthState() {
      return state;
    },
    subscribeToAuthChanges(callback) {
      calls.subscriptions += 1;
      listeners.add(callback);
      callback(state);
      return () => {
        if (listeners.delete(callback)) calls.unsubscriptions += 1;
      };
    },
    async verifyCurrentUserWithBackend() {
      calls.verify += 1;
    },
    emit(nextState) {
      state = nextState;
      for (const listener of [...listeners]) listener(state);
    },
  };
}


function historyPage(items = [], { total = items.length, offset = 0 } = {}) {
  return { items, total, limit: 10, offset };
}


function createHistoryApi(get) {
  const calls = [];
  return {
    calls,
    async getMyContributions(pagination) {
      calls.push({ ...pagination });
      return get ? get(calls.length, pagination) : historyPage([]);
    },
  };
}


function createFixture({
  state = authState("signed_out"),
  get,
  locale = "en-US",
} = {}) {
  const root = createRoot();
  const authApi = createAuthApi(state);
  const contributionsApi = createHistoryApi(get);
  const eventTarget = new FakeEventTarget();
  const history = new MyContributions({
    root,
    authApi,
    contributionsApi,
    eventTarget,
    locale,
  });
  assert.equal(history.initializeMyContributions(), true);
  return { authApi, contributionsApi, eventTarget, history, root };
}


function element(fixture, id) {
  return fixture.root.elements.get(id);
}


function renderedText(fixture) {
  return [...fixture.root.elements.values()]
    .map((item) => item.textContent)
    .join(" ");
}


function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}


async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}


test("account partial includes the accessible My Contributions controls once", async () => {
  const html = await readFile(
    new URL("../../sections/auth-dialog.html", import.meta.url),
    "utf8",
  );
  for (const id of [
    "myContributionsSection",
    "myContributionsStatus",
    "myContributionsList",
    "refreshContributionsButton",
    "loadMoreContributionsButton",
    "retryContributionsButton",
  ]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1);
  }
  assert.match(html, /id="myContributionsStatus"[\s\S]*aria-live="polite"/);
  assert.match(html, /id="refreshContributionsButton"[\s\S]*type="button"/);
  assert.match(html, /id="loadMoreContributionsButton"[\s\S]*type="button"/);
  assert.match(html, /You have not submitted any voice contributions yet\./);
});


test("signed-out state hides history and does not call the API", async () => {
  const fixture = createFixture();
  await settle();
  assert.equal(element(fixture, "myContributionsSection").hidden, true);
  assert.equal(fixture.contributionsApi.calls.length, 0);
});


test("authentication loading hides history and does not call the API", async () => {
  const fixture = createFixture({ state: authState("loading") });
  await settle();
  assert.equal(element(fixture, "myContributionsSection").hidden, true);
  assert.equal(fixture.contributionsApi.calls.length, 0);
});


test("verified login automatically requests the first ten items", () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });
  assert.deepEqual(fixture.contributionsApi.calls, [{ limit: 10, offset: 0 }]);
  assert.equal(element(fixture, "myContributionsSection").hidden, false);
});


test("sign-out clears loaded history and hides the section", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([ITEM_A]),
  });
  await settle();
  fixture.authApi.emit(authState("signed_out"));
  assert.equal(fixture.history.getState().items.length, 0);
  assert.equal(element(fixture, "myContributionsList").children.length, 0);
  assert.equal(element(fixture, "myContributionsSection").hidden, true);
});


test("account change clears old items before loading the next account", async () => {
  const next = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? historyPage([ITEM_A]) : next.promise),
  });
  await settle();
  fixture.authApi.emit(authState("signed_in", USER_B));
  assert.equal(fixture.history.getState().items.length, 0);
  assert.equal(element(fixture, "myContributionsStatus").hidden, false);
  assert.deepEqual(fixture.contributionsApi.calls.at(-1), { limit: 10, offset: 0 });
});


test("User A response cannot render for User B", async () => {
  const first = deferred();
  const second = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? first.promise : second.promise),
  });
  fixture.authApi.emit(authState("signed_in", USER_B));
  first.resolve(historyPage([ITEM_A]));
  await settle();
  assert.equal(fixture.history.getState().items.length, 0);
  second.resolve(historyPage([ITEM_B]));
  await settle();
  assert.equal(fixture.history.getState().items[0].id, ITEM_B.id);
});


test("response after sign-out is ignored", async () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });
  fixture.authApi.emit(authState("signed_out"));
  request.resolve(historyPage([ITEM_A]));
  await settle();
  assert.equal(fixture.history.getState().items.length, 0);
  assert.equal(element(fixture, "myContributionsSection").hidden, true);
});


test("response after destruction is ignored", async () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });
  fixture.history.destroyMyContributions();
  request.resolve(historyPage([ITEM_A]));
  await settle();
  assert.equal(fixture.history.getState().items.length, 0);
});


test("initial loading state uses the polite live region", () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });
  assert.equal(element(fixture, "myContributionsStatus").hidden, false);
  assert.equal(
    element(fixture, "myContributionsStatus").textContent,
    "Loading your contributions…",
  );
  assert.equal(element(fixture, "myContributionsEmpty").hidden, true);
});


test("empty response shows the friendly empty state", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();
  assert.equal(element(fixture, "myContributionsEmpty").hidden, false);
  assert.equal(element(fixture, "myContributionsStatus").hidden, true);
  assert.equal(element(fixture, "myContributionsList").hidden, true);
});


test("initial failure shows a safe error and retry control", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => Promise.reject({ message: SECRET, code: "SERVER_SECRET" }),
  });
  await settle();
  assert.equal(element(fixture, "myContributionsError").hidden, false);
  assert.equal(
    element(fixture, "myContributionsErrorMessage").textContent,
    "We could not load your contributions.",
  );
  assert.equal(renderedText(fixture).includes(SECRET), false);
});


test("contribution response renders one keyboard-focusable card", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([ITEM_A]),
  });
  await settle();
  const card = element(fixture, "myContributionsList").children[0];
  assert.equal(card.tagName, "LI");
  assert.equal(card.tabIndex, 0);
  assert.match(card.textContent, /Guided recording/);
});


test("sentence text is assigned as text and remains safely wrapped content", async () => {
  const unsafeLookingText = "<img src=x onerror=alert(1)> هر غږ";
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([{ ...ITEM_A, sentenceText: unsafeLookingText }]),
  });
  await settle();
  assert.match(renderedText(fixture), /<img src=x onerror=alert\(1\)> هر غږ/);
  assert.equal(element(fixture, "myContributionsList").children.length, 1);
});


test("language is rendered with a user-friendly label", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([ITEM_A]),
  });
  await settle();
  assert.match(renderedText(fixture), /LanguagePashto/);
});


test("duration is rendered with one useful decimal place", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([ITEM_A]),
  });
  await settle();
  assert.match(renderedText(fixture), /Duration7\.4 seconds/);
  assert.equal(formatContributionDuration(8), "8 seconds");
});


test("submitted timestamp is formatted through the browser locale", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([ITEM_A]),
  });
  await settle();
  assert.match(renderedText(fixture), /SubmittedJul 15, 2026/);
  assert.equal(renderedText(fixture).includes(ITEM_A.createdAt), false);
});


test("unknown contribution type uses a safe label", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([{ ...ITEM_A, contributionType: "future_mode" }]),
  });
  await settle();
  assert.match(renderedText(fixture), /Voice contribution/);
  assert.equal(renderedText(fixture).includes("future_mode"), false);
  assert.equal(formatContributionType("open_recording"), "Open recording");
});


test("invalid timestamp uses a safe fallback without crashing", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([{ ...ITEM_A, createdAt: "not-a-date" }]),
  });
  await settle();
  assert.match(renderedText(fixture), /Submission date unavailable/);
  assert.equal(formatContributionDate("not-a-date"), "Submission date unavailable");
});


test("null duration is omitted and never displays NaN", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([ITEM_B]),
  });
  await settle();
  assert.equal(renderedText(fixture).includes("Duration"), false);
  assert.equal(renderedText(fixture).includes("NaN"), false);
});


test("user and profile identifiers are removed from state and rendering", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () =>
      historyPage([{ ...ITEM_A, userId: USER_A, profileId: USER_B }]),
  });
  await settle();
  const serialized = JSON.stringify(fixture.history.getState());
  assert.equal(serialized.includes(USER_A), false);
  assert.equal(serialized.includes(USER_B), false);
  assert.equal(renderedText(fixture).includes(USER_A), false);
});


test("storage paths are removed from state and rendering", async () => {
  const storagePath = "/absolute/private/audio/recording.webm";
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([{ ...ITEM_A, storagePath, audioStorageKey: storagePath }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.history.getState()).includes(storagePath), false);
  assert.equal(renderedText(fixture).includes(storagePath), false);
});


test("tokens are removed from state and rendering", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () =>
      historyPage([{ ...ITEM_A, accessToken: SECRET, refreshToken: SECRET }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.history.getState()).includes(SECRET), false);
  assert.equal(renderedText(fixture).includes(SECRET), false);
});


test("open recording renders its topic, filename, and MIME type", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([ITEM_B]),
  });
  await settle();
  assert.match(renderedText(fixture), /Open recording/);
  assert.match(renderedText(fixture), /TopicA village story/);
  assert.match(renderedText(fixture), /Filestory\.ogg/);
  assert.match(renderedText(fixture), /Formataudio\/ogg/);
});


test("load more uses the number of loaded items as its offset", async () => {
  const next = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1 ? historyPage([ITEM_A], { total: 2 }) : next.promise,
  });
  await settle();
  element(fixture, "loadMoreContributionsButton").dispatch("click");
  assert.deepEqual(fixture.contributionsApi.calls.at(-1), { limit: 10, offset: 1 });
});


test("load more appends new items", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? historyPage([ITEM_A], { total: 2 })
        : historyPage([ITEM_B], { total: 2, offset: 1 }),
  });
  await settle();
  element(fixture, "loadMoreContributionsButton").dispatch("click");
  await settle();
  assert.deepEqual(
    fixture.history.getState().items.map((item) => item.id),
    [ITEM_A.id, ITEM_B.id],
  );
});


test("duplicate contribution IDs are removed while appending", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? historyPage([ITEM_A], { total: 2 })
        : historyPage([ITEM_A, ITEM_B], { total: 2, offset: 1 }),
  });
  await settle();
  element(fixture, "loadMoreContributionsButton").dispatch("click");
  await settle();
  assert.deepEqual(
    fixture.history.getState().items.map((item) => item.id),
    [ITEM_A.id, ITEM_B.id],
  );
});


test("load more hides after all results are loaded", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? historyPage([ITEM_A], { total: 2 })
        : historyPage([ITEM_B], { total: 2, offset: 1 }),
  });
  await settle();
  element(fixture, "loadMoreContributionsButton").dispatch("click");
  await settle();
  assert.equal(element(fixture, "loadMoreContributionsButton").hidden, true);
});


test("double load-more is prevented while the request is pending", async () => {
  const next = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1 ? historyPage([ITEM_A], { total: 2 }) : next.promise,
  });
  await settle();
  element(fixture, "loadMoreContributionsButton").dispatch("click");
  element(fixture, "loadMoreContributionsButton").dispatch("click");
  assert.equal(fixture.contributionsApi.calls.length, 2);
  assert.equal(element(fixture, "loadMoreContributionsButton").disabled, true);
  assert.equal(element(fixture, "loadMoreContributionsButton").textContent, "Loading…");
});


test("load-more failure preserves current items", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? historyPage([ITEM_A], { total: 2 })
        : Promise.reject({ code: "NETWORK_ERROR" }),
  });
  await settle();
  element(fixture, "loadMoreContributionsButton").dispatch("click");
  await settle();
  assert.equal(fixture.history.getState().items[0].id, ITEM_A.id);
  assert.equal(element(fixture, "myContributionsLoadMoreError").hidden, false);
  assert.equal(element(fixture, "loadMoreContributionsButton").textContent, "Retry load more");
});


test("load-more retry requests the same offset and can recover", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => {
      if (call === 1) return historyPage([ITEM_A], { total: 2 });
      if (call === 2) return Promise.reject({ code: "NETWORK_ERROR" });
      return historyPage([ITEM_B], { total: 2, offset: 1 });
    },
  });
  await settle();
  element(fixture, "loadMoreContributionsButton").dispatch("click");
  await settle();
  element(fixture, "loadMoreContributionsButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.contributionsApi.calls.at(-1), { limit: 10, offset: 1 });
  assert.equal(fixture.history.getState().items.length, 2);
});


test("refresh resets pagination to offset zero", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? historyPage([ITEM_A], { total: 2 })
        : historyPage([ITEM_B], { total: 1 }),
  });
  await settle();
  element(fixture, "refreshContributionsButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.contributionsApi.calls.at(-1), { limit: 10, offset: 0 });
});


test("refresh replaces old items instead of appending", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1 ? historyPage([ITEM_A]) : historyPage([ITEM_B]),
  });
  await settle();
  element(fixture, "refreshContributionsButton").dispatch("click");
  await settle();
  assert.deepEqual(
    fixture.history.getState().items.map((item) => item.id),
    [ITEM_B.id],
  );
});


test("retry calls the same first-page refresh behavior", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? Promise.reject({ code: "NETWORK_ERROR" })
        : historyPage([ITEM_A]),
  });
  await settle();
  element(fixture, "retryContributionsButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.contributionsApi.calls.at(-1), { limit: 10, offset: 0 });
  assert.equal(fixture.history.getState().items.length, 1);
});


test("duplicate refresh requests are prevented", async () => {
  const refresh = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? historyPage([ITEM_A]) : refresh.promise),
  });
  await settle();
  element(fixture, "refreshContributionsButton").dispatch("click");
  element(fixture, "refreshContributionsButton").dispatch("click");
  assert.equal(fixture.contributionsApi.calls.length, 2);
  assert.equal(element(fixture, "refreshContributionsButton").disabled, true);
});


test("contribution-created event refreshes the first page", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1 ? historyPage([ITEM_A]) : historyPage([ITEM_B, ITEM_A]),
  });
  await settle();
  fixture.eventTarget.dispatch(CONTRIBUTION_CREATED_EVENT);
  await settle();
  assert.deepEqual(fixture.contributionsApi.calls.at(-1), { limit: 10, offset: 0 });
  assert.equal(fixture.history.getState().items[0].id, ITEM_B.id);
});


test("contribution-created event after sign-out does nothing", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([ITEM_A]),
  });
  await settle();
  fixture.authApi.emit(authState("signed_out"));
  fixture.eventTarget.dispatch(CONTRIBUTION_CREATED_EVENT);
  await settle();
  assert.equal(fixture.contributionsApi.calls.length, 1);
});


test("contribution-created event after destruction does nothing", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([ITEM_A]),
  });
  await settle();
  fixture.history.destroyMyContributions();
  fixture.eventTarget.dispatch(CONTRIBUTION_CREATED_EVENT);
  await settle();
  assert.equal(fixture.contributionsApi.calls.length, 1);
});


test("contribution-created event details are never stored or rendered", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => historyPage([ITEM_A]),
  });
  await settle();
  fixture.eventTarget.dispatch(CONTRIBUTION_CREATED_EVENT, {
    accessToken: SECRET,
    refreshToken: SECRET,
    userId: USER_A,
  });
  await settle();
  assert.equal(JSON.stringify(fixture.history.getState()).includes(SECRET), false);
  assert.equal(renderedText(fixture).includes(SECRET), false);
});


test("contribution-created dispatcher emits a detail-free event", () => {
  const events = [];
  class SafeEvent {
    constructor(type) {
      this.type = type;
    }
  }
  const dispatched = dispatchContributionCreated({
    eventTarget: { dispatchEvent: (event) => events.push(event) },
    EventConstructor: SafeEvent,
  });
  assert.equal(dispatched, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, CONTRIBUTION_CREATED_EVENT);
  assert.equal("detail" in events[0], false);
});


test("event listener is removed during destruction", () => {
  const fixture = createFixture();
  assert.equal(
    fixture.eventTarget.listeners.get(CONTRIBUTION_CREATED_EVENT)?.size,
    1,
  );
  fixture.history.destroyMyContributions();
  assert.equal(
    fixture.eventTarget.listeners.get(CONTRIBUTION_CREATED_EVENT)?.size,
    0,
  );
  assert.equal(fixture.eventTarget.removals, 1);
});


test("authentication listener is removed during destruction", () => {
  const fixture = createFixture();
  fixture.history.destroyMyContributions();
  assert.equal(fixture.authApi.calls.unsubscriptions, 1);
});


test("repeated initialization and destruction are safe", () => {
  const fixture = createFixture();
  assert.equal(fixture.history.initializeMyContributions(), true);
  assert.equal(fixture.authApi.calls.subscriptions, 1);
  fixture.history.destroyMyContributions();
  fixture.history.destroyMyContributions();
  assert.equal(fixture.authApi.calls.unsubscriptions, 1);
  assert.equal(fixture.eventTarget.removals, 1);
});


test("HTTP 401 clears history and reuses auth verification", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => Promise.reject({ code: "INVALID_ACCESS_TOKEN", status: 401 }),
  });
  await settle();
  assert.equal(fixture.history.getState().items.length, 0);
  assert.equal(element(fixture, "myContributionsSection").hidden, true);
  assert.equal(fixture.authApi.calls.verify, 1);
});
