import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  MyPoints,
  formatPointBalance,
  formatPointDate,
  formatPointDelta,
} from "../../scripts/modules/my-points.js";


const USER_A = "0d5dd8f5-93df-462b-b234-a16973089092";
const USER_B = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31";
const PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = "private-token-must-not-render";
const AUDIO_PATH = "/private/audio/user/recording.webm";
const AWARD = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  entryType: "approvalAward",
  pointsDelta: 1,
  contributionId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-07-16T10:20:00Z",
});
const REVERSAL = Object.freeze({
  id: "33333333-3333-4333-8333-333333333333",
  entryType: "approvalReversal",
  pointsDelta: -1,
  contributionId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-07-15T09:10:00Z",
});
const BACKFILL = Object.freeze({
  id: "55555555-5555-4555-8555-555555555555",
  entryType: "approvedBackfill",
  pointsDelta: 1,
  contributionId: "66666666-6666-4666-8666-666666666666",
  createdAt: "2026-07-14T08:00:00Z",
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
    this.value = "";
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
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ target: this, type });
    }
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


const ELEMENT_IDS = [
  "myPointsSection",
  "myPointsBalance",
  "myPointsStatus",
  "myPointsHistory",
  "myPointsEmpty",
  "myPointsError",
  "myPointsErrorMessage",
  "refreshPointsButton",
  "retryPointsButton",
  "loadMorePointsButton",
  "myPointsLoadMoreError",
];


function createRoot() {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, new FakeElement()]));
  elements.set("profileDisplayName", new FakeElement("input"));
  elements.set("myContributionsList", new FakeElement("ol"));
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


function pointsPage(
  items = [],
  { balance = items.reduce((sum, item) => sum + item.pointsDelta, 0), total = items.length, offset = 0 } = {},
) {
  return { balance, items, total, limit: 20, offset };
}


function createPointsApi(get) {
  const calls = [];
  return {
    calls,
    async getMyPoints(pagination) {
      calls.push({ ...pagination });
      return get ? get(calls.length, pagination) : pointsPage([]);
    },
  };
}


function createFixture({ state = authState("signed_out"), get, locale = "en-US" } = {}) {
  const root = createRoot();
  const authApi = createAuthApi(state);
  const pointsApi = createPointsApi(get);
  const points = new MyPoints({ root, authApi, pointsApi, locale });
  assert.equal(points.initializeMyPoints(), true);
  return { authApi, pointsApi, points, root };
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


test("account partial includes accessible My Points controls once", async () => {
  const html = await readFile(
    new URL("../../sections/auth-dialog.html", import.meta.url),
    "utf8",
  );
  for (const id of ELEMENT_IDS) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1);
  }
  assert.match(html, /id="myPointsStatus"[\s\S]*aria-live="polite"/);
  assert.match(html, /id="refreshPointsButton"[\s\S]*type="button"/);
  assert.match(html, /Your private point history/);
});


test("signed-out state hides the section", async () => {
  const fixture = createFixture();
  await settle();
  assert.equal(element(fixture, "myPointsSection").hidden, true);
});


test("signed-out state does not call the API", async () => {
  const fixture = createFixture();
  await settle();
  assert.equal(fixture.pointsApi.calls.length, 0);
});


test("authentication-loading state does not call the API", async () => {
  const fixture = createFixture({ state: authState("loading") });
  await settle();
  assert.equal(fixture.pointsApi.calls.length, 0);
  assert.equal(element(fixture, "myPointsSection").hidden, true);
});


test("verified login loads points", () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });
  assert.deepEqual(fixture.pointsApi.calls, [{ limit: 20, offset: 0 }]);
  assert.equal(element(fixture, "myPointsSection").hidden, false);
});


test("restored verified session loads points", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD], { balance: 1 }),
  });
  await settle();
  assert.equal(fixture.points.getState().balance, 1);
  assert.equal(fixture.pointsApi.calls.length, 1);
});


test("sign-out clears the balance", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD], { balance: 3 }),
  });
  await settle();
  fixture.authApi.emit(authState("signed_out"));
  assert.equal(fixture.points.getState().balance, 0);
  assert.equal(element(fixture, "myPointsBalance").textContent, "0 points");
});


test("sign-out clears point history", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD]),
  });
  await settle();
  fixture.authApi.emit(authState("signed_out"));
  assert.equal(fixture.points.getState().items.length, 0);
  assert.equal(element(fixture, "myPointsHistory").children.length, 0);
});


test("account change clears old point data immediately", async () => {
  const next = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? pointsPage([AWARD]) : next.promise),
  });
  await settle();
  fixture.authApi.emit(authState("signed_in", USER_B));
  assert.equal(fixture.points.getState().balance, 0);
  assert.equal(fixture.points.getState().items.length, 0);
  assert.deepEqual(fixture.pointsApi.calls.at(-1), { limit: 20, offset: 0 });
});


test("User A response cannot render for User B", async () => {
  const first = deferred();
  const second = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? first.promise : second.promise),
  });
  fixture.authApi.emit(authState("signed_in", USER_B));
  first.resolve(pointsPage([AWARD], { balance: 9 }));
  await settle();
  assert.equal(fixture.points.getState().balance, 0);
  second.resolve(pointsPage([REVERSAL], { balance: 2 }));
  await settle();
  assert.equal(fixture.points.getState().items[0].id, REVERSAL.id);
  assert.equal(fixture.points.getState().balance, 2);
});


test("response after sign-out is ignored", async () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });
  fixture.authApi.emit(authState("signed_out"));
  request.resolve(pointsPage([AWARD], { balance: 7 }));
  await settle();
  assert.equal(fixture.points.getState().balance, 0);
  assert.equal(fixture.points.getState().items.length, 0);
});


test("response after destruction is ignored", async () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });
  fixture.points.destroyMyPoints();
  request.resolve(pointsPage([AWARD], { balance: 8 }));
  await settle();
  assert.equal(fixture.points.getState().balance, 0);
  assert.equal(fixture.points.getState().items.length, 0);
});


test("initial loading state appears in the live region", () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => deferred().promise,
  });
  assert.equal(element(fixture, "myPointsStatus").hidden, false);
  assert.equal(element(fixture, "myPointsStatus").textContent, "Loading your points…");
  assert.equal(element(fixture, "refreshPointsButton").disabled, true);
});


test("balance uses singular for one point", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD], { balance: 1 }),
  });
  await settle();
  assert.equal(element(fixture, "myPointsBalance").textContent, "1 point");
  assert.equal(formatPointBalance(1), "1 point");
});


test("balance uses plural for multiple points and avoids negative zero", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD], { balance: 3 }),
  });
  await settle();
  assert.equal(element(fixture, "myPointsBalance").textContent, "3 points");
  assert.equal(formatPointBalance(-0), "0 points");
});


test("empty point history state appears only after loading", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();
  assert.equal(element(fixture, "myPointsEmpty").hidden, false);
  assert.equal(element(fixture, "myPointsHistory").hidden, true);
});


test("approval award renders safe user-facing copy", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD]),
  });
  await settle();
  assert.match(renderedText(fixture), /Contribution approved/);
  assert.match(renderedText(fixture), /administrator approved your recording/);
  assert.equal(renderedText(fixture).includes("approvalAward"), false);
});


test("approval reversal renders safe user-facing copy", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([REVERSAL], { balance: 0 }),
  });
  await settle();
  assert.match(renderedText(fixture), /Approval reversed/);
  assert.match(renderedText(fixture), /approval decision changed/);
  assert.match(element(fixture, "myPointsHistory").children[0].className, /reversal/);
});


test("approved backfill renders safe user-facing copy", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([BACKFILL]),
  });
  await settle();
  assert.match(renderedText(fixture), /Approved contribution credited/);
  assert.match(renderedText(fixture), /previously approved contribution/);
});


test("positive delta includes a plus sign and point wording", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD]),
  });
  await settle();
  assert.match(renderedText(fixture), /\+1 point/);
  assert.equal(formatPointDelta(2), "+2 points");
});


test("negative delta includes a minus sign and point wording", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([REVERSAL], { balance: 0 }),
  });
  await settle();
  assert.match(renderedText(fixture), /-1 point/);
  assert.equal(formatPointDelta(-2), "-2 points");
});


test("point date is formatted safely through the browser locale", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD]),
  });
  await settle();
  assert.match(renderedText(fixture), /July 16, 2026/);
  assert.equal(renderedText(fixture).includes(AWARD.createdAt), false);
});


test("invalid point date uses a fallback without crashing", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([{ ...AWARD, createdAt: "not-a-date" }]),
  });
  await settle();
  assert.match(renderedText(fixture), /Date unavailable/);
  assert.equal(formatPointDate("not-a-date"), "Date unavailable");
});


test("full contribution ID is not rendered", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD]),
  });
  await settle();
  assert.equal(renderedText(fixture).includes(AWARD.contributionId), false);
});


test("user ID is neither stored in public state nor rendered", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([{ ...AWARD, userId: USER_A }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.points.getState()).includes(USER_A), false);
  assert.equal(renderedText(fixture).includes(USER_A), false);
});


test("profile ID is neither stored nor rendered", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([{ ...AWARD, profileId: PROFILE_ID }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.points.getState()).includes(PROFILE_ID), false);
  assert.equal(renderedText(fixture).includes(PROFILE_ID), false);
});


test("tokens are neither stored nor rendered", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () =>
      pointsPage([{ ...AWARD, accessToken: SECRET, refreshToken: SECRET }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.points.getState()).includes(SECRET), false);
  assert.equal(renderedText(fixture).includes(SECRET), false);
});


test("audio paths are neither stored nor rendered", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([{ ...AWARD, audioPath: AUDIO_PATH }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.points.getState()).includes(AUDIO_PATH), false);
  assert.equal(renderedText(fixture).includes(AUDIO_PATH), false);
});


test("raw metadata is neither stored nor rendered", async () => {
  const marker = "private-raw-metadata";
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([{ ...AWARD, raw: { marker } }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.points.getState()).includes(marker), false);
  assert.equal(renderedText(fixture).includes(marker), false);
});


test("refresh resets offset to zero", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD]),
  });
  await settle();
  element(fixture, "refreshPointsButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.pointsApi.calls.at(-1), { limit: 20, offset: 0 });
});


test("refresh replaces point history items", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1 ? pointsPage([AWARD]) : pointsPage([REVERSAL], { balance: 0 }),
  });
  await settle();
  element(fixture, "refreshPointsButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.points.getState().items.map((item) => item.id), [REVERSAL.id]);
});


test("refresh updates balance from the backend", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => pointsPage([AWARD], { balance: call === 1 ? 1 : 3 }),
  });
  await settle();
  element(fixture, "refreshPointsButton").dispatch("click");
  await settle();
  assert.equal(fixture.points.getState().balance, 3);
  assert.equal(element(fixture, "myPointsBalance").textContent, "3 points");
});


test("duplicate refresh requests are prevented", async () => {
  const refresh = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? pointsPage([AWARD]) : refresh.promise),
  });
  await settle();
  element(fixture, "refreshPointsButton").dispatch("click");
  element(fixture, "refreshPointsButton").dispatch("click");
  assert.equal(fixture.pointsApi.calls.length, 2);
  assert.equal(element(fixture, "refreshPointsButton").disabled, true);
  assert.equal(element(fixture, "myPointsStatus").textContent, "Refreshing…");
});


test("refresh failure preserves previous balance and history", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? pointsPage([AWARD], { balance: 3 })
        : Promise.reject({ code: "NETWORK_ERROR" }),
  });
  await settle();
  element(fixture, "refreshPointsButton").dispatch("click");
  await settle();
  assert.equal(fixture.points.getState().balance, 3);
  assert.equal(fixture.points.getState().items[0].id, AWARD.id);
  assert.equal(element(fixture, "myPointsError").hidden, false);
  assert.equal(renderedText(fixture).includes("NETWORK_ERROR"), false);
});


test("retry control invokes a first-page refresh", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? Promise.reject({ code: "NETWORK_ERROR" })
        : pointsPage([AWARD]),
  });
  await settle();
  element(fixture, "retryPointsButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.pointsApi.calls.at(-1), { limit: 20, offset: 0 });
  assert.equal(fixture.points.getState().items.length, 1);
});


test("load more uses current unique item count as offset", async () => {
  const next = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1 ? pointsPage([AWARD], { total: 2 }) : next.promise,
  });
  await settle();
  element(fixture, "loadMorePointsButton").dispatch("click");
  assert.deepEqual(fixture.pointsApi.calls.at(-1), { limit: 20, offset: 1 });
});


test("new point entries append after existing entries", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? pointsPage([AWARD], { total: 2 })
        : pointsPage([REVERSAL], { balance: 0, total: 2, offset: 1 }),
  });
  await settle();
  element(fixture, "loadMorePointsButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.points.getState().items.map((item) => item.id), [
    AWARD.id,
    REVERSAL.id,
  ]);
});


test("duplicate ledger IDs are removed while appending", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? pointsPage([AWARD], { total: 2 })
        : pointsPage([AWARD, REVERSAL], { balance: 0, total: 2, offset: 1 }),
  });
  await settle();
  element(fixture, "loadMorePointsButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.points.getState().items.map((item) => item.id), [
    AWARD.id,
    REVERSAL.id,
  ]);
});


test("load more hides when all point entries are loaded", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD]),
  });
  await settle();
  assert.equal(element(fixture, "loadMorePointsButton").hidden, true);
});


test("double load more is prevented", async () => {
  const next = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1 ? pointsPage([AWARD], { total: 2 }) : next.promise,
  });
  await settle();
  element(fixture, "loadMorePointsButton").dispatch("click");
  element(fixture, "loadMorePointsButton").dispatch("click");
  assert.equal(fixture.pointsApi.calls.length, 2);
  assert.equal(element(fixture, "loadMorePointsButton").disabled, true);
  assert.equal(element(fixture, "loadMorePointsButton").textContent, "Loading…");
});


test("load-more failure preserves existing point data", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? pointsPage([AWARD], { balance: 3, total: 2 })
        : Promise.reject({ code: "NETWORK_ERROR" }),
  });
  await settle();
  element(fixture, "loadMorePointsButton").dispatch("click");
  await settle();
  assert.equal(fixture.points.getState().balance, 3);
  assert.equal(fixture.points.getState().items[0].id, AWARD.id);
  assert.equal(element(fixture, "myPointsLoadMoreError").hidden, false);
});


test("load-more retry uses the same offset and recovers", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => {
      if (call === 1) return pointsPage([AWARD], { total: 2 });
      if (call === 2) return Promise.reject({ code: "NETWORK_ERROR" });
      return pointsPage([REVERSAL], { balance: 0, total: 2, offset: 1 });
    },
  });
  await settle();
  element(fixture, "loadMorePointsButton").dispatch("click");
  await settle();
  element(fixture, "loadMorePointsButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.pointsApi.calls.at(-1), { limit: 20, offset: 1 });
  assert.equal(fixture.points.getState().items.length, 2);
});


test("backend order is preserved across point pages", async () => {
  const newest = { ...AWARD, id: "newest" };
  const middle = { ...REVERSAL, id: "middle" };
  const oldest = { ...BACKFILL, id: "oldest" };
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? pointsPage([newest, middle], { total: 3 })
        : pointsPage([oldest], { total: 3, offset: 2 }),
  });
  await settle();
  element(fixture, "loadMorePointsButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.points.getState().items.map((item) => item.id), [
    "newest",
    "middle",
    "oldest",
  ]);
});


test("point failure does not alter profile UI state", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => Promise.reject({ code: "NETWORK_ERROR" }),
  });
  element(fixture, "profileDisplayName").value = "Existing profile value";
  await settle();
  assert.equal(element(fixture, "profileDisplayName").value, "Existing profile value");
});


test("point failure does not alter My Contributions UI", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => Promise.reject({ code: "NETWORK_ERROR" }),
  });
  element(fixture, "myContributionsList").textContent = "Existing contribution";
  await settle();
  assert.equal(element(fixture, "myContributionsList").textContent, "Existing contribution");
});


test("profile updates do not clear loaded points", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD], { balance: 3 }),
  });
  await settle();
  element(fixture, "profileDisplayName").value = "Updated display name";
  fixture.authApi.emit(authState("signed_in", USER_A));
  assert.equal(fixture.points.getState().balance, 3);
  assert.equal(fixture.points.getState().items[0].id, AWARD.id);
});


test("point refresh does not clear profile form values", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD]),
  });
  await settle();
  element(fixture, "profileDisplayName").value = "Unsaved profile value";
  element(fixture, "refreshPointsButton").dispatch("click");
  await settle();
  assert.equal(element(fixture, "profileDisplayName").value, "Unsaved profile value");
});


test("duplicate initialization does not duplicate subscriptions or listeners", () => {
  const fixture = createFixture();
  assert.equal(fixture.points.initializeMyPoints(), true);
  assert.equal(fixture.authApi.calls.subscriptions, 1);
  assert.equal(element(fixture, "refreshPointsButton").listeners.get("click").size, 1);
});


test("destroy removes authentication and button event listeners", () => {
  const fixture = createFixture();
  fixture.points.destroyMyPoints();
  assert.equal(fixture.authApi.calls.unsubscriptions, 1);
  assert.equal(element(fixture, "refreshPointsButton").listeners.get("click").size, 0);
  assert.equal(element(fixture, "retryPointsButton").listeners.get("click").size, 0);
  assert.equal(element(fixture, "loadMorePointsButton").listeners.get("click").size, 0);
});


test("destroy clears private point state", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => pointsPage([AWARD], { balance: 3 }),
  });
  await settle();
  fixture.points.destroyMyPoints();
  assert.deepEqual(fixture.points.getState(), {
    status: "idle",
    balance: 0,
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
    error: null,
  });
  assert.equal(element(fixture, "myPointsSection").hidden, true);
});


test("repeated destruction is safe", () => {
  const fixture = createFixture();
  fixture.points.destroyMyPoints();
  fixture.points.destroyMyPoints();
  assert.equal(fixture.authApi.calls.unsubscriptions, 1);
});


test("HTTP 401 clears points and reuses backend auth verification", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => Promise.reject({ code: "INVALID_ACCESS_TOKEN", status: 401 }),
  });
  await settle();
  assert.equal(fixture.points.getState().balance, 0);
  assert.equal(fixture.points.getState().items.length, 0);
  assert.equal(element(fixture, "myPointsSection").hidden, true);
  assert.equal(fixture.authApi.calls.verify, 1);
});
