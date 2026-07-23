import {
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  isPasswordRecoverySession,
  requestPasswordReset,
  signOut,
  updatePassword,
  verifyRecoveryOtp,
} from "../services/auth-service.js?v=20260723-auth-config-v2";
import { preserveRecoveryEmailForSignIn } from "../services/recovery-handoff.js";


export const RECOVERY_OTP_COOLDOWN_MS = 60_000;
export const RECOVERY_OTP_LENGTH = 6;
export const NEUTRAL_RECOVERY_MESSAGE =
  "If an account is available for this email, a six-digit recovery code has been sent.";
const SAFE_MESSAGES = Object.freeze({
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_RECOVERY_OTP: "Enter the complete six-digit recovery code.",
  INVALID_OR_EXPIRED_RECOVERY_OTP:
    "The recovery code is invalid or has expired. Request a new code and try again.",
  RECOVERY_OTP_VERIFY_FAILED:
    "The recovery code is invalid or has expired. Request a new code and try again.",
  PASSWORD_UPDATE_SESSION_REQUIRED:
    "Your recovery session has expired. Request a new recovery code and try again.",
});
const VIEW_CONTENT = Object.freeze({
  email: Object.freeze({
    kicker: "Account recovery",
    title: "Forgot your password?",
    description:
      "Enter your email and we will send a six-digit code to help you choose a new password.",
  }),
  otp: Object.freeze({
    kicker: "Secure email check",
    title: "Check your email.",
    description:
      "Enter the six-digit recovery code sent to your email address.",
  }),
  password: Object.freeze({
    kicker: "Create a new password",
    title: "Choose a secure password.",
    description:
      "Your recovery code was verified. Create a new password for your KP AWAZ account.",
  }),
  success: Object.freeze({
    kicker: "Password updated",
    title: "Password updated.",
    description: "You can now sign in to KP AWAZ using your new password.",
  }),
});


export function normalizeRecoveryEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}


export function normalizeRecoveryOtp(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, "").slice(0, RECOVERY_OTP_LENGTH)
    : "";
}


export function isCompleteRecoveryOtp(value) {
  return /^\d{6}$/.test(normalizeRecoveryOtp(value));
}


export function validateNewPasswords(first, second) {
  if (
    typeof first !== "string" ||
    first.length < ACCOUNT_PASSWORD_MIN_LENGTH ||
    first.length > ACCOUNT_PASSWORD_MAX_LENGTH
  ) {
    return `Use a password between ${ACCOUNT_PASSWORD_MIN_LENGTH} and ${ACCOUNT_PASSWORD_MAX_LENGTH} characters.`;
  }
  if (first !== second) return "Passwords do not match.";
  return "";
}


function safeErrorMessage(error, fallback) {
  return SAFE_MESSAGES[error?.code] ?? fallback;
}


const defaultAuthApi = Object.freeze({
  isPasswordRecoverySession,
  requestPasswordReset,
  signOut,
  updatePassword,
  verifyRecoveryOtp,
});


export class PasswordRecovery {
  constructor({
    root = globalThis.document,
    authApi = defaultAuthApi,
    location = globalThis.location,
    preserveEmail = preserveRecoveryEmailForSignIn,
    clock = () => Date.now(),
    setIntervalImpl = (...args) => globalThis.setInterval(...args),
    clearIntervalImpl = (timer) => globalThis.clearInterval(timer),
  } = {}) {
    this._root = root;
    this._auth = authApi;
    this._location = location;
    this._preserveEmail = preserveEmail;
    this._clock = clock;
    this._setInterval = setIntervalImpl;
    this._clearInterval = clearIntervalImpl;
    this._elements = null;
    this._bindings = [];
    this._timer = null;
    this._resendAvailableAt = 0;
    this._state = "email";
    this._action = null;
    this._activeEmail = "";
    this._cleanupPending = false;
    this._initialized = false;
    this._destroyed = false;
  }

  initialize() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;
    this._initialized = true;
    this._destroyed = false;
    this._bindEvents();
    if (this._auth.isPasswordRecoverySession?.()) {
      this._state = "password";
    }
    this._render();
    const focusTarget =
      this._state === "password"
        ? this._elements.password
        : this._elements.email;
    focusTarget.focus?.();
    return true;
  }

  destroy() {
    if (this._destroyed) return;
    const temporarySessionActive =
      this._cleanupPending || this._auth.isPasswordRecoverySession?.();
    this._destroyed = true;
    this._initialized = false;
    this._stopCooldown();
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._clearSecrets();
    this._activeEmail = "";
    this._action = null;
    this._cleanupPending = false;
    if (temporarySessionActive) {
      void this._auth.signOut().catch(() => {});
    }
  }

  _resolveElements() {
    if (!this._root?.getElementById) return null;
    const ids = {
      card: "passwordRecoveryCard",
      kicker: "recoveryKicker",
      title: "recoveryTitle",
      description: "recoveryDescription",
      emailPanel: "recoveryEmailPanel",
      emailForm: "recoveryEmailForm",
      email: "recoveryEmail",
      send: "recoverySend",
      sendLabel: "recoverySendLabel",
      otpPanel: "recoveryOtpPanel",
      otpEmail: "recoveryOtpEmail",
      otpForm: "recoveryOtpForm",
      otp: "recoveryOtp",
      verify: "recoveryVerify",
      verifyLabel: "recoveryVerifyLabel",
      resend: "recoveryResend",
      resendLabel: "recoveryResendLabel",
      changeEmail: "recoveryChangeEmail",
      passwordPanel: "recoveryPasswordPanel",
      passwordForm: "recoveryPasswordForm",
      password: "recoveryPassword",
      confirmation: "recoveryPasswordConfirm",
      togglePassword: "toggleRecoveryPassword",
      toggleConfirmation: "toggleRecoveryPasswordConfirm",
      update: "recoveryUpdate",
      updateLabel: "recoveryUpdateLabel",
      successPanel: "recoverySuccessPanel",
      returnToSignIn: "recoveryReturnToSignIn",
      cancel: "recoveryCancel",
      message: "recoveryMessage",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, this._root.getElementById(id)]),
    );
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.emailForm, "submit", (event) => {
      event.preventDefault();
      void this._requestCode();
    });
    this._listen(this._elements.otpForm, "submit", (event) => {
      event.preventDefault();
      void this._verifyCode();
    });
    this._listen(this._elements.passwordForm, "submit", (event) => {
      event.preventDefault();
      void this._updatePassword();
    });
    this._listen(this._elements.otp, "input", () => {
      this._elements.otp.value = normalizeRecoveryOtp(this._elements.otp.value);
      this._elements.otp.setCustomValidity("");
    });
    this._listen(this._elements.resend, "click", () => {
      void this._resendCode();
    });
    this._listen(this._elements.changeEmail, "click", () => {
      void this._changeEmail();
    });
    this._listen(this._elements.cancel, "click", () => {
      void this._returnToSignIn({ preserveEmail: true });
    });
    this._listen(this._elements.returnToSignIn, "click", () => {
      void this._returnToSignIn({ preserveEmail: true });
    });
    this._listen(this._elements.togglePassword, "click", () => {
      this._togglePassword(this._elements.password, this._elements.togglePassword);
    });
    this._listen(this._elements.toggleConfirmation, "click", () => {
      this._togglePassword(
        this._elements.confirmation,
        this._elements.toggleConfirmation,
      );
    });
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  async _requestCode() {
    if (!this._beginAction("request")) return;
    if (!this._elements.emailForm.checkValidity()) {
      this._elements.emailForm.reportValidity?.();
      this._finishAction();
      return;
    }
    try {
      const normalizedEmail = normalizeRecoveryEmail(this._elements.email.value);
      const result = await this._auth.requestPasswordReset(normalizedEmail);
      this._activeEmail = normalizeRecoveryEmail(
        result?.email ?? this._elements.email.value,
      );
      this._state = "otp";
      this._startCooldown();
      this._setMessage(NEUTRAL_RECOVERY_MESSAGE, "success");
      this._render();
      this._elements.otp.focus?.();
    } catch (error) {
      this._setMessage(
        safeErrorMessage(
          error,
          "We could not send the recovery code. Please try again.",
        ),
        "error",
      );
    } finally {
      this._finishAction();
    }
  }

  async _resendCode() {
    if (
      !this._activeEmail ||
      this._resendSecondsRemaining() > 0 ||
      !this._beginAction("resend")
    ) {
      return;
    }
    this._elements.otp.value = "";
    try {
      await this._auth.requestPasswordReset(this._activeEmail);
      this._startCooldown();
      this._setMessage(NEUTRAL_RECOVERY_MESSAGE, "success");
    } catch {
      this._setMessage(
        "We could not resend the recovery code. Please try again.",
        "error",
      );
    } finally {
      this._finishAction();
    }
  }

  async _verifyCode() {
    if (!this._beginAction("verify")) return;
    const otp = normalizeRecoveryOtp(this._elements.otp.value);
    this._elements.otp.value = otp;
    if (!isCompleteRecoveryOtp(otp)) {
      this._elements.otp.setCustomValidity(
        "Enter the complete six-digit recovery code.",
      );
      this._elements.otp.reportValidity?.();
      this._setMessage(SAFE_MESSAGES.INVALID_RECOVERY_OTP, "error");
      this._finishAction();
      return;
    }
    try {
      await this._auth.verifyRecoveryOtp(this._activeEmail, otp);
      this._elements.otp.value = "";
      this._stopCooldown();
      this._state = "password";
      this._setMessage("", "");
      this._render();
      this._elements.password.focus?.();
    } catch (error) {
      this._elements.otp.value = "";
      this._setMessage(
        safeErrorMessage(error, SAFE_MESSAGES.RECOVERY_OTP_VERIFY_FAILED),
        "error",
      );
    } finally {
      this._finishAction();
    }
  }

  async _updatePassword() {
    if (!this._beginAction("update")) return;
    const validation = validateNewPasswords(
      this._elements.password.value,
      this._elements.confirmation.value,
    );
    if (validation) {
      this._setMessage(validation, "error");
      this._clearPasswords();
      this._elements.password.focus?.();
      this._finishAction();
      return;
    }
    try {
      await this._auth.updatePassword(this._elements.password.value);
      this._clearPasswords();
      this._elements.otp.value = "";
      this._stopCooldown();
      try {
        await this._auth.signOut();
        this._cleanupPending = false;
      } catch {
        this._cleanupPending = true;
      }
      this._state = "success";
      this._setMessage(
        this._cleanupPending
          ? "Your password was updated, but the temporary recovery session still needs to be closed. Return to Sign In to retry safely."
          : "Your password has been updated.",
        this._cleanupPending ? "error" : "success",
      );
      this._render();
      this._elements.returnToSignIn.focus?.();
    } catch (error) {
      this._clearPasswords();
      this._setMessage(
        safeErrorMessage(
          error,
          "We could not update the password. Request a new recovery code and try again.",
        ),
        "error",
      );
    } finally {
      this._finishAction();
    }
  }

  async _changeEmail() {
    if (this._action) return;
    await this._closeTemporarySession();
    this._stopCooldown();
    this._clearSecrets();
    this._activeEmail = "";
    this._state = "email";
    this._setMessage("", "");
    this._render();
    this._elements.email.value = "";
    this._elements.email.focus?.();
  }

  async _returnToSignIn({ preserveEmail = false } = {}) {
    if (this._action) return;
    this._action = "cancel";
    this._render();
    await this._closeTemporarySession();
    const email = this._activeEmail;
    this._stopCooldown();
    this._clearSecrets();
    if (preserveEmail && email) this._preserveEmail(email);
    this._activeEmail = "";
    this._location?.assign?.("auth.html");
  }

  async _closeTemporarySession() {
    if (!this._cleanupPending && !this._auth.isPasswordRecoverySession?.()) return;
    try {
      await this._auth.signOut();
      this._cleanupPending = false;
    } catch {
      this._cleanupPending = true;
    }
  }

  _togglePassword(input, button) {
    if (this._action) return;
    const revealing = input.type === "password";
    input.type = revealing ? "text" : "password";
    button.textContent = revealing ? "Hide" : "Show";
    button.setAttribute("aria-pressed", String(revealing));
    button.setAttribute(
      "aria-label",
      `${revealing ? "Hide" : "Show"} ${input === this._elements.confirmation ? "confirmed " : ""}password`,
    );
    input.focus?.();
  }

  _beginAction(action) {
    if (this._destroyed || this._action) return false;
    this._action = action;
    this._setMessage("", "");
    this._render();
    return true;
  }

  _finishAction() {
    this._action = null;
    this._render();
  }

  _setMessage(message, tone) {
    this._elements.message.textContent = message;
    this._elements.message.dataset.tone = tone;
    this._elements.message.hidden = !message;
  }

  _startCooldown() {
    this._stopCooldown();
    this._resendAvailableAt = this._clock() + RECOVERY_OTP_COOLDOWN_MS;
    this._timer = this._setInterval(() => {
      if (this._resendSecondsRemaining() <= 0) this._stopCooldown();
      this._render();
    }, 1_000);
  }

  _stopCooldown() {
    if (this._timer !== null) this._clearInterval(this._timer);
    this._timer = null;
    this._resendAvailableAt = 0;
  }

  _resendSecondsRemaining() {
    return Math.max(
      0,
      Math.ceil((this._resendAvailableAt - this._clock()) / 1_000),
    );
  }

  _clearPasswords() {
    this._elements.password.value = "";
    this._elements.confirmation.value = "";
    for (const [input, button] of [
      [this._elements.password, this._elements.togglePassword],
      [this._elements.confirmation, this._elements.toggleConfirmation],
    ]) {
      input.type = "password";
      button.textContent = "Show";
      button.setAttribute("aria-pressed", "false");
    }
  }

  _clearSecrets() {
    if (!this._elements) return;
    this._elements.otp.value = "";
    this._elements.otp.setCustomValidity("");
    this._clearPasswords();
  }

  _render() {
    if (!this._elements || this._destroyed) return;
    const view = VIEW_CONTENT[this._state] ?? VIEW_CONTENT.email;
    this._root.body?.setAttribute?.("data-recovery-state", this._state);
    this._elements.kicker.textContent = view.kicker;
    this._elements.title.textContent = view.title;
    this._elements.description.textContent = view.description;
    this._elements.emailPanel.hidden = this._state !== "email";
    this._elements.otpPanel.hidden = this._state !== "otp";
    this._elements.passwordPanel.hidden = this._state !== "password";
    this._elements.successPanel.hidden = this._state !== "success";
    this._elements.cancel.hidden = this._state === "success";
    this._elements.otpEmail.textContent = this._activeEmail;

    const requesting = this._action === "request";
    const resending = this._action === "resend";
    const verifying = this._action === "verify";
    const updating = this._action === "update";
    const cancelling = this._action === "cancel";

    this._elements.email.disabled = requesting;
    this._elements.send.disabled = requesting;
    this._elements.send.setAttribute("aria-busy", String(requesting));
    this._elements.sendLabel.textContent = requesting
      ? "Sending recovery code…"
      : "Send recovery code";

    this._elements.otp.disabled = verifying;
    this._elements.verify.disabled = verifying || resending;
    this._elements.verify.setAttribute("aria-busy", String(verifying));
    this._elements.verifyLabel.textContent = verifying
      ? "Verifying recovery code…"
      : "Verify and continue";

    const seconds = this._resendSecondsRemaining();
    this._elements.resend.disabled = verifying || resending || seconds > 0;
    this._elements.resendLabel.textContent =
      seconds > 0
        ? `Resend code in ${seconds}s`
        : resending
          ? "Resending code…"
          : "Resend code";
    this._elements.changeEmail.disabled = verifying || resending;

    for (const element of [
      this._elements.password,
      this._elements.confirmation,
      this._elements.togglePassword,
      this._elements.toggleConfirmation,
      this._elements.update,
    ]) {
      element.disabled = updating;
    }
    this._elements.update.setAttribute("aria-busy", String(updating));
    this._elements.updateLabel.textContent = updating
      ? "Updating password…"
      : "Update password";
    this._elements.cancel.disabled = cancelling;
    this._elements.returnToSignIn.disabled = cancelling;
  }
}
