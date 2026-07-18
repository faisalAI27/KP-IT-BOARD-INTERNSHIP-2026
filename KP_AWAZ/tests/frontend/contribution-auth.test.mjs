import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { ContributionAuthController } from "../../scripts/modules/contribution-auth.js";


const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";


function authState(status, userId = null, extras = {}) {
  return {
    status,
    session: userId ? { userId } : null,
    backendUser: userId ? { id: userId, email: "person@example.com" } : null,
    error: null,
    ...extras,
  };
}


class FakeElement {
  constructor() {
    this.disabled = false;
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
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}


function fakeAuthApi(initialState) {
  let state = initialState;
  const listeners = new Set();
  let subscriptions = 0;
  let unsubscriptions = 0;
  return {
    getCurrentAuthState: () => state,
    subscribeToAuthChanges(listener) {
      subscriptions += 1;
      listeners.add(listener);
      return () => {
        if (listeners.delete(listener)) unsubscriptions += 1;
      };
    },
    emit(nextState) {
      state = nextState;
      for (const listener of [...listeners]) listener(nextState);
    },
    get subscriptions() {
      return subscriptions;
    },
    get unsubscriptions() {
      return unsubscriptions;
    },
  };
}


function fakeRecorder() {
  return {
    resetCalls: 0,
    recording: false,
    hasAudio: false,
    tracksReleased: false,
    reset() {
      this.resetCalls += 1;
      this.recording = false;
      this.hasAudio = false;
      this.tracksReleased = true;
    },
  };
}


function fixture(initialState = authState("signed_out")) {
  const authApi = fakeAuthApi(initialState);
  const statusElement = new FakeElement();
  const messageElement = new FakeElement();
  const signInButton = new FakeElement();
  const recordButton = new FakeElement();
  const recorders = [fakeRecorder(), fakeRecorder()];
  let signInCalls = 0;
  let invalidations = 0;
  const accessStates = [];
  const controller = new ContributionAuthController({
    authApi,
    recorders,
    statusElement,
    messageElement,
    signInButton,
    openSignIn: () => {
      signInCalls += 1;
    },
    onAccessChange(state) {
      accessStates.push(state);
      recordButton.disabled = !state.verified;
    },
    onSessionInvalidated: () => {
      invalidations += 1;
    },
  });
  controller.init();
  return {
    accessStates,
    authApi,
    controller,
    messageElement,
    recordButton,
    recorders,
    signInButton,
    statusElement,
    get invalidations() {
      return invalidations;
    },
    get signInCalls() {
      return signInCalls;
    },
  };
}


test("contribution partial provides an accessible login-required status", async () => {
  const html = await readFile(
    new URL("../../sections/contribution.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /id="contributionAuthStatus"[\s\S]*role="status"/);
  assert.match(html, /id="contributionAuthMessage"/);
  assert.match(html, /id="contributionSignInButton"[\s\S]*Sign in/);
  assert.equal((html.match(/id="toReviewBtn"/g) ?? []).length, 1);
  assert.equal(
    (html.match(/Recording submitted successfully\./g) ?? []).length,
    2,
  );
  assert.equal(
    (
      html.match(
        /Your contribution is waiting for administrator review\. Your score\s+will increase after it is approved\./g,
      ) ?? []
    ).length,
    2,
  );
});


test("signed-out users see login guidance and cannot contribute", () => {
  const view = fixture(authState("signed_out"));

  assert.equal(view.controller.canContribute(), false);
  assert.equal(view.controller.beginSubmission("guided"), null);
  assert.equal(view.recordButton.disabled, true);
  assert.equal(view.statusElement.hidden, false);
  assert.equal(
    view.messageElement.textContent,
    "Sign in to record and contribute your voice.",
  );
  assert.equal(view.signInButton.hidden, false);
});


test("authentication loading keeps contribution access disabled", () => {
  const view = fixture(authState("loading"));

  assert.equal(view.controller.canContribute(), false);
  assert.equal(view.recordButton.disabled, true);
  assert.equal(view.signInButton.hidden, true);
  assert.equal(
    view.messageElement.textContent,
    "Verifying your account before recording…",
  );
});


test("only backend-verified signed-in users can record and submit", () => {
  const unverified = fixture({
    status: "signed_in",
    session: { userId: USER_A },
    backendUser: null,
  });
  assert.equal(unverified.controller.canContribute(), false);

  const verified = fixture(authState("signed_in", USER_A));
  assert.equal(verified.controller.canContribute(), true);
  assert.equal(verified.recordButton.disabled, false);
  assert.equal(verified.statusElement.hidden, true);
  assert.ok(verified.controller.beginSubmission("guided"));
});


test("sign-in action reuses the account dialog action", () => {
  const view = fixture(authState("signed_out"));

  view.signInButton.dispatch("click");

  assert.equal(view.signInCalls, 1);
});


test("sign-out resets recorders, releases tracks, and discards unsent audio", () => {
  const view = fixture(authState("signed_in", USER_A));
  for (const recorder of view.recorders) {
    recorder.recording = true;
    recorder.hasAudio = true;
    recorder.tracksReleased = false;
  }

  view.authApi.emit(authState("signed_out"));

  for (const recorder of view.recorders) {
    assert.equal(recorder.recording, false);
    assert.equal(recorder.hasAudio, false);
    assert.equal(recorder.tracksReleased, true);
  }
  assert.equal(view.controller.canContribute(), false);
});


test("sign-out during upload invalidates the pending success", () => {
  const view = fixture(authState("signed_in", USER_A));
  const submission = view.controller.beginSubmission("guided");

  view.authApi.emit(authState("signed_out"));

  assert.equal(view.controller.finishSubmission(submission), false);
});


test("User A callback cannot overwrite User B contribution state", () => {
  const view = fixture(authState("signed_in", USER_A));
  const userASubmission = view.controller.beginSubmission("open");

  view.authApi.emit(authState("signed_in", USER_B));

  assert.equal(view.controller.finishSubmission(userASubmission), false);
  assert.ok(view.controller.beginSubmission("open"));
});


test("duplicate submission is prevented until the first completes", () => {
  const view = fixture(authState("signed_in", USER_A));
  const first = view.controller.beginSubmission("guided");

  assert.ok(first);
  assert.equal(view.controller.beginSubmission("guided"), null);
  assert.equal(view.controller.finishSubmission(first), true);
  assert.ok(view.controller.beginSubmission("guided"));
});


test("authentication verification error keeps contribution unavailable", () => {
  const view = fixture(
    authState("error", null, {
      error: { code: "AUTH_SERVICE_UNAVAILABLE", message: "Retry safely" },
    }),
  );

  assert.equal(view.controller.canContribute(), false);
  assert.equal(view.recordButton.disabled, true);
  assert.equal(view.signInButton.hidden, false);
});


test("tokens, user UUIDs, and raw metadata are never rendered", () => {
  const token = "private-token";
  const view = fixture(
    authState("signed_in", USER_A, {
      accessToken: token,
      rawMetadata: { provider_token: token },
    }),
  );
  const rendered = `${view.messageElement.textContent}|${view.statusElement.textContent}`;

  assert.equal(rendered.includes(token), false);
  assert.equal(rendered.includes(USER_A), false);
  assert.equal(rendered.includes("provider_token"), false);
});


test("duplicate initialization creates one auth subscription", () => {
  const view = fixture(authState("signed_out"));

  view.controller.init();

  assert.equal(view.authApi.subscriptions, 1);
});


test("destroy invalidates pending callbacks and removes listeners safely", () => {
  const view = fixture(authState("signed_in", USER_A));
  const submission = view.controller.beginSubmission("open");

  view.controller.destroy();
  view.controller.destroy();
  view.signInButton.dispatch("click");

  assert.equal(view.controller.finishSubmission(submission), false);
  assert.equal(view.authApi.unsubscriptions, 1);
  assert.equal(view.signInCalls, 0);
  assert.equal(view.controller.canContribute(), false);
});
