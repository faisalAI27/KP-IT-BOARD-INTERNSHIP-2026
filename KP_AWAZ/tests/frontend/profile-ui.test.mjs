import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { ProfileUI } from "../../scripts/modules/profile-ui.js";


const USER_A = "0d5dd8f5-93df-462b-b234-a16973089092";
const USER_B = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31";
const PROFILE_A = Object.freeze({
  id: USER_A,
  email: "person@example.com",
  authProvider: "google",
  displayName: "Faisal Imran",
  preferredLanguage: "Pashto",
  leaderboardOptIn: false,
});


function authState(status, userId = null, overrides = {}) {
  return {
    status,
    session: null,
    backendUser: userId
      ? { id: userId, email: "person@example.com", provider: "google" }
      : null,
    error: null,
    ...overrides,
  };
}


class FakeElement {
  constructor() {
    this.checked = false;
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.options = [];
    this.reportValidityCalls = 0;
    this.textContent = "";
    this.valid = true;
    this.value = "";
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    const event = { target: this, preventDefault() {} };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  checkValidity() {
    return this.valid;
  }

  reportValidity() {
    this.reportValidityCalls += 1;
    return this.valid;
  }

  setCustomValidity() {}

  append(option) {
    this.options.push(option);
  }
}


const ELEMENT_IDS = [
  "profileSettings",
  "profileLoading",
  "profileLoadError",
  "profileLoadErrorMessage",
  "retryProfileButton",
  "profileForm",
  "profileDisplayName",
  "profileVerifiedEmail",
  "profilePreferredLanguage",
  "profileLeaderboardOptIn",
  "profileSaveButton",
  "profileSaveButtonLabel",
  "profileStatus",
];


function createRoot() {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, new FakeElement()]));
  const language = elements.get("profilePreferredLanguage");
  for (const value of ["Pashto", "Urdu", "English"]) {
    const option = new FakeElement();
    option.value = value;
    option.textContent = value;
    language.options.push(option);
  }
  return {
    elements,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement() {
      return new FakeElement();
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
      for (const listener of listeners) listener(state);
    },
  };
}


function createProfileApi({ get, update } = {}) {
  const calls = { get: 0, updates: [] };
  return {
    calls,
    async getMyProfile() {
      calls.get += 1;
      return get ? get(calls.get) : { ...PROFILE_A };
    },
    async updateMyProfile(updates) {
      calls.updates.push({ ...updates });
      return update ? update(updates, calls.updates.length) : { ...PROFILE_A, ...updates };
    },
  };
}


function createFixture({
  state = authState("signed_out"),
  get,
  update,
} = {}) {
  const root = createRoot();
  const authApi = createAuthApi(state);
  const profileApi = createProfileApi({ get, update });
  const headerCalls = [];
  const ui = new ProfileUI({
    root,
    authApi,
    profileApi,
    setHeaderProfile(userId, displayName) {
      headerCalls.push({ userId, displayName });
    },
  });
  assert.equal(ui.initProfileUI(), true);
  return { authApi, headerCalls, profileApi, root, ui };
}


function element(fixture, id) {
  return fixture.root.elements.get(id);
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


test("profile partial has associated fields, privacy copy, and live status", async () => {
  const html = await readFile(
    new URL("../../sections/account.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /<label for="profileDisplayName">Display name<\/label>/);
  assert.match(html, /id="profileDisplayName"[\s\S]*minlength="2"[\s\S]*maxlength="80"/);
  assert.match(html, /<label for="profileVerifiedEmail">Verified email<\/label>/);
  assert.match(html, /id="profileVerifiedEmail"[\s\S]*readonly/);
  assert.match(html, /<label for="profilePreferredLanguage">Preferred language<\/label>/);
  assert.match(html, /id="profilePreferredLanguage"[\s\S]*<option value="Pashto">/);
  assert.match(html, /id="profileLeaderboardOptIn"[\s\S]*type="checkbox"/);
  assert.match(html, /id="profileStatus"[\s\S]*aria-live="polite"/);
});


test("signed-out state hides settings and never loads a profile", async () => {
  const fixture = createFixture();
  await settle();

  assert.equal(element(fixture, "profileSettings").hidden, true);
  assert.equal(fixture.profileApi.calls.get, 0);
  assert.equal(fixture.ui.getProfileState().status, "idle");
});


test("authentication loading does not request a profile", async () => {
  const fixture = createFixture({ state: authState("loading") });
  await settle();

  assert.equal(fixture.profileApi.calls.get, 0);
  assert.equal(element(fixture, "profileSettings").hidden, true);
});


test("verified sign-in loads one profile and disables fields while loading", () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });

  assert.equal(fixture.profileApi.calls.get, 1);
  assert.equal(element(fixture, "profileLoading").hidden, false);
  assert.equal(element(fixture, "profileDisplayName").disabled, true);
  assert.equal(element(fixture, "profilePreferredLanguage").disabled, true);
  assert.equal(element(fixture, "profileLeaderboardOptIn").disabled, true);
  assert.equal(element(fixture, "profileSaveButton").disabled, true);
});


test("loaded profile renders all preferences and updates the header", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();

  assert.equal(element(fixture, "profileDisplayName").value, "Faisal Imran");
  assert.equal(element(fixture, "profileVerifiedEmail").value, "person@example.com");
  assert.equal(element(fixture, "profilePreferredLanguage").value, "Pashto");
  assert.equal(element(fixture, "profileLeaderboardOptIn").checked, false);
  assert.equal(element(fixture, "profileForm").hidden, false);
  assert.deepEqual(fixture.headerCalls.at(-1), {
    userId: USER_A,
    displayName: "Faisal Imran",
  });
});


test("future backend languages are retained as select options", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => ({ ...PROFILE_A, preferredLanguage: "Hindko" }),
  });
  await settle();

  assert.equal(element(fixture, "profilePreferredLanguage").value, "Hindko");
  assert.equal(
    element(fixture, "profilePreferredLanguage").options.some(
      (option) => option.value === "Hindko",
    ),
    true,
  );
});


test("null email and provider do not affect profile rendering", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => ({ ...PROFILE_A, email: null, authProvider: null }),
  });
  await settle();

  assert.equal(fixture.ui.getProfileState().profile.email, null);
  assert.equal(element(fixture, "profileVerifiedEmail").value, "");
  assert.equal(element(fixture, "profileDisplayName").value, "Faisal Imran");
});


test("profile state and rendered text exclude tokens and metadata", async () => {
  const secret = "private-token-must-not-render";
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => ({
      ...PROFILE_A,
      access_token: secret,
      app_metadata: { secret },
    }),
  });
  await settle();

  const state = JSON.stringify(fixture.ui.getProfileState());
  const rendered = [...fixture.root.elements.values()]
    .map((item) => `${item.textContent}${item.value}`)
    .join(" ");
  assert.equal(state.includes(secret), false);
  assert.equal(rendered.includes(secret), false);
});


test("load failure displays a safe retry state", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => Promise.reject({ code: "NETWORK_ERROR", message: "raw secret" }),
  });
  await settle();

  assert.equal(element(fixture, "profileLoadError").hidden, false);
  assert.equal(
    element(fixture, "profileLoadErrorMessage").textContent,
    "The KP AWAZ backend could not be reached.",
  );
  assert.equal(element(fixture, "profileForm").hidden, true);
});


test("retry starts one new profile request", async () => {
  const retryRequest = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) =>
      call === 1
        ? Promise.reject({ code: "NETWORK_ERROR" })
        : retryRequest.promise,
  });
  await settle();

  element(fixture, "retryProfileButton").dispatch("click");
  element(fixture, "retryProfileButton").dispatch("click");

  assert.equal(fixture.profileApi.calls.get, 2);
  assert.equal(element(fixture, "retryProfileButton").disabled, true);

  retryRequest.resolve({ ...PROFILE_A });
  await settle();
});


test("changed display name sends only displayName", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();
  element(fixture, "profileDisplayName").value = "  نوی نوم  ";

  element(fixture, "profileForm").dispatch("submit");
  await settle();

  assert.deepEqual(fixture.profileApi.calls.updates, [{ displayName: "نوی نوم" }]);
});


test("changed language sends only preferredLanguage", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();
  element(fixture, "profilePreferredLanguage").value = "Urdu";

  element(fixture, "profileForm").dispatch("submit");
  await settle();

  assert.deepEqual(fixture.profileApi.calls.updates, [
    { preferredLanguage: "Urdu" },
  ]);
});


test("changed privacy sends only leaderboardOptIn", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();
  element(fixture, "profileLeaderboardOptIn").checked = true;

  element(fixture, "profileForm").dispatch("submit");
  await settle();

  assert.deepEqual(fixture.profileApi.calls.updates, [
    { leaderboardOptIn: true },
  ]);
});


test("multiple changes send only changed editable fields", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();
  element(fixture, "profileDisplayName").value = "Updated Person";
  element(fixture, "profileLeaderboardOptIn").checked = true;

  element(fixture, "profileForm").dispatch("submit");
  await settle();

  assert.deepEqual(fixture.profileApi.calls.updates, [
    { displayName: "Updated Person", leaderboardOptIn: true },
  ]);
});


test("save is single-flight and disables controls", async () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    update: () => request.promise,
  });
  await settle();
  element(fixture, "profileDisplayName").value = "Updated Person";

  element(fixture, "profileForm").dispatch("submit");
  element(fixture, "profileForm").dispatch("submit");

  assert.equal(fixture.profileApi.calls.updates.length, 1);
  assert.equal(element(fixture, "profileSaveButton").disabled, true);
  assert.equal(element(fixture, "profileSaveButtonLabel").textContent, "Saving…");

  request.resolve({ ...PROFILE_A, displayName: "Updated Person" });
  await settle();
});


test("successful save replaces state, form, header, and shows feedback", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();
  element(fixture, "profileDisplayName").value = "Updated Person";

  element(fixture, "profileForm").dispatch("submit");
  await settle();

  assert.equal(fixture.ui.getProfileState().profile.displayName, "Updated Person");
  assert.equal(element(fixture, "profileDisplayName").value, "Updated Person");
  assert.equal(element(fixture, "profileStatus").textContent, "Profile saved successfully.");
  assert.equal(element(fixture, "profileSaveButton").disabled, false);
  assert.deepEqual(fixture.headerCalls.at(-1), {
    userId: USER_A,
    displayName: "Updated Person",
  });
});


test("no changes do not send PATCH and show neutral feedback", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();

  element(fixture, "profileForm").dispatch("submit");
  await settle();

  assert.equal(fixture.profileApi.calls.updates.length, 0);
  assert.equal(element(fixture, "profileStatus").textContent, "No profile changes to save.");
  assert.equal(element(fixture, "profileStatus").dataset.tone, "info");
});


test("invalid form does not send PATCH", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();
  element(fixture, "profileDisplayName").value = "A";
  element(fixture, "profileForm").valid = false;

  element(fixture, "profileForm").dispatch("submit");
  await settle();

  assert.equal(fixture.profileApi.calls.updates.length, 0);
  assert.equal(element(fixture, "profileForm").reportValidityCalls, 1);
});


test("save failure preserves entered values and re-enables save", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    update: () =>
      Promise.reject({ code: "PROFILE_PERSISTENCE_FAILED", message: "raw" }),
  });
  await settle();
  element(fixture, "profileDisplayName").value = "Unsent Name";

  element(fixture, "profileForm").dispatch("submit");
  await settle();

  assert.equal(element(fixture, "profileDisplayName").value, "Unsent Name");
  assert.equal(element(fixture, "profileSaveButton").disabled, false);
  assert.equal(
    element(fixture, "profileStatus").textContent,
    "The profile could not be saved. Please try again.",
  );
  assert.equal(fixture.ui.getProfileState().profile.displayName, "Faisal Imran");
});


test("sign-out clears profile state, form, settings, and header name", async () => {
  const fixture = createFixture({ state: authState("signed_in", USER_A) });
  await settle();

  fixture.authApi.emit(authState("signed_out"));

  assert.equal(fixture.ui.getProfileState().profile, null);
  assert.equal(element(fixture, "profileDisplayName").value, "");
  assert.equal(element(fixture, "profileLeaderboardOptIn").checked, false);
  assert.equal(element(fixture, "profileSettings").hidden, true);
  assert.deepEqual(fixture.headerCalls.at(-1), { userId: null, displayName: null });
});


test("User A response cannot overwrite User B profile", async () => {
  const first = deferred();
  const second = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: (call) => (call === 1 ? first.promise : second.promise),
  });

  fixture.authApi.emit(authState("signed_in", USER_B));
  assert.equal(fixture.profileApi.calls.get, 2);

  first.resolve({ ...PROFILE_A });
  await settle();
  assert.equal(fixture.ui.getProfileState().profile, null);

  second.resolve({
    ...PROFILE_A,
    id: USER_B,
    email: "other@example.com",
    displayName: "User B",
  });
  await settle();

  assert.equal(fixture.ui.getProfileState().profile.id, USER_B);
  assert.equal(element(fixture, "profileDisplayName").value, "User B");
});


test("response after sign-out is ignored", async () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });

  fixture.authApi.emit(authState("signed_out"));
  request.resolve({ ...PROFILE_A });
  await settle();

  assert.equal(fixture.ui.getProfileState().profile, null);
  assert.equal(element(fixture, "profileSettings").hidden, true);
});


test("destroy ignores pending responses and removes listeners", async () => {
  const request = deferred();
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () => request.promise,
  });

  fixture.ui.destroyProfileUI();
  element(fixture, "profileForm").dispatch("submit");
  request.resolve({ ...PROFILE_A });
  await settle();

  assert.equal(fixture.ui.getProfileState().profile, null);
  assert.equal(fixture.profileApi.calls.updates.length, 0);
  assert.equal(fixture.authApi.calls.unsubscriptions, 1);
});


test("duplicate initialization creates one subscription", () => {
  const fixture = createFixture();

  assert.equal(fixture.ui.initProfileUI(), true);
  assert.equal(fixture.authApi.calls.subscriptions, 1);
});


test("repeated destruction is safe and does not sign out", () => {
  const fixture = createFixture();

  fixture.ui.destroyProfileUI();
  fixture.ui.destroyProfileUI();

  assert.equal(fixture.authApi.calls.unsubscriptions, 1);
  assert.equal("signOut" in fixture.authApi.calls, false);
});


test("profile HTTP 401 clears state and delegates session verification", async () => {
  const fixture = createFixture({
    state: authState("signed_in", USER_A),
    get: () =>
      Promise.reject({ code: "INVALID_ACCESS_TOKEN", status: 401 }),
  });
  await settle();

  assert.equal(fixture.ui.getProfileState().profile, null);
  assert.equal(fixture.authApi.calls.verify, 1);
  assert.equal(element(fixture, "profileSettings").hidden, true);
});
