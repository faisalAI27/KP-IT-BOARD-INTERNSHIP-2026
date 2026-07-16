import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  ACCOUNT_SECTION,
  MY_CONTRIBUTIONS_SECTION,
  PRIVATE_SECTION_CHANGED_EVENT,
  PrivateNavigation,
} from "../../scripts/modules/private-navigation.js";


const USER_A = "0d5dd8f5-93df-462b-b234-a16973089092";


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
  constructor() {
    this.attributes = new Map();
    this.disabled = false;
    this.focused = false;
    this.hidden = false;
    this.listeners = new Map();
    this.textContent = "";
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  focus() {
    this.focused = true;
  }

  scrollIntoView() {}
}


class FakeEventTarget extends FakeElement {
  constructor() {
    super();
    this.events = [];
  }

  dispatchEvent(event) {
    this.events.push(event);
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      listener(event);
    }
    return true;
  }
}


class SafeCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}


const IDS = [
  "authHeaderButton",
  "myContributionsNavButton",
  "accountSection",
  "accountSectionTitle",
  "myContributionsPageSection",
  "myContributionsPageTitle",
  "accountSignOutButton",
  "accountSignOutButtonLabel",
  "accountSignOutStatus",
];


function createRoot() {
  const elements = new Map(IDS.map((id) => [id, new FakeElement()]));
  const publicLink = new FakeElement();
  return {
    elements,
    publicLink,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll(selector) {
      return selector === "[data-public-nav]" ? [publicLink] : [];
    },
  };
}


function createAuthApi(initialState = authState("signed_out"), { failSignOut = false } = {}) {
  let state = initialState;
  const listeners = new Set();
  const calls = { signOut: 0, subscriptions: 0, unsubscriptions: 0 };
  const api = {
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
    async signOut() {
      calls.signOut += 1;
      if (failSignOut) throw new Error("secret provider failure");
      api.emit(authState("signed_out"));
      return { ok: true };
    },
    emit(nextState) {
      state = nextState;
      for (const listener of [...listeners]) listener(state);
    },
  };
  return api;
}


function createFixture({
  state = authState("signed_out"),
  hash = "#top",
  failSignOut = false,
} = {}) {
  const root = createRoot();
  const authApi = createAuthApi(state, { failSignOut });
  const eventTarget = new FakeEventTarget();
  const locationApi = { hash };
  const historyCalls = [];
  const historyApi = {
    pushState(_state, _title, nextHash) {
      historyCalls.push({ method: "push", hash: nextHash });
      locationApi.hash = nextHash;
    },
    replaceState(_state, _title, nextHash) {
      historyCalls.push({ method: "replace", hash: nextHash });
      locationApi.hash = nextHash;
    },
  };
  const navigation = new PrivateNavigation({
    root,
    authApi,
    eventTarget,
    historyApi,
    locationApi,
    CustomEventConstructor: SafeCustomEvent,
    schedule: (callback) => callback(),
  });
  assert.equal(navigation.initializePrivateNavigation(), true);
  return {
    authApi,
    eventTarget,
    historyCalls,
    locationApi,
    navigation,
    root,
  };
}


function element(fixture, id) {
  return fixture.root.elements.get(id);
}


async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}


test("header contains separate Account and My Contributions controls", async () => {
  const header = await readFile(
    new URL("../../sections/header.html", import.meta.url),
    "utf8",
  );
  assert.match(header, /id="authHeaderButton"/);
  assert.match(header, /id="myContributionsNavButton"/);
  assert.match(header, />\s*My Contributions\s*</);
  assert.doesNotMatch(header, /accountPopover|target="_blank"/);
});


test("signed-out navigation hides both private sections and contributions control", () => {
  const fixture = createFixture();
  assert.equal(element(fixture, "myContributionsNavButton").hidden, true);
  assert.equal(element(fixture, "accountSection").hidden, true);
  assert.equal(element(fixture, "myContributionsPageSection").hidden, true);
});


test("signed-in navigation shows a separate My Contributions control", () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  assert.equal(element(fixture, "myContributionsNavButton").hidden, false);
  assert.equal(element(fixture, "authHeaderButton") === element(fixture, "myContributionsNavButton"), false);
});


test("Account control opens only Account and communicates current page", () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  element(fixture, "authHeaderButton").dispatch("click");
  assert.equal(element(fixture, "accountSection").hidden, false);
  assert.equal(element(fixture, "myContributionsPageSection").hidden, true);
  assert.equal(element(fixture, "authHeaderButton").getAttribute("aria-current"), "page");
  assert.equal(element(fixture, "accountSectionTitle").focused, true);
  assert.equal(fixture.locationApi.hash, "#accountSection");
});


test("My Contributions control opens only contribution history", () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  element(fixture, "myContributionsNavButton").dispatch("click");
  assert.equal(element(fixture, "accountSection").hidden, true);
  assert.equal(element(fixture, "myContributionsPageSection").hidden, false);
  assert.equal(
    element(fixture, "myContributionsNavButton").getAttribute("aria-current"),
    "page",
  );
  const event = fixture.eventTarget.events
    .filter((candidate) => candidate.type === PRIVATE_SECTION_CHANGED_EVENT)
    .at(-1);
  assert.deepEqual(event?.detail, { section: MY_CONTRIBUTIONS_SECTION });
});


test("private sections never open for signed-out users", () => {
  const fixture = createFixture();
  assert.equal(fixture.navigation.openSection(ACCOUNT_SECTION), false);
  assert.equal(fixture.navigation.openSection(MY_CONTRIBUTIONS_SECTION), false);
  assert.equal(element(fixture, "accountSection").hidden, true);
});


test("public navigation hides private sections", () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  fixture.navigation.openSection(ACCOUNT_SECTION);
  fixture.root.publicLink.dispatch("click");
  assert.equal(element(fixture, "accountSection").hidden, true);
  assert.equal(fixture.navigation.getState().currentSection, "public");
});


test("private hashes restore only for verified users", () => {
  const signedIn = createFixture({
    state: authState("signed_in", USER_A),
    hash: "#myContributionsPageSection",
  });
  assert.equal(element(signedIn, "myContributionsPageSection").hidden, false);

  const signedOut = createFixture({ hash: "#accountSection" });
  assert.equal(signedOut.locationApi.hash, "#top");
  assert.deepEqual(signedOut.historyCalls.at(-1), { method: "replace", hash: "#top" });
});


test("sign out returns to public navigation and clears private selection", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  fixture.navigation.openSection(ACCOUNT_SECTION);
  element(fixture, "accountSignOutButton").dispatch("click");
  await settle();
  assert.equal(fixture.authApi.calls.signOut, 1);
  assert.equal(fixture.locationApi.hash, "#top");
  assert.equal(element(fixture, "myContributionsNavButton").hidden, true);
  assert.equal(element(fixture, "accountSection").hidden, true);
});


test("sign-out failure stays private and renders a safe fixed error", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    failSignOut: true,
  });
  fixture.navigation.openSection(ACCOUNT_SECTION);
  element(fixture, "accountSignOutButton").dispatch("click");
  await settle();
  assert.equal(element(fixture, "accountSection").hidden, false);
  assert.equal(element(fixture, "accountSignOutStatus").hidden, false);
  assert.equal(
    element(fixture, "accountSignOutStatus").textContent,
    "Sign-out could not be completed. Please try again.",
  );
});


test("duplicate initialization and repeated destruction are safe", () => {
  const fixture = createFixture();
  assert.equal(fixture.navigation.initializePrivateNavigation(), true);
  assert.equal(fixture.authApi.calls.subscriptions, 1);
  fixture.navigation.destroyPrivateNavigation();
  fixture.navigation.destroyPrivateNavigation();
  assert.equal(fixture.authApi.calls.unsubscriptions, 1);
  assert.equal(element(fixture, "accountSection").hidden, true);
});


test("mobile navigation styles keep the private control usable", async () => {
  const css = await readFile(
    new URL("../../styles/responsive.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.nav-private-link/);
  assert.match(css, /text-align:\s*left/);
});
