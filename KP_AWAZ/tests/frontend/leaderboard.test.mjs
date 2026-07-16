import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  Leaderboard,
  formatApprovedContributionCount,
  formatLeaderboardRank,
} from "../../scripts/modules/leaderboard.js";


const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const SECRET = "private-token-must-not-render";
const AUDIO_PATH = "/private/audio/recording.webm";
const ENTRY_A = Object.freeze({
  rank: 1,
  displayName: "Faisal Imran",
  approvedContributions: 3,
});
const ENTRY_B = Object.freeze({
  rank: 2,
  displayName: "Another Contributor",
  approvedContributions: 1,
});


class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.className = "";
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
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
  "leaderboardSection",
  "leaderboardStatus",
  "leaderboardSummary",
  "leaderboardList",
  "leaderboardEmpty",
  "leaderboardError",
  "leaderboardErrorMessage",
  "retryLeaderboardButton",
  "refreshLeaderboardButton",
  "loadMoreLeaderboardButton",
  "leaderboardLoadMoreError",
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


function leaderboardPage(items = [], { total = items.length, offset = 0 } = {}) {
  return { items, total, limit: 20, offset };
}


function createLeaderboardApi(get) {
  const calls = [];
  return {
    calls,
    async getPublicLeaderboard(pagination) {
      calls.push({ ...pagination });
      return get ? get(calls.length, pagination) : leaderboardPage([]);
    },
  };
}


function createFixture({ get } = {}) {
  const root = createRoot();
  const leaderboardApi = createLeaderboardApi(get);
  const leaderboard = new Leaderboard({ root, leaderboardApi });
  assert.equal(leaderboard.initializeLeaderboard(), true);
  return { leaderboard, leaderboardApi, root };
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


test("leaderboard partial is public, semantic, and accessible", async () => {
  const [html, index, header] = await Promise.all([
    readFile(new URL("../../sections/leaderboard.html", import.meta.url), "utf8"),
    readFile(new URL("../../index.html", import.meta.url), "utf8"),
    readFile(new URL("../../sections/header.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<section[\s\S]*id="leaderboard"/);
  assert.match(html, /<table class="leaderboard-table"/);
  assert.match(html, /<thead>[\s\S]*<th scope="col">Rank<\/th>/);
  assert.match(html, /<th scope="col">Contributor<\/th>/);
  assert.match(html, /<th scope="col">Approved contributions<\/th>/);
  assert.match(html, /<tbody id="leaderboardList"/);
  assert.match(html, /id="leaderboardStatus"[\s\S]*aria-live="polite"/);
  assert.match(index, /sections\/leaderboard\.html/);
  assert.match(header, /href="#leaderboard"[^>]*>Leaderboard/);
  assert.equal(html.includes("authDialog"), false);
});


test("leaderboard loads without any authentication dependency", () => {
  const request = deferred();
  const fixture = createFixture({ get: () => request.promise });
  assert.deepEqual(fixture.leaderboardApi.calls, [{ limit: 20, offset: 0 }]);
  assert.equal("authApi" in fixture, false);
});


test("leaderboard loading state appears", () => {
  const fixture = createFixture({ get: () => deferred().promise });
  assert.equal(element(fixture, "leaderboardStatus").hidden, false);
  assert.equal(element(fixture, "leaderboardStatus").textContent, "Loading leaderboard…");
  assert.equal(element(fixture, "refreshLeaderboardButton").disabled, true);
  assert.equal(element(fixture, "leaderboardSection").getAttribute("aria-busy"), "true");
});


test("valid public leaderboard entries render", async () => {
  const fixture = createFixture({ get: () => leaderboardPage([ENTRY_A, ENTRY_B]) });
  await settle();
  assert.equal(element(fixture, "leaderboardList").children.length, 2);
  assert.equal(element(fixture, "leaderboardList").children[0].tagName, "TR");
  assert.match(renderedText(fixture), /Faisal Imran/);
  assert.match(renderedText(fixture), /Another Contributor/);
});


test("rank renders from the backend instead of list position", async () => {
  const fixture = createFixture({
    get: () => leaderboardPage([{ ...ENTRY_A, rank: 4 }]),
  });
  await settle();
  assert.match(renderedText(fixture), /#4/);
  assert.equal(renderedText(fixture).includes("#1"), false);
  assert.equal(formatLeaderboardRank(4), "#4");
});


test("tied backend ranks render correctly", async () => {
  const fixture = createFixture({
    get: () =>
      leaderboardPage([
        ENTRY_A,
        { ...ENTRY_A, displayName: "Second Person" },
        { ...ENTRY_B, rank: 2 },
      ]),
  });
  await settle();
  const ranks = element(fixture, "leaderboardList").children.map(
    (entry) => entry.children[0].textContent,
  );
  assert.deepEqual(ranks, ["#1", "#1", "#2"]);
});


test("leaderboard rows use compact badges and bold contributor-name cells", async () => {
  const fixture = createFixture({ get: () => leaderboardPage([ENTRY_A]) });
  await settle();
  const row = element(fixture, "leaderboardList").children[0];
  assert.equal(row.children[0].tagName, "TD");
  assert.equal(row.children[0].children[0].className, "leaderboard-rank-badge");
  assert.equal(row.children[1].tagName, "TD");
  assert.equal(
    row.children[1].children[0].className,
    "leaderboard-contributor-name",
  );
  assert.equal(row.children[2].tagName, "TD");
  assert.equal(row.children[2].className, "leaderboard-approved-count");
});


test("duplicate public display names remain separate rows", async () => {
  const fixture = createFixture({
    get: () => leaderboardPage([ENTRY_A, { ...ENTRY_A }]),
  });
  await settle();
  assert.equal(element(fixture, "leaderboardList").children.length, 2);
  assert.equal(renderedText(fixture).match(/Faisal Imran/g)?.length, 2);
});


test("approved contribution count uses singular wording", async () => {
  const fixture = createFixture({ get: () => leaderboardPage([ENTRY_B]) });
  await settle();
  assert.match(renderedText(fixture), /1 approved contribution/);
  assert.equal(formatApprovedContributionCount(1), "1 approved contribution");
});


test("approved contribution count uses plural wording", async () => {
  const fixture = createFixture({ get: () => leaderboardPage([ENTRY_A]) });
  await settle();
  assert.match(renderedText(fixture), /3 approved contributions/);
  assert.equal(formatApprovedContributionCount(3), "3 approved contributions");
});


test("empty public leaderboard state renders", async () => {
  const fixture = createFixture();
  await settle();
  assert.equal(element(fixture, "leaderboardEmpty").hidden, false);
  assert.equal(element(fixture, "leaderboardList").hidden, true);
  assert.equal(element(fixture, "leaderboardStatus").hidden, true);
});


test("initial leaderboard error renders a safe Retry state", async () => {
  const fixture = createFixture({
    get: () => Promise.reject({ code: "INTERNAL_SECRET", message: SECRET }),
  });
  await settle();
  assert.equal(element(fixture, "leaderboardError").hidden, false);
  assert.equal(
    element(fixture, "leaderboardErrorMessage").textContent,
    "We could not load the leaderboard.",
  );
  assert.equal(renderedText(fixture).includes(SECRET), false);
});


test("Retry reloads the first leaderboard page", async () => {
  const fixture = createFixture({
    get: (call) =>
      call === 1
        ? Promise.reject({ code: "NETWORK_ERROR" })
        : leaderboardPage([ENTRY_A]),
  });
  await settle();
  element(fixture, "retryLeaderboardButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.leaderboardApi.calls.at(-1), { limit: 20, offset: 0 });
  assert.equal(fixture.leaderboard.getState().items.length, 1);
});


test("Refresh resets leaderboard offset to zero", async () => {
  const fixture = createFixture({ get: () => leaderboardPage([ENTRY_A]) });
  await settle();
  element(fixture, "refreshLeaderboardButton").dispatch("click");
  await settle();
  assert.deepEqual(fixture.leaderboardApi.calls.at(-1), { limit: 20, offset: 0 });
});


test("Refresh replaces current leaderboard entries", async () => {
  const fixture = createFixture({
    get: (call) =>
      call === 1 ? leaderboardPage([ENTRY_A]) : leaderboardPage([ENTRY_B]),
  });
  await settle();
  element(fixture, "refreshLeaderboardButton").dispatch("click");
  await settle();
  assert.deepEqual(
    fixture.leaderboard.getState().items.map((item) => item.displayName),
    [ENTRY_B.displayName],
  );
});


test("Refresh failure preserves existing public results", async () => {
  const fixture = createFixture({
    get: (call) =>
      call === 1
        ? leaderboardPage([ENTRY_A])
        : Promise.reject({ code: "NETWORK_ERROR" }),
  });
  await settle();
  element(fixture, "refreshLeaderboardButton").dispatch("click");
  await settle();
  assert.equal(fixture.leaderboard.getState().items[0].displayName, ENTRY_A.displayName);
  assert.equal(element(fixture, "leaderboardList").hidden, false);
  assert.equal(element(fixture, "leaderboardError").hidden, false);
});


test("duplicate Refresh requests are prevented", async () => {
  const refresh = deferred();
  const fixture = createFixture({
    get: (call) => (call === 1 ? leaderboardPage([ENTRY_A]) : refresh.promise),
  });
  await settle();
  element(fixture, "refreshLeaderboardButton").dispatch("click");
  element(fixture, "refreshLeaderboardButton").dispatch("click");
  assert.equal(fixture.leaderboardApi.calls.length, 2);
  assert.equal(element(fixture, "leaderboardStatus").textContent, "Refreshing leaderboard…");
});


test("Load more uses current leaderboard item count", async () => {
  const next = deferred();
  const fixture = createFixture({
    get: (call) =>
      call === 1 ? leaderboardPage([ENTRY_A], { total: 2 }) : next.promise,
  });
  await settle();
  element(fixture, "loadMoreLeaderboardButton").dispatch("click");
  assert.deepEqual(fixture.leaderboardApi.calls.at(-1), { limit: 20, offset: 1 });
});


test("additional leaderboard items append", async () => {
  const fixture = createFixture({
    get: (call) =>
      call === 1
        ? leaderboardPage([ENTRY_A], { total: 2 })
        : leaderboardPage([ENTRY_B], { total: 2, offset: 1 }),
  });
  await settle();
  element(fixture, "loadMoreLeaderboardButton").dispatch("click");
  await settle();
  assert.deepEqual(
    fixture.leaderboard.getState().items.map((item) => item.displayName),
    [ENTRY_A.displayName, ENTRY_B.displayName],
  );
});


test("backend ranks are preserved across leaderboard pages", async () => {
  const fixture = createFixture({
    get: (call) =>
      call === 1
        ? leaderboardPage([{ ...ENTRY_A, rank: 3 }], { total: 2 })
        : leaderboardPage([{ ...ENTRY_B, rank: 4 }], { total: 2, offset: 1 }),
  });
  await settle();
  element(fixture, "loadMoreLeaderboardButton").dispatch("click");
  await settle();
  assert.deepEqual(
    fixture.leaderboard.getState().items.map((item) => item.rank),
    [3, 4],
  );
});


test("Load more hides when all entries are loaded", async () => {
  const fixture = createFixture({ get: () => leaderboardPage([ENTRY_A]) });
  await settle();
  assert.equal(element(fixture, "loadMoreLeaderboardButton").hidden, true);
});


test("double Load more is prevented", async () => {
  const next = deferred();
  const fixture = createFixture({
    get: (call) =>
      call === 1 ? leaderboardPage([ENTRY_A], { total: 2 }) : next.promise,
  });
  await settle();
  element(fixture, "loadMoreLeaderboardButton").dispatch("click");
  element(fixture, "loadMoreLeaderboardButton").dispatch("click");
  assert.equal(fixture.leaderboardApi.calls.length, 2);
  assert.equal(element(fixture, "loadMoreLeaderboardButton").disabled, true);
  assert.equal(element(fixture, "loadMoreLeaderboardButton").textContent, "Loading…");
});


test("Load-more failure preserves existing entries and allows retry", async () => {
  const fixture = createFixture({
    get: (call) => {
      if (call === 1) return leaderboardPage([ENTRY_A], { total: 2 });
      if (call === 2) return Promise.reject({ code: "NETWORK_ERROR" });
      return leaderboardPage([ENTRY_B], { total: 2, offset: 1 });
    },
  });
  await settle();
  element(fixture, "loadMoreLeaderboardButton").dispatch("click");
  await settle();
  assert.equal(fixture.leaderboard.getState().items[0].displayName, ENTRY_A.displayName);
  assert.equal(element(fixture, "leaderboardLoadMoreError").hidden, false);
  element(fixture, "loadMoreLeaderboardButton").dispatch("click");
  await settle();
  assert.equal(fixture.leaderboard.getState().items.length, 2);
});


test("user IDs are not stored or rendered", async () => {
  const fixture = createFixture({
    get: () => leaderboardPage([{ ...ENTRY_A, userId: USER_ID }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.leaderboard.getState()).includes(USER_ID), false);
  assert.equal(renderedText(fixture).includes(USER_ID), false);
});


test("emails are not stored or rendered", async () => {
  const email = "private@example.com";
  const fixture = createFixture({
    get: () => leaderboardPage([{ ...ENTRY_A, email }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.leaderboard.getState()).includes(email), false);
  assert.equal(renderedText(fixture).includes(email), false);
});


test("authentication providers are not stored or rendered", async () => {
  const fixture = createFixture({
    get: () => leaderboardPage([{ ...ENTRY_A, authProvider: "private-provider" }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.leaderboard.getState()).includes("private-provider"), false);
  assert.equal(renderedText(fixture).includes("private-provider"), false);
});


test("private point balances are not stored or rendered", async () => {
  const fixture = createFixture({
    get: () => leaderboardPage([{ ...ENTRY_A, pointBalance: "99 private points" }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.leaderboard.getState()).includes("private points"), false);
  assert.equal(renderedText(fixture).includes("private points"), false);
});


test("audio metadata is not stored or rendered", async () => {
  const fixture = createFixture({
    get: () => leaderboardPage([{ ...ENTRY_A, audioPath: AUDIO_PATH }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.leaderboard.getState()).includes(AUDIO_PATH), false);
  assert.equal(renderedText(fixture).includes(AUDIO_PATH), false);
});


test("tokens are not stored or rendered", async () => {
  const fixture = createFixture({
    get: () => leaderboardPage([{ ...ENTRY_A, accessToken: SECRET }]),
  });
  await settle();
  assert.equal(JSON.stringify(fixture.leaderboard.getState()).includes(SECRET), false);
  assert.equal(renderedText(fixture).includes(SECRET), false);
});


test("duplicate leaderboard initialization is safe", () => {
  const fixture = createFixture({ get: () => deferred().promise });
  assert.equal(fixture.leaderboard.initializeLeaderboard(), true);
  assert.equal(fixture.leaderboardApi.calls.length, 1);
  assert.equal(element(fixture, "refreshLeaderboardButton").listeners.get("click").size, 1);
});


test("stale leaderboard response from an earlier lifecycle is ignored", async () => {
  const first = deferred();
  const second = deferred();
  const fixture = createFixture({
    get: (call) => (call === 1 ? first.promise : second.promise),
  });
  fixture.leaderboard.destroyLeaderboard();
  fixture.leaderboard.initializeLeaderboard();
  first.resolve(leaderboardPage([ENTRY_A]));
  await settle();
  assert.equal(fixture.leaderboard.getState().items.length, 0);
  second.resolve(leaderboardPage([ENTRY_B]));
  await settle();
  assert.equal(fixture.leaderboard.getState().items[0].displayName, ENTRY_B.displayName);
});


test("leaderboard response after destruction is ignored", async () => {
  const request = deferred();
  const fixture = createFixture({ get: () => request.promise });
  fixture.leaderboard.destroyLeaderboard();
  request.resolve(leaderboardPage([ENTRY_A]));
  await settle();
  assert.equal(fixture.leaderboard.getState().items.length, 0);
  assert.equal(element(fixture, "leaderboardList").children.length, 0);
});


test("destroy removes every leaderboard button listener", () => {
  const fixture = createFixture({ get: () => deferred().promise });
  fixture.leaderboard.destroyLeaderboard();
  for (const id of [
    "retryLeaderboardButton",
    "refreshLeaderboardButton",
    "loadMoreLeaderboardButton",
  ]) {
    assert.equal(element(fixture, id).listeners.get("click").size, 0);
  }
});


test("repeated leaderboard destruction is safe", () => {
  const fixture = createFixture({ get: () => deferred().promise });
  fixture.leaderboard.destroyLeaderboard();
  fixture.leaderboard.destroyLeaderboard();
  assert.deepEqual(fixture.leaderboard.getState(), {
    status: "idle",
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
    error: null,
  });
});


test("leaderboard mobile styles prevent horizontal overflow", async () => {
  const [css, responsive] = await Promise.all([
    readFile(new URL("../../styles/leaderboard.css", import.meta.url), "utf8"),
    readFile(new URL("../../styles/responsive.css", import.meta.url), "utf8"),
  ]);
  assert.match(css, /\.leaderboard-table-wrapper[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /\.leaderboard-contributor-name[\s\S]*font-weight:\s*700/);
  assert.match(css, /\.leaderboard-contributor-name[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.leaderboard-rank-badge[\s\S]*width:\s*36px/);
  assert.match(css, /\.leaderboard-rank-badge[\s\S]*max-width:\s*36px/);
  assert.match(responsive, /\.leaderboard-rank-badge[\s\S]*width:\s*28px/);
});


test("leaderboard loading empty and error states keep valid table markup", async () => {
  const html = await readFile(
    new URL("../../sections/leaderboard.html", import.meta.url),
    "utf8",
  );
  const table = html.match(/<table class="leaderboard-table"[\s\S]*?<\/table>/)?.[0];
  assert.ok(table);
  assert.match(table, /<thead>[\s\S]*<\/thead>/);
  assert.match(table, /<tbody id="leaderboardList" hidden><\/tbody>/);
  assert.equal(/<div[^>]*>[^<]*<tr/i.test(table), false);
  assert.match(html, /id="leaderboardStatus"/);
  assert.match(html, /id="leaderboardEmpty"/);
  assert.match(html, /id="leaderboardError"/);
});
