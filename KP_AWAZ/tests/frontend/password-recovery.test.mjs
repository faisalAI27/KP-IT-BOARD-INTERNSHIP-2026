import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  NEUTRAL_RECOVERY_MESSAGE,
  PasswordRecovery,
  RECOVERY_OTP_COOLDOWN_MS,
  isCompleteRecoveryOtp,
  normalizeRecoveryOtp,
  validateNewPasswords,
} from "../../scripts/modules/password-recovery.js";
import {
  consumeRecoveryEmailForSignIn,
  preserveRecoveryEmailForSignIn,
} from "../../scripts/services/recovery-handoff.js";


const projectRoot = new URL("../../", import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, projectRoot), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const IDS = [
  "passwordRecoveryCard",
  "recoveryKicker",
  "recoveryTitle",
  "recoveryDescription",
  "recoveryEmailPanel",
  "recoveryEmailForm",
  "recoveryEmail",
  "recoverySend",
  "recoverySendLabel",
  "recoveryOtpPanel",
  "recoveryOtpEmail",
  "recoveryOtpForm",
  "recoveryOtp",
  "recoveryVerify",
  "recoveryVerifyLabel",
  "recoveryResend",
  "recoveryResendLabel",
  "recoveryChangeEmail",
  "recoveryPasswordPanel",
  "recoveryPasswordForm",
  "recoveryPassword",
  "recoveryPasswordConfirm",
  "toggleRecoveryPassword",
  "toggleRecoveryPasswordConfirm",
  "recoveryUpdate",
  "recoveryUpdateLabel",
  "recoverySuccessPanel",
  "recoveryReturnToSignIn",
  "recoveryCancel",
  "recoveryMessage",
];


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

  dispatch(type) {
    const event = { preventDefault() {} };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}


class FakeElement extends FakeEventTarget {
  constructor() {
    super();
    this.attributes = new Map();
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


class FakeDocument {
  constructor() {
    this.body = new FakeElement();
    this.elements = new Map(IDS.map((id) => [id, new FakeElement()]));
    for (const id of ["recoveryPassword", "recoveryPasswordConfirm"]) {
      this.elements.get(id).type = "password";
    }
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }
}


function createFixture(overrides = {}) {
  const root = new FakeDocument();
  const calls = {
    request: [],
    verify: [],
    update: [],
    signOut: 0,
    preserve: [],
  };
  const authApi = {
    isPasswordRecoverySession() {
      return false;
    },
    async requestPasswordReset(email) {
      calls.request.push(email);
      return { ok: true, email: email.trim().toLowerCase() };
    },
    async verifyRecoveryOtp(email, otp) {
      calls.verify.push({ email, otp });
      return { ok: true };
    },
    async updatePassword(password) {
      calls.update.push(password);
      return { ok: true };
    },
    async signOut() {
      calls.signOut += 1;
      return { ok: true };
    },
    ...overrides.authApi,
  };
  let now = 1_000;
  let timerId = 0;
  const intervals = new Map();
  const assigned = [];
  const location = {
    assign(destination) {
      assigned.push(destination);
    },
  };
  const recovery = new PasswordRecovery({
    root,
    authApi,
    location,
    preserveEmail(email) {
      calls.preserve.push(email);
      return true;
    },
    clock: () => now,
    setIntervalImpl(callback) {
      const id = ++timerId;
      intervals.set(id, callback);
      return id;
    },
    clearIntervalImpl(id) {
      intervals.delete(id);
    },
  });
  return {
    assigned,
    calls,
    intervals,
    recovery,
    root,
    setNow(value) {
      now = value;
    },
  };
}


const byId = (fixture, id) => fixture.root.getElementById(id);


async function requestCode(fixture, email = " Person@Example.com ") {
  byId(fixture, "recoveryEmail").value = email;
  byId(fixture, "recoveryEmailForm").dispatch("submit");
  await flush();
}


test("recovery OTP accepts pasted spaces but rejects letters and incomplete codes", () => {
  assert.equal(normalizeRecoveryOtp(" 123 456 "), "123456");
  assert.equal(isCompleteRecoveryOtp(" 123 456 "), true);
  assert.equal(isCompleteRecoveryOtp("12a456"), false);
  assert.equal(isCompleteRecoveryOtp("12345"), false);
});


test("accepted recovery request normalizes email and opens the neutral OTP state", async () => {
  const fixture = createFixture();
  assert.equal(fixture.recovery.initialize(), true);
  await requestCode(fixture);

  assert.deepEqual(fixture.calls.request, ["person@example.com"]);
  assert.equal(byId(fixture, "recoveryOtpPanel").hidden, false);
  assert.equal(byId(fixture, "recoveryOtpEmail").textContent, "person@example.com");
  assert.equal(byId(fixture, "recoveryMessage").textContent, NEUTRAL_RECOVERY_MESSAGE);
  assert.doesNotMatch(byId(fixture, "recoveryMessage").textContent, /exists|not found/i);
});


test("a pending recovery request prevents duplicate submissions", async () => {
  let finishRequest;
  const fixture = createFixture({
    authApi: {
      requestPasswordReset() {
        return new Promise((resolve) => {
          finishRequest = resolve;
        });
      },
    },
  });
  fixture.recovery.initialize();
  byId(fixture, "recoveryEmail").value = "person@example.com";
  byId(fixture, "recoveryEmailForm").dispatch("submit");
  byId(fixture, "recoveryEmailForm").dispatch("submit");
  assert.equal(byId(fixture, "recoverySend").disabled, true);
  finishRequest({ ok: true, email: "person@example.com" });
  await flush();
  assert.equal(byId(fixture, "recoverySend").disabled, false);
});


test("resend keeps the same email, clears OTP, and enforces 60 seconds", async () => {
  const fixture = createFixture();
  fixture.recovery.initialize();
  await requestCode(fixture);
  byId(fixture, "recoveryOtp").value = "123456";

  byId(fixture, "recoveryResend").dispatch("click");
  await flush();
  assert.equal(fixture.calls.request.length, 1);
  assert.equal(byId(fixture, "recoveryResendLabel").textContent, "Resend code in 60s");

  fixture.setNow(1_000 + RECOVERY_OTP_COOLDOWN_MS);
  for (const callback of fixture.intervals.values()) callback();
  byId(fixture, "recoveryResend").dispatch("click");
  await flush();
  assert.equal(fixture.calls.request.length, 2);
  assert.equal(fixture.calls.request[1], "person@example.com");
  assert.equal(byId(fixture, "recoveryOtp").value, "");
});


test("only a complete six-digit code reaches recovery verification", async () => {
  const fixture = createFixture();
  fixture.recovery.initialize();
  await requestCode(fixture);
  byId(fixture, "recoveryOtp").value = "12a456";
  byId(fixture, "recoveryOtpForm").dispatch("submit");
  await flush();

  assert.equal(fixture.calls.verify.length, 0);
  assert.equal(byId(fixture, "recoveryOtp").reportValidityCalls, 1);
});


test("verified recovery code is cleared and opens the new-password state", async () => {
  const fixture = createFixture();
  fixture.recovery.initialize();
  await requestCode(fixture);
  byId(fixture, "recoveryOtp").value = "123456";
  byId(fixture, "recoveryOtpForm").dispatch("submit");
  await flush();

  assert.deepEqual(fixture.calls.verify, [{
    email: "person@example.com",
    otp: "123456",
  }]);
  assert.equal(byId(fixture, "recoveryOtp").value, "");
  assert.equal(byId(fixture, "recoveryPasswordPanel").hidden, false);
  assert.equal(byId(fixture, "recoveryPassword").focusCalls, 1);
});


test("invalid recovery code shows only the safe fixed message", async () => {
  const fixture = createFixture({
    authApi: {
      async verifyRecoveryOtp() {
        throw Object.assign(new Error("raw provider detail"), {
          code: "INVALID_OR_EXPIRED_RECOVERY_OTP",
        });
      },
    },
  });
  fixture.recovery.initialize();
  await requestCode(fixture);
  byId(fixture, "recoveryOtp").value = "123456";
  byId(fixture, "recoveryOtpForm").dispatch("submit");
  await flush();

  assert.equal(
    byId(fixture, "recoveryMessage").textContent,
    "The recovery code is invalid or has expired. Request a new code and try again.",
  );
  assert.doesNotMatch(byId(fixture, "recoveryMessage").textContent, /provider/i);
});


test("password policy and matching are enforced without trimming", () => {
  assert.match(validateNewPasswords("short", "short"), /8/);
  assert.equal(validateNewPasswords("secure-pass", "different-pass"), "Passwords do not match.");
  assert.equal(validateNewPasswords(" secure password ", " secure password "), "");
});


test("password update uses the exact password, signs out, and shows success", async () => {
  const fixture = createFixture();
  fixture.recovery.initialize();
  await requestCode(fixture);
  byId(fixture, "recoveryOtp").value = "123456";
  byId(fixture, "recoveryOtpForm").dispatch("submit");
  await flush();
  byId(fixture, "recoveryPassword").value = " exact new password ";
  byId(fixture, "recoveryPasswordConfirm").value = " exact new password ";
  byId(fixture, "recoveryPasswordForm").dispatch("submit");
  await flush();

  assert.deepEqual(fixture.calls.update, [" exact new password "]);
  assert.equal(fixture.calls.signOut, 1);
  assert.equal(byId(fixture, "recoveryPassword").value, "");
  assert.equal(byId(fixture, "recoveryPasswordConfirm").value, "");
  assert.equal(byId(fixture, "recoverySuccessPanel").hidden, false);
});


test("return to Sign In preserves email only and leaves password empty", async () => {
  const fixture = createFixture();
  fixture.recovery.initialize();
  await requestCode(fixture);
  byId(fixture, "recoveryCancel").dispatch("click");
  await flush();

  assert.deepEqual(fixture.calls.preserve, ["person@example.com"]);
  assert.deepEqual(fixture.assigned, ["auth.html"]);
  assert.equal(byId(fixture, "recoveryOtp").value, "");
  assert.equal(byId(fixture, "recoveryPassword").value, "");
});


test("email handoff is one-time and stores no password or OTP", () => {
  const values = new Map();
  const storage = {
    setItem(key, value) {
      values.set(key, value);
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  assert.equal(preserveRecoveryEmailForSignIn(" Person@Example.com ", storage), true);
  assert.equal(consumeRecoveryEmailForSignIn(storage), "person@example.com");
  assert.equal(consumeRecoveryEmailForSignIn(storage), "");
  assert.equal([...values.values()].some((value) => /\d{6}|password/i.test(value)), false);
});


test("recovery pages reuse the approved cultural background and accessible controls", async () => {
  const [auth, forgot, reset, card, authCss, recoveryCss] = await Promise.all([
    readProjectFile("auth.html"),
    readProjectFile("forgot-password.html"),
    readProjectFile("reset-password.html"),
    readProjectFile("sections/password-recovery-card.html"),
    readProjectFile("styles/auth-page.css"),
    readProjectFile("styles/recovery.css"),
  ]);
  const background = "assets/auth/kp-awaz-auth-background.webp";
  assert.match(auth, new RegExp(background));
  assert.match(forgot, new RegExp(background));
  assert.match(reset, new RegExp(background));
  assert.match(card, /assets\/images\/khyber-voice-logo\.svg/);
  assert.match(card, /Back to KP AWAZ/);
  assert.match(card, /inputmode="numeric"/);
  assert.match(card, /autocomplete="one-time-code"/);
  assert.match(card, /maxlength="6"/);
  assert.match(card, /role="status"[\s\S]*aria-live="polite"/);
  assert.match(`${authCss}\n${recoveryCss}`, /focus-visible|:focus/);
  assert.match(recoveryCss, /@media \(max-width: 620px\)/);
});


test("recovery source stores and logs neither OTP nor password", async () => {
  const [controller, service, handoff] = await Promise.all([
    readProjectFile("scripts/modules/password-recovery.js"),
    readProjectFile("scripts/services/auth-service.js"),
    readProjectFile("scripts/services/recovery-handoff.js"),
  ]);
  assert.doesNotMatch(controller, /localStorage|sessionStorage|document\.cookie|console\./);
  assert.doesNotMatch(service, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(handoff, /otp|password|token/i);
  assert.doesNotMatch(`${controller}\n${service}`, /[?&](?:otp|password|token)=/i);
});
