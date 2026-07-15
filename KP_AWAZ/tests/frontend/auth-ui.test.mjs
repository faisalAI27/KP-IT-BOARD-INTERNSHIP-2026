import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  AuthUI,
  getAuthViewModel,
} from "../../scripts/modules/auth-ui.js";


const VERIFIED_USER = Object.freeze({
  id: "0d5dd8f5-93df-462b-b234-a16973089092",
  email: "person@example.com",
  provider: "google",
});


function authState(status, overrides = {}) {
  return {
    status,
    session: null,
    backendUser: null,
    error: null,
    ...overrides,
  };
}


class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}


class FakeElement {
  constructor() {
    this.classList = new FakeClassList();
    this.dataset = {};
    this.disabled = false;
    this.focusCalls = 0;
    this.hidden = false;
    this.listeners = new Map();
    this.open = false;
    this.reportValidityCalls = 0;
    this.showModalCalls = 0;
    this.closeCalls = 0;
    this.textContent = "";
    this.valid = true;
    this.validationMessage = "";
    this.value = "";
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    const dispatchedEvent = {
      target: this,
      preventDefault() {},
      ...event,
    };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(dispatchedEvent);
    }
  }

  showModal() {
    if (this.open) throw new Error("Dialog is already open");
    this.open = true;
    this.showModalCalls += 1;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.closeCalls += 1;
    this.dispatch("close");
  }

  focus() {
    this.focusCalls += 1;
  }

  setCustomValidity(message) {
    this.validationMessage = message;
  }

  checkValidity() {
    return this.valid;
  }

  reportValidity() {
    this.reportValidityCalls += 1;
    return this.valid;
  }
}


const ELEMENT_IDS = [
  "authHeaderButton",
  "authHeaderButtonLabel",
  "authDialog",
  "authDialogClose",
  "authDialogTitle",
  "authDialogDescription",
  "authSignInView",
  "authAccountView",
  "authGoogleButton",
  "authGoogleButtonLabel",
  "authEmailForm",
  "authEmailInput",
  "authEmailSubmit",
  "authEmailSubmitLabel",
  "authSignInStatus",
  "authAccountEmail",
  "authAccountProvider",
  "authAccountStatus",
  "authRetryButton",
  "authRetryButtonLabel",
  "authSignOutButton",
  "authSignOutButtonLabel",
];


function createRoot() {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, new FakeElement()]));
  const body = new FakeElement();
  const contributionForm = { dataset: { submissionId: "keep-me" }, value: "voice" };
  return {
    body,
    contributionForm,
    elements,
    getElementById(id) {
      if (id === "donateForm") return contributionForm;
      return elements.get(id) ?? null;
    },
  };
}


function createAuthApi(initialState = authState("signed_out"), overrides = {}) {
  let state = initialState;
  const listeners = new Set();
  const calls = {
    email: [],
    google: 0,
    retry: 0,
    signOut: 0,
    subscriptions: 0,
    unsubscriptions: 0,
  };
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
    async signInWithGoogle() {
      calls.google += 1;
      return { ok: true, redirecting: true };
    },
    async signInWithEmail(email) {
      calls.email.push(email);
      return { ok: true, message: "Check your email for the sign-in link." };
    },
    async signOut() {
      calls.signOut += 1;
      api.emit(authState("signed_out"));
      return { ok: true };
    },
    async verifyCurrentUserWithBackend() {
      calls.retry += 1;
      return VERIFIED_USER;
    },
    emit(nextState) {
      state = nextState;
      for (const listener of listeners) listener(state);
    },
    ...overrides,
  };
  return api;
}


function createFixture(state = authState("signed_out"), authOverrides = {}) {
  const root = createRoot();
  const authApi = createAuthApi(state, authOverrides);
  const ui = new AuthUI({ root, authApi });
  assert.equal(ui.initAuthUI(), true);
  return { authApi, root, ui };
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


test("loading state does not show a false signed-in account", () => {
  const view = getAuthViewModel(authState("loading"));

  assert.equal(view.headerLabel, "Checking account…");
  assert.equal(view.headerDisabled, true);
  assert.notEqual(view.dialogMode, "account");
});


test("signed-out state displays Sign in", () => {
  const view = getAuthViewModel(authState("signed_out"));

  assert.equal(view.headerLabel, "Sign in");
  assert.equal(view.headerDisabled, false);
});


test("signed-in state uses verified email and provider safely", () => {
  const view = getAuthViewModel(
    authState("signed_in", { backendUser: VERIFIED_USER }),
  );

  assert.equal(view.headerLabel, "person");
  assert.equal(view.dialogMode, "account");
  assert.equal(view.accountEmail, "person@example.com");
  assert.equal(view.accountProvider, "Signed in with Google");
});


test("signed-in state handles null email and provider", () => {
  const view = getAuthViewModel(
    authState("signed_in", {
      backendUser: { id: VERIFIED_USER.id, email: null, provider: null },
    }),
  );

  assert.equal(view.headerLabel, "Account");
  assert.equal(view.accountEmail, "Email not available");
  assert.equal(view.accountProvider, "Verified account");
});


test("rendered view model never includes tokens or raw metadata", () => {
  const token = "private-token-must-not-render";
  const state = authState("signed_in", {
    backendUser: VERIFIED_USER,
    access_token: token,
    refresh_token: "private-refresh-token",
    app_metadata: { secret: "private-metadata" },
  });

  const rendered = JSON.stringify(getAuthViewModel(state));

  assert.equal(rendered.includes(token), false);
  assert.equal(rendered.includes("private-refresh-token"), false);
  assert.equal(rendered.includes("private-metadata"), false);
});


test("auth errors use mapped safe messages and unconfigured state is stable", () => {
  const unsafeMessage = "raw private-token-must-not-render";
  const genericError = getAuthViewModel(
    authState("error", {
      error: { code: "SESSION_RESTORE_FAILED", message: unsafeMessage, status: 0 },
    }),
  );
  const unconfigured = getAuthViewModel(
    authState("error", {
      error: { code: "AUTH_NOT_CONFIGURED", message: unsafeMessage, status: 0 },
    }),
  );

  assert.equal(genericError.signInMessage.includes("private-token"), false);
  assert.equal(unconfigured.headerDisabled, true);
  assert.equal(unconfigured.signInMessage, "Account sign-in is not configured.");
});


test("dialog partial is accessible and contains no password field", async () => {
  const html = await readFile(
    new URL("../../sections/auth-dialog.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /<dialog[\s\S]*id="authDialog"/);
  assert.match(html, /<label for="authEmailInput">Email address<\/label>/);
  assert.match(html, /id="authEmailInput"[\s\S]*type="email"/);
  assert.match(html, /id="authSignInStatus"[\s\S]*aria-live="polite"/);
  assert.equal(/type="password"/i.test(html), false);
});


test("header button opens dialog once and moves focus inside", async () => {
  const fixture = createFixture();

  element(fixture, "authHeaderButton").dispatch("click");
  element(fixture, "authHeaderButton").dispatch("click");
  await settle();

  assert.equal(element(fixture, "authDialog").open, true);
  assert.equal(element(fixture, "authDialog").showModalCalls, 1);
  assert.equal(element(fixture, "authGoogleButton").focusCalls, 1);
});


test("close button closes dialog and returns focus to header", async () => {
  const fixture = createFixture();
  fixture.ui.openDialog();
  await settle();

  element(fixture, "authDialogClose").dispatch("click");

  assert.equal(element(fixture, "authDialog").open, false);
  assert.equal(element(fixture, "authHeaderButton").focusCalls, 1);
});


test("Escape cancel and backdrop click close the dialog safely", async () => {
  const fixture = createFixture();
  let cancelPrevented = false;
  fixture.ui.openDialog();
  await settle();

  element(fixture, "authDialog").dispatch("cancel", {
    preventDefault() {
      cancelPrevented = true;
    },
  });
  fixture.ui.closeDialog();
  assert.equal(cancelPrevented, true);
  assert.equal(element(fixture, "authDialog").open, false);

  fixture.ui.openDialog();
  element(fixture, "authDialog").dispatch("click", {
    target: element(fixture, "authDialog"),
  });
  assert.equal(element(fixture, "authDialog").open, false);
});


test("repeated close calls are safe", () => {
  const fixture = createFixture();

  fixture.ui.closeDialog();
  fixture.ui.closeDialog();

  assert.equal(element(fixture, "authDialog").closeCalls, 0);
});


test("duplicate initialization creates one UI subscription", () => {
  const fixture = createFixture();

  assert.equal(fixture.ui.initAuthUI(), true);
  assert.equal(fixture.authApi.calls.subscriptions, 1);
});


test("destroy removes UI listeners and auth subscription", () => {
  const fixture = createFixture();
  fixture.ui.destroyAuthUI();
  fixture.ui.destroyAuthUI();

  element(fixture, "authHeaderButton").dispatch("click");

  assert.equal(element(fixture, "authDialog").open, false);
  assert.equal(fixture.authApi.calls.unsubscriptions, 1);
});


test("Google sign-in is single-flight and shows its loading label", async () => {
  const request = deferred();
  let calls = 0;
  const fixture = createFixture(authState("signed_out"), {
    signInWithGoogle() {
      calls += 1;
      return request.promise;
    },
  });

  element(fixture, "authGoogleButton").dispatch("click");
  element(fixture, "authGoogleButton").dispatch("click");

  assert.equal(calls, 1);
  assert.equal(element(fixture, "authGoogleButton").disabled, true);
  assert.equal(
    element(fixture, "authGoogleButtonLabel").textContent,
    "Connecting to Google…",
  );

  request.resolve({ ok: true, redirecting: true });
  await settle();
  assert.equal(element(fixture, "authHeaderButtonLabel").textContent, "Sign in");
});


test("Google failure restores the button and renders a token-free error", async () => {
  const secret = "private-token-must-not-render";
  const fixture = createFixture(authState("signed_out"), {
    async signInWithGoogle() {
      throw { code: "GOOGLE_SIGN_IN_FAILED", message: `raw ${secret}` };
    },
  });

  element(fixture, "authGoogleButton").dispatch("click");
  await settle();

  assert.equal(element(fixture, "authGoogleButton").disabled, false);
  assert.equal(
    element(fixture, "authGoogleButtonLabel").textContent,
    "Continue with Google",
  );
  assert.equal(element(fixture, "authSignInStatus").hidden, false);
  assert.equal(element(fixture, "authSignInStatus").textContent.includes(secret), false);
});


test("valid email is trimmed, single-flight, and shows generic success", async () => {
  const request = deferred();
  const calls = [];
  const fixture = createFixture(authState("signed_out"), {
    signInWithEmail(email) {
      calls.push(email);
      return request.promise;
    },
  });
  element(fixture, "authEmailInput").value = "  person@example.com  ";

  element(fixture, "authEmailForm").dispatch("submit");
  element(fixture, "authEmailForm").dispatch("submit");

  assert.deepEqual(calls, ["person@example.com"]);
  assert.equal(element(fixture, "authEmailSubmit").disabled, true);
  assert.equal(element(fixture, "authEmailSubmitLabel").textContent, "Sending…");

  request.resolve({ ok: true });
  await settle();
  assert.equal(element(fixture, "authEmailSubmit").disabled, false);
  assert.equal(
    element(fixture, "authSignInStatus").textContent,
    "Check your email for the sign-in link.",
  );
  assert.equal(
    element(fixture, "authSignInStatus").textContent.includes("account existed"),
    false,
  );
});


test("blank and invalid emails are rejected before service calls", () => {
  const fixture = createFixture();
  const input = element(fixture, "authEmailInput");

  input.value = "   ";
  element(fixture, "authEmailForm").dispatch("submit");
  assert.equal(fixture.authApi.calls.email.length, 0);
  assert.equal(input.reportValidityCalls, 1);

  input.value = "not-an-email";
  input.valid = false;
  element(fixture, "authEmailForm").dispatch("submit");
  assert.equal(fixture.authApi.calls.email.length, 0);
  assert.equal(input.reportValidityCalls, 2);
});


test("email failure is safe and restores the submit button", async () => {
  const secret = "private-key-must-not-render";
  const fixture = createFixture(authState("signed_out"), {
    async signInWithEmail() {
      throw { code: "EMAIL_SIGN_IN_FAILED", message: `raw ${secret}` };
    },
  });
  element(fixture, "authEmailInput").value = "person@example.com";

  element(fixture, "authEmailForm").dispatch("submit");
  await settle();

  assert.equal(element(fixture, "authEmailSubmit").disabled, false);
  assert.equal(element(fixture, "authSignInStatus").textContent.includes(secret), false);
});


test("successful sign-out disables once, closes, and renders signed out", async () => {
  const request = deferred();
  let calls = 0;
  const signedInState = authState("signed_in", { backendUser: VERIFIED_USER });
  const fixture = createFixture(signedInState, {
    signOut() {
      calls += 1;
      return request.promise;
    },
  });
  fixture.ui.openDialog();
  await settle();

  element(fixture, "authSignOutButton").dispatch("click");
  element(fixture, "authSignOutButton").dispatch("click");
  assert.equal(calls, 1);
  assert.equal(element(fixture, "authSignOutButton").disabled, true);
  assert.equal(element(fixture, "authSignOutButtonLabel").textContent, "Signing out…");

  fixture.authApi.emit(authState("signed_out"));
  request.resolve({ ok: true });
  await settle();
  assert.equal(element(fixture, "authDialog").open, false);
  assert.equal(element(fixture, "authHeaderButtonLabel").textContent, "Sign in");
});


test("sign-out error preserves account and contribution state", async () => {
  const secret = "private-refresh-token";
  const fixture = createFixture(
    authState("signed_in", { backendUser: VERIFIED_USER }),
    {
      async signOut() {
        throw { code: "SIGN_OUT_FAILED", message: `raw ${secret}` };
      },
    },
  );
  fixture.ui.openDialog();

  element(fixture, "authSignOutButton").dispatch("click");
  await settle();

  assert.equal(element(fixture, "authDialog").open, true);
  assert.equal(element(fixture, "authAccountEmail").textContent, VERIFIED_USER.email);
  assert.equal(element(fixture, "authAccountStatus").textContent.includes(secret), false);
  assert.equal(fixture.root.contributionForm.dataset.submissionId, "keep-me");
  assert.equal(fixture.root.contributionForm.value, "voice");
});


test("HTTP 503 verification state is generic with retry and sign out", () => {
  const privateSessionEmail = "private-session@example.com";
  const view = getAuthViewModel(
    authState("error", {
      session: {
        userId: VERIFIED_USER.id,
        email: privateSessionEmail,
        provider: "google",
        accessTokenAvailable: true,
      },
      error: {
        code: "AUTH_SERVICE_UNAVAILABLE",
        message: "raw upstream body",
        status: 503,
      },
    }),
  );

  assert.equal(view.dialogMode, "account");
  assert.equal(view.showRetry, true);
  assert.equal(view.showSignOut, true);
  assert.equal(JSON.stringify(view).includes(privateSessionEmail), false);
  assert.match(view.accountMessage, /temporarily unavailable/);
});


test("retry verification is single-flight", async () => {
  const request = deferred();
  let calls = 0;
  const verificationState = authState("error", {
    session: { accessTokenAvailable: true },
    error: { code: "AUTH_SERVICE_UNAVAILABLE", status: 503, message: "safe" },
  });
  const fixture = createFixture(verificationState, {
    verifyCurrentUserWithBackend() {
      calls += 1;
      return request.promise;
    },
  });

  element(fixture, "authRetryButton").dispatch("click");
  element(fixture, "authRetryButton").dispatch("click");

  assert.equal(calls, 1);
  assert.equal(element(fixture, "authRetryButton").disabled, true);
  assert.equal(element(fixture, "authRetryButtonLabel").textContent, "Verifying…");

  fixture.authApi.emit(authState("signed_in", { backendUser: VERIFIED_USER }));
  request.resolve(VERIFIED_USER);
  await settle();
  assert.equal(element(fixture, "authAccountEmail").textContent, VERIFIED_USER.email);
});


test("HTTP 401 never displays verified account state or retry loop", () => {
  const view = getAuthViewModel(
    authState("error", {
      session: { accessTokenAvailable: true, email: "unverified@example.com" },
      error: {
        code: "INVALID_ACCESS_TOKEN",
        message: "raw error",
        status: 401,
      },
    }),
  );

  assert.equal(view.headerLabel, "Account issue");
  assert.equal(view.accountEmail, "Account not verified");
  assert.equal(view.showRetry, false);
  assert.equal(view.showSignOut, true);
});
