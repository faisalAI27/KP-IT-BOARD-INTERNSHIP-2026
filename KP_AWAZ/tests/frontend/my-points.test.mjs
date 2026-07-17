import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  AccountScore,
  formatAccountScore,
} from "../../scripts/modules/my-points.js";
import { CONTRIBUTION_CREATED_EVENT } from "../../scripts/modules/my-contributions.js";


const USER_A = "0d5dd8f5-93df-462b-b234-a16973089092";
const USER_B = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31";
const CONTRIBUTION_ID = "22222222-2222-4222-8222-222222222222";
const SECRET = "private-token-must-not-render";
const LEDGER_ITEM = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  entryType: "approvalAward",
  pointsDelta: 1,
  contributionId: CONTRIBUTION_ID,
  createdAt: "2026-07-16T10:20:00Z",
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
    this.children = [];
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
}


const ELEMENT_IDS = [
  "accountScoreSection",
  "accountScoreValue",
  "accountScoreStatus",
  "accountScoreError",
  "accountScoreErrorMessage",
  "refreshAccountScoreButton",
  "retryAccountScoreButton",
];


function createRoot() {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, new FakeElement()]));
  elements.set("profileDisplayName", new FakeElement("input"));
  return {
    elements,
    getElementById(id) {
      return elements.get(id) ?? null;
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


function scoreResponse(balance = 0, items = []) {
  return { balance, items, total: items.length, limit: 1, offset: 0 };
}


function createPointsApi(get) {
  const calls = [];
  return {
    calls,
    async getMyPoints(pagination) {
      calls.push({ ...pagination });
      return get ? get(calls.length, pagination) : scoreResponse();
    },
  };
}


function createFixture({ state = authState("signed_out"), get } = {}) {
  const root = createRoot();
  const authApi = createAuthApi(state);
  const pointsApi = createPointsApi(get);
  const eventTarget = new FakeElement("event-target");
  const score = new AccountScore({ root, authApi, pointsApi, eventTarget });
  assert.equal(score.initializeAccountScore(), true);
  return { authApi, eventTarget, pointsApi, root, score };
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


test("Account partial contains one accessible score-only interface", async () => {
  const html = await readFile(
    new URL("../../sections/account.html", import.meta.url),
    "utf8",
  );
  for (const id of ELEMENT_IDS) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1);
  }
  assert.match(html, /id="accountScoreStatus"[\s\S]*aria-live="polite"/);
  assert.match(
    html,
    /Your contribution score includes only recordings approved by an administrator\./,
  );
});


test("Account contains no ledger or contribution-history interface", async () => {
  const html = await readFile(
    new URL("../../sections/account.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(html, /myPointsHistory|loadMorePointsButton|myContributionsList/);
  assert.doesNotMatch(
    html,
    /Contribution approved|Approval reversed|Approved contribution credited/,
  );
});


test("signed-out state hides score and makes no request", async () => {
  const fixture = createFixture();
  await settle();
  assert.equal(element(fixture, "accountScoreSection").hidden, true);
  assert.equal(fixture.pointsApi.calls.length, 0);
});


test("authentication-loading state makes no score request", async () => {
  const fixture = createFixture({ state: authState("loading") });
  await settle();
  assert.equal(fixture.pointsApi.calls.length, 0);
});


test("verified login requests only one ledger row for the top-level balance", () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });
  assert.deepEqual(fixture.pointsApi.calls, [{ limit: 1, offset: 0 }]);
  assert.equal(element(fixture, "accountScoreSection").hidden, false);
});


test("only the backend-provided balance is stored and rendered", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => scoreResponse(7, [{ ...LEDGER_ITEM, accessToken: SECRET }]),
  });
  await settle();
  assert.deepEqual(fixture.score.getState(), {
    status: "loaded",
    balance: 7,
    error: null,
  });
  assert.equal(element(fixture, "accountScoreValue").textContent, "7 points");
  assert.equal(renderedText(fixture).includes(LEDGER_ITEM.entryType), false);
  assert.equal(renderedText(fixture).includes(CONTRIBUTION_ID), false);
  assert.equal(renderedText(fixture).includes(SECRET), false);
});


test("score wording handles zero, singular, plural, and negative zero", () => {
  assert.equal(formatAccountScore(0), "0 points");
  assert.equal(formatAccountScore(-0), "0 points");
  assert.equal(formatAccountScore(1), "1 point");
  assert.equal(formatAccountScore(2), "2 points");
});


test("sign-out clears and hides the score", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => scoreResponse(3, [LEDGER_ITEM]),
  });
  await settle();
  fixture.authApi.emit(authState("signed_out"));
  assert.equal(fixture.score.getState().balance, 0);
  assert.equal(element(fixture, "accountScoreValue").textContent, "0 points");
  assert.equal(element(fixture, "accountScoreSection").hidden, true);
});


test("account change clears the previous balance before loading", async () => {
  const next = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? scoreResponse(5) : next.promise),
  });
  await settle();
  fixture.authApi.emit(authState("signed_in", USER_B));
  assert.equal(fixture.score.getState().balance, 0);
  assert.deepEqual(fixture.pointsApi.calls.at(-1), { limit: 1, offset: 0 });
});


test("User A response cannot overwrite User B score", async () => {
  const first = deferred();
  const second = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? first.promise : second.promise),
  });
  fixture.authApi.emit(authState("signed_in", USER_B));
  first.resolve(scoreResponse(99));
  await settle();
  assert.equal(fixture.score.getState().balance, 0);
  second.resolve(scoreResponse(2));
  await settle();
  assert.equal(fixture.score.getState().balance, 2);
});


test("response after sign-out is ignored", async () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });
  fixture.authApi.emit(authState("signed_out"));
  request.resolve(scoreResponse(8));
  await settle();
  assert.equal(fixture.score.getState().balance, 0);
});


test("response after destruction is ignored", async () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });
  fixture.score.destroyAccountScore();
  request.resolve(scoreResponse(8));
  await settle();
  assert.equal(fixture.score.getState().balance, 0);
});


test("loading and refreshing use the score live region", async () => {
  const refresh = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? scoreResponse(3) : refresh.promise),
  });
  await settle();
  element(fixture, "refreshAccountScoreButton").dispatch("click");
  assert.equal(element(fixture, "accountScoreStatus").hidden, false);
  assert.equal(
    element(fixture, "accountScoreStatus").textContent,
    "Refreshing your score…",
  );
});


test("refresh replaces the score using limit one", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => scoreResponse(call === 1 ? 2 : 4),
  });
  await settle();
  element(fixture, "refreshAccountScoreButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.pointsApi.calls.at(-1), { limit: 1, offset: 0 });
  assert.equal(fixture.score.getState().balance, 4);
});


test("contribution-created event refreshes score from backend without optimism", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => scoreResponse(call === 1 ? 4 : 4),
  });
  await settle();

  fixture.eventTarget.dispatch(CONTRIBUTION_CREATED_EVENT);
  assert.equal(fixture.score.getState().balance, 4);
  await settle();

  assert.equal(fixture.pointsApi.calls.length, 2);
  assert.equal(fixture.score.getState().balance, 4);
});


test("submission event during score loading queues one backend refresh", async () => {
  const first = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? first.promise : scoreResponse(0)),
  });

  fixture.eventTarget.dispatch(CONTRIBUTION_CREATED_EVENT);
  fixture.eventTarget.dispatch(CONTRIBUTION_CREATED_EVENT);
  assert.equal(fixture.pointsApi.calls.length, 1);
  first.resolve(scoreResponse(0));
  await settle();

  assert.equal(fixture.pointsApi.calls.length, 2);
});


test("duplicate score refresh requests are prevented", async () => {
  const refresh = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? scoreResponse(2) : refresh.promise),
  });
  await settle();
  element(fixture, "refreshAccountScoreButton").dispatch("click");
  element(fixture, "refreshAccountScoreButton").dispatch("click");
  assert.equal(fixture.pointsApi.calls.length, 2);
});


test("refresh failure preserves the last balance and exposes retry", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? scoreResponse(5)
        : Promise.reject({ code: "NETWORK_ERROR" }),
  });
  await settle();
  element(fixture, "refreshAccountScoreButton").dispatch("click");
  await settle();
  assert.equal(fixture.score.getState().balance, 5);
  assert.equal(element(fixture, "accountScoreError").hidden, false);
  assert.equal(renderedText(fixture).includes(SECRET), false);
});


test("retry recovers an initial score failure", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? Promise.reject({ message: SECRET, code: "UNKNOWN_SECRET" })
        : scoreResponse(1),
  });
  await settle();
  assert.equal(element(fixture, "accountScoreErrorMessage").textContent, "We could not load your score.");
  element(fixture, "retryAccountScoreButton").dispatch("click");
  await settle();
  assert.equal(fixture.score.getState().balance, 1);
  assert.equal(renderedText(fixture).includes(SECRET), false);
});


test("score failures do not alter profile fields", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => Promise.reject({ code: "NETWORK_ERROR" }),
  });
  element(fixture, "profileDisplayName").value = "Safe profile";
  await settle();
  assert.equal(element(fixture, "profileDisplayName").value, "Safe profile");
});


test("HTTP 401 clears score and delegates session verification", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => Promise.reject({ code: "INVALID_ACCESS_TOKEN", status: 401 }),
  });
  await settle();
  assert.equal(fixture.score.getState().balance, 0);
  assert.equal(element(fixture, "accountScoreSection").hidden, true);
  assert.equal(fixture.authApi.calls.verify, 1);
});


test("duplicate initialization and repeated destruction are safe", () => {
  const fixture = createFixture();
  assert.equal(fixture.score.initializeAccountScore(), true);
  assert.equal(fixture.authApi.calls.subscriptions, 1);
  fixture.score.destroyAccountScore();
  fixture.score.destroyAccountScore();
  assert.equal(fixture.authApi.calls.unsubscriptions, 1);
});
