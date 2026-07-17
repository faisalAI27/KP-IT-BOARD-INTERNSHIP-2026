import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  AccountAccess,
  SUCCESS_REDIRECT_DELAY_MS,
  accessViewContent,
  nextAccessModeForKey,
  passwordFeedback,
} from "../../scripts/modules/account-access.js";
import {
  AuthCulturalPanel,
  CULTURAL_MESSAGES,
  CULTURAL_MESSAGE_INTERVAL_MS,
} from "../../scripts/modules/auth-cultural-panel.js";


const projectRoot = new URL("../../", import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, projectRoot), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));


class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(value, force) {
    if (force) this.values.add(value);
    else this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}


class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, overrides = {}) {
    const event = {
      key: "",
      preventDefaultCalls: 0,
      preventDefault() {
        this.preventDefaultCalls += 1;
      },
      ...overrides,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
}


class FakeElement extends FakeEventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.disabled = false;
    this.focusCalls = 0;
    this.hidden = false;
    this.reportValidityCalls = 0;
    this.textContent = "";
    this.type = "text";
    this.valid = true;
    this.validationMessage = "";
    this.value = "";
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


const ACCOUNT_ELEMENT_IDS = [
  "accountAccess",
  "accountInteractiveContent",
  "accountSuccessState",
  "accessStoryContext",
  "accessStoryTitle",
  "accessStoryMessage",
  "accessCardKicker",
  "accessTitle",
  "accessSubtitle",
  "createAccountTab",
  "passwordSignInTab",
  "switchToSignInButton",
  "switchToCreateButton",
  "createAccountPanel",
  "passwordSignInPanel",
  "accountDetailsStep",
  "accountOtpStep",
  "createAccountForm",
  "createDisplayName",
  "createEmail",
  "createPassword",
  "confirmPassword",
  "toggleCreatePassword",
  "toggleConfirmPassword",
  "createAccountSubmit",
  "createAccountSubmitLabel",
  "createAccountMessage",
  "signupOtpEmail",
  "signupOtpForm",
  "signupOtpInput",
  "signupOtpSubmit",
  "signupOtpSubmitLabel",
  "signupOtpMessage",
  "resendSignupOtpButton",
  "resendSignupOtpLabel",
  "changeSignupEmailButton",
  "cancelSignupOtpButton",
  "passwordSignInForm",
  "passwordSignInEmail",
  "passwordSignInPassword",
  "toggleSignInPassword",
  "passwordSignInSubmit",
  "passwordSignInSubmitLabel",
  "passwordSignInMessage",
  "accountGoogleButton",
  "accountGoogleButtonLabel",
  "accountAccessMessage",
  "accountStepDetails",
  "accountStepVerify",
  "accountStepReady",
  "passwordLengthFeedback",
  "passwordMatchFeedback",
];


class FakeDocument extends FakeEventTarget {
  constructor(ids = ACCOUNT_ELEMENT_IDS) {
    super();
    this.body = new FakeElement();
    this.hidden = false;
    this.elements = new Map(ids.map((id) => [id, new FakeElement()]));
    for (const id of [
      "createPassword",
      "confirmPassword",
      "passwordSignInPassword",
    ]) {
      const element = this.elements.get(id);
      if (element) element.type = "password";
    }
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }
}


function createAccountFixture(overrides = {}) {
  const root = new FakeDocument();
  const calls = {
    google: 0,
    profile: [],
    resend: [],
    signIn: [],
    signUp: [],
    verify: [],
  };
  const listeners = new Set();
  const authApi = {
    async initializeAuthService() {
      return { status: "signed_out", backendUser: null, error: null };
    },
    subscribeToAuthChanges(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signUpWithPassword(details) {
      calls.signUp.push(details);
      return { email: details.email.trim().toLowerCase(), verificationRequired: true };
    },
    async verifySignupOtp(email, otp) {
      calls.verify.push({ email, otp });
      return { ok: true };
    },
    async signInWithPassword(details) {
      calls.signIn.push(details);
      return { ok: true };
    },
    async signInWithGoogle() {
      calls.google += 1;
      return { ok: true, redirecting: true };
    },
    async resendSignupOtp(email) {
      calls.resend.push(email);
      return { ok: true };
    },
    ...overrides.authApi,
  };
  const profileApi = {
    async updateMyProfile(update) {
      calls.profile.push(update);
      return update;
    },
  };
  let now = 1_000;
  const intervalCallbacks = new Map();
  const timeoutCallbacks = new Map();
  let timerId = 0;
  const assigned = [];
  const location = {
    search: "",
    assign(value) {
      assigned.push(value);
    },
  };
  const account = new AccountAccess({
    root,
    authApi,
    profileApi,
    location,
    clock: () => now,
    setIntervalImpl(callback) {
      const id = ++timerId;
      intervalCallbacks.set(id, callback);
      return id;
    },
    clearIntervalImpl(id) {
      intervalCallbacks.delete(id);
    },
    setTimeoutImpl(callback, delay) {
      const id = ++timerId;
      timeoutCallbacks.set(id, { callback, delay });
      return id;
    },
    clearTimeoutImpl(id) {
      timeoutCallbacks.delete(id);
    },
  });
  return {
    account,
    assigned,
    calls,
    intervalCallbacks,
    root,
    setNow(value) {
      now = value;
    },
    timeoutCallbacks,
  };
}


function byId(fixture, id) {
  return fixture.root.getElementById(id);
}


test("cultural authentication markup communicates the KP AWAZ mission", async () => {
  const html = await readProjectFile("auth.html");
  assert.match(html, /id="authCulturalPanel"/);
  assert.match(html, /languages of\s+Khyber Pakhtunkhwa/i);
  assert.match(html, /Our voices, our language, our Khyber Pakhtunkhwa\./);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
});


test("generated cultural background is decorative and the centered card carries real HTML", async () => {
  const html = await readProjectFile("auth.html");
  assert.match(html, /class="cultural-hero"/);
  assert.match(html, /id="authCulturalHero"[\s\S]*?aria-hidden="true"/);
  assert.match(html, /class="cultural-hero-fallback" aria-hidden="true"/);
  assert.match(html, /class="access-stage" id="authCulturalPanel"/);
  assert.match(html, /class="access-card"/);
  assert.doesNotMatch(html, /class="access-story"|class="story-impact"/);
});


test("sign-in and create-account tabs expose one active panel at a time", async () => {
  const fixture = createAccountFixture();
  assert.equal(await fixture.account.initialize(), true);
  assert.equal(byId(fixture, "passwordSignInPanel").hidden, false);
  assert.equal(byId(fixture, "createAccountPanel").hidden, true);
  assert.equal(byId(fixture, "passwordSignInTab").getAttribute("aria-selected"), "true");

  byId(fixture, "createAccountTab").dispatch("click");
  assert.equal(byId(fixture, "passwordSignInPanel").hidden, true);
  assert.equal(byId(fixture, "createAccountPanel").hidden, false);
});


test("mode switching clears passwords, OTP, and stale errors", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  byId(fixture, "passwordSignInPassword").value = "not-a-real-password";
  byId(fixture, "signupOtpInput").value = "111111";
  byId(fixture, "passwordSignInMessage").textContent = "Old error";
  byId(fixture, "passwordSignInMessage").hidden = false;

  byId(fixture, "createAccountTab").dispatch("click");
  assert.equal(byId(fixture, "passwordSignInPassword").value, "");
  assert.equal(byId(fixture, "signupOtpInput").value, "");
  assert.equal(byId(fixture, "passwordSignInMessage").hidden, true);
});


test("account tabs support arrows, Home, and End", () => {
  assert.equal(nextAccessModeForKey("ArrowRight", "sign_in"), "create");
  assert.equal(nextAccessModeForKey("ArrowLeft", "create"), "sign_in");
  assert.equal(nextAccessModeForKey("Home", "create"), "sign_in");
  assert.equal(nextAccessModeForKey("End", "sign_in"), "create");
  assert.equal(nextAccessModeForKey("Enter", "sign_in"), null);
});


test("keyboard mode changes update focus and contextual cultural copy", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  const event = byId(fixture, "passwordSignInTab").dispatch("keydown", {
    key: "ArrowRight",
  });
  assert.equal(event.preventDefaultCalls, 1);
  assert.equal(byId(fixture, "createAccountTab").focusCalls, 1);
  assert.equal(
    byId(fixture, "accessStoryTitle").textContent,
    accessViewContent("create").storyTitle,
  );
});


test("password feedback distinguishes length and match state", () => {
  assert.deepEqual(passwordFeedback("", ""), { length: "neutral", match: "neutral" });
  assert.deepEqual(passwordFeedback("short", "shorter"), {
    length: "invalid",
    match: "invalid",
  });
  assert.deepEqual(passwordFeedback("long-enough", "long-enough"), {
    length: "valid",
    match: "valid",
  });
});


test("password visibility toggle starts hidden and updates its accessible name", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  byId(fixture, "createAccountTab").dispatch("click");
  assert.equal(byId(fixture, "createPassword").type, "password");
  byId(fixture, "toggleCreatePassword").dispatch("click");
  assert.equal(byId(fixture, "createPassword").type, "text");
  assert.equal(byId(fixture, "toggleCreatePassword").getAttribute("aria-label"), "Hide password");
});


test("successful password signup opens focused six-digit OTP mode", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  byId(fixture, "createAccountTab").dispatch("click");
  byId(fixture, "createDisplayName").value = "Faisal";
  byId(fixture, "createEmail").value = " Person@Example.com ";
  byId(fixture, "createPassword").value = "strong-password";
  byId(fixture, "confirmPassword").value = "strong-password";
  byId(fixture, "createAccountForm").dispatch("submit");
  await flush();

  assert.equal(fixture.calls.signUp.length, 1);
  assert.equal(byId(fixture, "accountOtpStep").hidden, false);
  assert.equal(byId(fixture, "accountDetailsStep").hidden, true);
  assert.equal(byId(fixture, "signupOtpEmail").textContent, "person@example.com");
  assert.equal(byId(fixture, "signupOtpInput").focusCalls, 1);
  assert.equal(byId(fixture, "accountGoogleButton").hidden, false);
});


test("signup disables only the submitted form and clears loading after failure", async () => {
  let rejectSignup;
  const fixture = createAccountFixture({
    authApi: {
      signUpWithPassword(details) {
        fixture.calls.signUp.push(details);
        return new Promise((_, reject) => {
          rejectSignup = reject;
        });
      },
    },
  });
  await fixture.account.initialize();
  byId(fixture, "createAccountTab").dispatch("click");
  byId(fixture, "createDisplayName").value = "Person";
  byId(fixture, "createEmail").value = "person@example.com";
  byId(fixture, "createPassword").value = "strong-password";
  byId(fixture, "confirmPassword").value = "strong-password";
  byId(fixture, "createAccountForm").dispatch("submit");

  assert.equal(byId(fixture, "createDisplayName").disabled, true);
  assert.equal(byId(fixture, "createEmail").disabled, true);
  assert.equal(byId(fixture, "createPassword").disabled, true);
  assert.equal(byId(fixture, "passwordSignInEmail").disabled, false);
  assert.equal(byId(fixture, "accountGoogleButton").disabled, false);
  assert.equal(byId(fixture, "createAccountForm").getAttribute("aria-busy"), "true");

  rejectSignup({ code: "PASSWORD_SIGN_UP_FAILED" });
  await flush();
  assert.equal(byId(fixture, "createDisplayName").disabled, false);
  assert.equal(byId(fixture, "createEmail").disabled, false);
  assert.equal(byId(fixture, "createPassword").disabled, false);
  assert.equal(byId(fixture, "createAccountForm").getAttribute("aria-busy"), "false");
  assert.equal(byId(fixture, "createPassword").value, "");
  assert.equal(byId(fixture, "confirmPassword").value, "");
});


test("incomplete OTP is rejected before the authentication service", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  fixture.account._mode = "create";
  fixture.account._createStep = "otp";
  fixture.account._activeEmail = "person@example.com";
  fixture.account._render();
  byId(fixture, "signupOtpInput").value = "12345";
  byId(fixture, "signupOtpForm").dispatch("submit");
  await flush();
  assert.equal(fixture.calls.verify.length, 0);
  assert.match(byId(fixture, "signupOtpMessage").textContent, /six-digit/i);
});


test("OTP verification failure clears only OTP loading controls", async () => {
  const fixture = createAccountFixture({
    authApi: {
      async verifySignupOtp() {
        throw { code: "INVALID_OR_EXPIRED_SIGNUP_OTP" };
      },
    },
  });
  await fixture.account.initialize();
  fixture.account._mode = "create";
  fixture.account._createStep = "otp";
  fixture.account._activeEmail = "person@example.com";
  fixture.account._render();
  byId(fixture, "signupOtpInput").value = "123456";
  byId(fixture, "signupOtpForm").dispatch("submit");
  await flush();
  assert.equal(byId(fixture, "signupOtpInput").disabled, false);
  assert.equal(byId(fixture, "signupOtpSubmit").disabled, false);
  assert.equal(byId(fixture, "signupOtpForm").getAttribute("aria-busy"), "false");
  assert.equal(byId(fixture, "signupOtpInput").value, "");
  assert.match(byId(fixture, "signupOtpMessage").textContent, /Invalid or expired code/);
});


test("successful OTP verification shows success then redirects automatically", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  fixture.account._mode = "create";
  fixture.account._createStep = "otp";
  fixture.account._activeEmail = "person@example.com";
  fixture.account._activeDisplayName = "Person";
  fixture.account._render();
  byId(fixture, "signupOtpInput").value = "123456";
  byId(fixture, "signupOtpForm").dispatch("submit");
  await flush();
  await flush();

  assert.deepEqual(fixture.calls.verify, [{ email: "person@example.com", otp: "123456" }]);
  assert.deepEqual(fixture.calls.profile, [{ displayName: "Person" }]);
  assert.equal(byId(fixture, "accountSuccessState").hidden, false);
  assert.equal(byId(fixture, "accountInteractiveContent").hidden, true);
  assert.equal(byId(fixture, "signupOtpInput").value, "");
  assert.equal(fixture.assigned.length, 0);
  const transition = [...fixture.timeoutCallbacks.values()][0];
  assert.equal(transition.delay, SUCCESS_REDIRECT_DELAY_MS);
  transition.callback();
  assert.deepEqual(fixture.assigned, ["dashboard.html"]);
});


test("returning password sign-in never enters OTP and redirects after success", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  byId(fixture, "passwordSignInEmail").value = "person@example.com";
  byId(fixture, "passwordSignInPassword").value = "strong-password";
  byId(fixture, "passwordSignInForm").dispatch("submit");
  await flush();
  assert.equal(fixture.calls.signIn.length, 1);
  assert.equal(fixture.calls.verify.length, 0);
  assert.equal(byId(fixture, "accountOtpStep").hidden, true);
  assert.equal(byId(fixture, "accountSuccessState").hidden, false);
});


test("Google OAuth remains independent from the signup OTP flow", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  byId(fixture, "accountGoogleButton").dispatch("click");
  await flush();
  assert.equal(fixture.calls.google, 1);
  assert.equal(fixture.calls.signUp.length, 0);
  assert.equal(fixture.calls.verify.length, 0);
  assert.equal(byId(fixture, "accountOtpStep").hidden, true);
});


test("a pending auth request disables duplicate submissions and shows loading copy", async () => {
  let finishSignIn;
  const fixture = createAccountFixture({
    authApi: {
      signInWithPassword(details) {
        fixture.calls.signIn.push(details);
        return new Promise((resolve) => {
          finishSignIn = resolve;
        });
      },
    },
  });
  await fixture.account.initialize();
  byId(fixture, "passwordSignInEmail").value = "person@example.com";
  byId(fixture, "passwordSignInPassword").value = "strong-password";
  byId(fixture, "passwordSignInForm").dispatch("submit");
  byId(fixture, "passwordSignInForm").dispatch("submit");
  assert.equal(fixture.calls.signIn.length, 1);
  assert.equal(byId(fixture, "passwordSignInSubmit").disabled, true);
  assert.equal(byId(fixture, "passwordSignInEmail").disabled, true);
  assert.equal(byId(fixture, "passwordSignInPassword").disabled, true);
  assert.equal(byId(fixture, "createAccountTab").disabled, false);
  assert.equal(byId(fixture, "accountGoogleButton").disabled, false);
  assert.equal(byId(fixture, "createDisplayName").disabled, false);
  assert.equal(byId(fixture, "accountAccess").getAttribute("aria-busy"), null);
  assert.equal(byId(fixture, "passwordSignInForm").getAttribute("aria-busy"), "true");
  assert.equal(byId(fixture, "passwordSignInSubmitLabel").textContent, "Signing you in…");
  finishSignIn({ ok: true });
  await flush();
});


test("password sign-in loading always clears after failure", async () => {
  const fixture = createAccountFixture({
    authApi: {
      async signInWithPassword() {
        throw { code: "PASSWORD_SIGN_IN_FAILED" };
      },
    },
  });
  await fixture.account.initialize();
  byId(fixture, "passwordSignInEmail").value = "person@example.com";
  byId(fixture, "passwordSignInPassword").value = "strong-password";
  byId(fixture, "passwordSignInForm").dispatch("submit");
  await flush();
  assert.equal(byId(fixture, "passwordSignInSubmit").disabled, false);
  assert.equal(byId(fixture, "passwordSignInEmail").disabled, false);
  assert.equal(byId(fixture, "passwordSignInPassword").disabled, false);
  assert.equal(byId(fixture, "passwordSignInForm").getAttribute("aria-busy"), "false");
});


test("authentication timeout clears loading and displays only the safe message", async () => {
  const fixture = createAccountFixture({
    authApi: {
      async signInWithPassword() {
        throw {
          code: "AUTH_REQUEST_TIMEOUT",
          message: "raw provider details must not render",
        };
      },
    },
  });
  await fixture.account.initialize();
  byId(fixture, "passwordSignInEmail").value = "person@example.com";
  byId(fixture, "passwordSignInPassword").value = "strong-password";
  byId(fixture, "passwordSignInForm").dispatch("submit");
  await flush();
  assert.equal(
    byId(fixture, "passwordSignInMessage").textContent,
    "We could not complete the authentication request. Please try again.",
  );
  assert.equal(byId(fixture, "passwordSignInSubmit").disabled, false);
});


test("Google initiation never leaves its button in a busy state", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  byId(fixture, "accountGoogleButton").dispatch("click");
  await flush();
  assert.equal(byId(fixture, "accountGoogleButton").disabled, false);
  assert.equal(byId(fixture, "accountGoogleButton").getAttribute("aria-busy"), "false");
  assert.equal(byId(fixture, "accountGoogleButtonLabel").textContent, "Continue with Google");
});


test("resend reuses the signup email and enforces the cooldown", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  fixture.account._mode = "create";
  fixture.account._createStep = "otp";
  fixture.account._activeEmail = "person@example.com";
  fixture.account._resendAvailableAt = 61_000;
  fixture.account._render();
  byId(fixture, "resendSignupOtpButton").dispatch("click");
  assert.equal(fixture.calls.resend.length, 0);

  fixture.setNow(61_000);
  fixture.account._render();
  byId(fixture, "resendSignupOtpButton").dispatch("click");
  await flush();
  assert.deepEqual(fixture.calls.resend, ["person@example.com"]);
  assert.match(byId(fixture, "resendSignupOtpLabel").textContent, /Resend code in 60s/);
});


test("Escape safely leaves OTP mode and clears its in-memory value", async () => {
  const fixture = createAccountFixture();
  await fixture.account.initialize();
  fixture.account._mode = "create";
  fixture.account._createStep = "otp";
  fixture.account._activeEmail = "person@example.com";
  byId(fixture, "signupOtpInput").value = "123456";
  fixture.root.dispatch("keydown", { key: "Escape" });
  assert.equal(byId(fixture, "signupOtpInput").value, "");
  assert.equal(byId(fixture, "passwordSignInPanel").hidden, false);
});


test("safe UI errors never render raw provider details", async () => {
  const fixture = createAccountFixture({
    authApi: {
      async signInWithPassword() {
        throw new Error("provider token SMTP internal detail");
      },
    },
  });
  await fixture.account.initialize();
  byId(fixture, "passwordSignInEmail").value = "person@example.com";
  byId(fixture, "passwordSignInPassword").value = "strong-password";
  byId(fixture, "passwordSignInForm").dispatch("submit");
  await flush();
  assert.equal(
    byId(fixture, "passwordSignInMessage").textContent,
    "We could not sign in. Please try again.",
  );
});


test("rotating cultural message pauses while hidden and stops when destroyed", () => {
  const root = new FakeDocument(["authCulturalMessage"]);
  const intervals = new Map();
  let nextId = 0;
  const panel = new AuthCulturalPanel({
    root,
    matchMediaImpl: () => ({ matches: false }),
    setIntervalImpl(callback, delay) {
      const id = ++nextId;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearIntervalImpl(id) {
      intervals.delete(id);
    },
  });
  assert.equal(panel.initialize(), true);
  assert.equal(root.getElementById("authCulturalMessage").textContent, CULTURAL_MESSAGES[0]);
  assert.equal([...intervals.values()][0].delay, CULTURAL_MESSAGE_INTERVAL_MS);
  [...intervals.values()][0].callback();
  assert.equal(root.getElementById("authCulturalMessage").textContent, CULTURAL_MESSAGES[1]);
  root.hidden = true;
  root.dispatch("visibilitychange");
  assert.equal(intervals.size, 0);
  panel.destroy();
  assert.equal(root.listeners.get("visibilitychange")?.size ?? 0, 0);
});


test("reduced-motion preference keeps the rotating copy static", () => {
  const root = new FakeDocument(["authCulturalMessage"]);
  let intervalCalls = 0;
  const panel = new AuthCulturalPanel({
    root,
    matchMediaImpl: () => ({ matches: true }),
    setIntervalImpl() {
      intervalCalls += 1;
      return 1;
    },
  });
  panel.initialize();
  assert.equal(intervalCalls, 0);
  assert.equal(root.getElementById("authCulturalMessage").textContent, CULTURAL_MESSAGES[0]);
});


test("markup keeps sign-in fields minimal and create fields complete", async () => {
  const html = await readProjectFile("auth.html");
  const signIn = html.match(/<section\s+id="passwordSignInPanel"[\s\S]*?<\/section>/)?.[0] ?? "";
  const create = html.match(/<section\s+id="createAccountPanel"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(signIn, /id="passwordSignInEmail"/);
  assert.match(signIn, /id="passwordSignInPassword"/);
  assert.doesNotMatch(signIn, /createDisplayName|signupOtpInput/);
  assert.match(create, /id="createDisplayName"/);
  assert.match(create, /id="createPassword"/);
  assert.match(create, /id="confirmPassword"/);
});


test("OTP, errors, and trust links are accessible in markup", async () => {
  const html = await readProjectFile("auth.html");
  assert.match(html, /id="signupOtpInput"[\s\S]*?inputmode="numeric"/);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.match(html, /maxlength="6"/);
  assert.match(html, /aria-describedby="signupOtpHelp signupOtpMessage"/);
  assert.match(html, /role="alert"[\s\S]*?aria-live="polite"/);
  assert.match(html, /href="index\.html"[\s\S]*?Back to KP AWAZ/);
  assert.match(html, /href="about\.html">Read our privacy promise<\/a>/);
});


test("responsive CSS keeps centered mobile authentication independent of background loading", async () => {
  const [html, css] = await Promise.all([
    readProjectFile("auth.html"),
    readProjectFile("styles/auth-page.css"),
  ]);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(html, /media="\(max-width: 620px\)"[\s\S]*?kp-awaz-auth-background-mobile\.webp/);
  assert.match(css, /\.access-layout\s*\{[\s\S]*?place-items: center/);
  assert.doesNotMatch(css, /filter:\s*blur|backdrop-filter/);
  assert.match(css, /overflow-x: hidden/);
  assert.match(css, /min-height: 50px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});


test("authentication redesign contains no credential persistence, logs, or TokenHash", async () => {
  const [html, controller, cultural, css] = await Promise.all([
    readProjectFile("auth.html"),
    readProjectFile("scripts/modules/account-access.js"),
    readProjectFile("scripts/modules/auth-cultural-panel.js"),
    readProjectFile("styles/auth-page.css"),
  ]);
  const source = `${html}\n${controller}\n${cultural}\n${css}`;
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(source, /TokenHash|service[_-]?role|client[_-]?secret|smtp[_-]?password/i);
  assert.doesNotMatch(controller, /URLSearchParams\([^)]*(?:otp|password)/i);
});
