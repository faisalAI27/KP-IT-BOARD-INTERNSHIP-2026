import {
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  EMAIL_OTP_LENGTH,
  getCurrentAuthState,
  initializeAuthService,
  resendSignupOtp,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
  subscribeToAuthChanges,
  verifySignupOtp,
} from "../services/auth-service.js?v=20260717-auth-routing";
import { updateMyProfile } from "../services/profile-api.js?v=20260717-member-workspace";
import {
  navigateOnce,
  routeDecision,
  safeProtectedDestination,
} from "../services/route-guard.js?v=20260717-auth-routing";
import { withRequestTimeout } from "../services/request-timeout.js?v=20260717-auth-routing";


export const SIGNUP_OTP_COOLDOWN_MS = 60_000;
export const SUCCESS_REDIRECT_DELAY_MS = 650;
const ALLOWED_DESTINATIONS = new Set([
  "dashboard.html",
  "contribute.html",
  "my-contributions.html",
  "profile.html",
  "settings.html",
]);
const SAFE_MESSAGES = Object.freeze({
  AUTH_NOT_CONFIGURED: "Account access is not configured yet.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PASSWORD: `Use a password between ${ACCOUNT_PASSWORD_MIN_LENGTH} and ${ACCOUNT_PASSWORD_MAX_LENGTH} characters.`,
  INVALID_DISPLAY_NAME: "Display name must contain between 2 and 80 characters.",
  PASSWORD_SIGN_UP_FAILED:
    "We could not create your account. Please try again.",
  PASSWORD_SIGN_IN_FAILED:
    "We could not sign you in. Please check your information and try again.",
  INVALID_SIGNUP_OTP: "Enter the complete six-digit code.",
  INVALID_OR_EXPIRED_SIGNUP_OTP:
    "Invalid or expired code. Request a new code and try again.",
  SIGNUP_OTP_VERIFY_FAILED: "We could not verify the code. Please try again.",
  SIGNUP_OTP_RESEND_FAILED:
    "We could not resend the verification code. Please try again.",
  ACCOUNT_VERIFICATION_FAILED:
    "Your account exists, but KP AWAZ could not verify the session. Please sign in again.",
  AUTH_REQUEST_TIMEOUT:
    "We could not complete the authentication request. Please try again.",
});

const ACCESS_VIEW_CONTENT = Object.freeze({
  sign_in: Object.freeze({
    storyContext: "Welcome back to the community",
    storyTitle: "Our voices belong in the digital future.",
    storyMessage:
      "Continue preserving the voices and languages of Khyber Pakhtunkhwa.",
    cardKicker: "Contributor sign in",
    cardTitle: "Welcome back.",
    cardSubtitle: "Sign in to continue your contribution journey.",
  }),
  create: Object.freeze({
    storyContext: "Add your voice to our shared future",
    storyTitle: "Our voices belong in the digital future.",
    storyMessage:
      "Create your contributor identity and begin sharing language recordings.",
    cardKicker: "New contributor",
    cardTitle: "Join KP AWAZ.",
    cardSubtitle: "Create your private contributor identity in two short steps.",
  }),
  otp: Object.freeze({
    storyContext: "One final step",
    storyTitle: "Our voices belong in the digital future.",
    storyMessage:
      "Verify your email before your contribution journey begins.",
    cardKicker: "Check your inbox",
    cardTitle: "Verify your email.",
    cardSubtitle: "Enter the six-digit code to finish creating your account.",
  }),
  success: Object.freeze({
    storyContext: "Identity verified",
    storyTitle: "Our voices belong in the digital future.",
    storyMessage:
      "Your secure workspace is ready for the stories, accents, and language knowledge only you can share.",
    cardKicker: "Identity verified",
    cardTitle: "Welcome to KP AWAZ.",
    cardSubtitle: "Your contributor workspace is ready.",
  }),
});


export function normalizeSignupOtp(value) {
  return typeof value === "string"
    ? value.replace(/[\s-]+/g, "").slice(0, 6)
    : "";
}


export function isCompleteSignupOtp(value) {
  return new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`).test(
    normalizeSignupOtp(value),
  );
}


export function nextAccessModeForKey(key, currentMode) {
  if (key === "Home") return "sign_in";
  if (key === "End") return "create";
  if (["ArrowRight", "ArrowDown"].includes(key)) {
    return currentMode === "sign_in" ? "create" : "sign_in";
  }
  if (["ArrowLeft", "ArrowUp"].includes(key)) {
    return currentMode === "create" ? "sign_in" : "create";
  }
  return null;
}


export function passwordFeedback(password, confirmation) {
  const passwordValue = typeof password === "string" ? password : "";
  const confirmationValue = typeof confirmation === "string" ? confirmation : "";
  const length = passwordValue.length;
  return Object.freeze({
    length:
      length === 0
        ? "neutral"
        : length >= ACCOUNT_PASSWORD_MIN_LENGTH &&
            length <= ACCOUNT_PASSWORD_MAX_LENGTH
          ? "valid"
          : "invalid",
    match:
      confirmationValue.length === 0
        ? "neutral"
        : passwordValue === confirmationValue
          ? "valid"
          : "invalid",
  });
}


export function accessViewContent(mode, createStep = "details", success = false) {
  if (success) return ACCESS_VIEW_CONTENT.success;
  if (mode === "create" && createStep === "otp") return ACCESS_VIEW_CONTENT.otp;
  return ACCESS_VIEW_CONTENT[mode] ?? ACCESS_VIEW_CONTENT.sign_in;
}


export function resolveWorkspaceDestination(search = globalThis.location?.search) {
  let requested = "";
  try {
    requested = new URLSearchParams(search ?? "").get("next")?.trim() ?? "";
  } catch {
    requested = "";
  }
  return safeProtectedDestination(
    ALLOWED_DESTINATIONS.has(requested) ? requested : "",
  );
}


function safeErrorMessage(error, fallback) {
  const code = typeof error?.code === "string" ? error.code : "";
  return SAFE_MESSAGES[code] ?? fallback;
}


const defaultAuthApi = Object.freeze({
  getCurrentAuthState,
  initializeAuthService,
  resendSignupOtp,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
  subscribeToAuthChanges,
  verifySignupOtp,
});


export class AccountAccess {
  constructor({
    root = globalThis.document,
    authApi = defaultAuthApi,
    profileApi = { updateMyProfile },
    location = globalThis.location,
    clock = () => Date.now(),
    setIntervalImpl = (...args) => globalThis.setInterval(...args),
    clearIntervalImpl = (timer) => globalThis.clearInterval(timer),
    setTimeoutImpl = (...args) => globalThis.setTimeout(...args),
    clearTimeoutImpl = (timer) => globalThis.clearTimeout(timer),
  } = {}) {
    this._root = root;
    this._auth = authApi;
    this._profile = profileApi;
    this._location = location;
    this._clock = clock;
    this._setInterval = setIntervalImpl;
    this._clearInterval = clearIntervalImpl;
    this._setTimeout = setTimeoutImpl;
    this._clearTimeout = clearTimeoutImpl;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._timer = null;
    this._successTimer = null;
    this._initialized = false;
    this._destroyed = false;
    this._action = null;
    this._mode = "sign_in";
    this._createStep = "details";
    this._success = false;
    this._activeEmail = "";
    this._activeDisplayName = "";
    this._resendAvailableAt = 0;
    this._destination = resolveWorkspaceDestination(location?.search);
    this._navigating = false;
  }

  async initialize() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;

    this._initialized = true;
    this._destroyed = false;
    this._bindEvents();
    this._render();
    this._unsubscribe = this._auth.subscribeToAuthChanges((state) => {
      this._handleAuthState(state);
    });

    try {
      const state = await this._auth.initializeAuthService();
      this._handleAuthState(state);
    } catch {
      this._setMessage(
        this._elements.pageMessage,
        "Account access could not be started. Please reload the page.",
        "error",
      );
    }
    return true;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._initialized = false;
    this._stopCooldown();
    this._stopSuccessTransition();
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._clearSecrets();
    this._activeEmail = "";
    this._activeDisplayName = "";
    this._action = null;
    this._success = false;
  }

  _resolveElements() {
    if (!this._root?.getElementById) return null;
    const ids = {
      accessRoot: "accountAccess",
      interactiveContent: "accountInteractiveContent",
      successState: "accountSuccessState",
      storyContext: "accessStoryContext",
      storyTitle: "accessStoryTitle",
      storyMessage: "accessStoryMessage",
      cardKicker: "accessCardKicker",
      cardTitle: "accessTitle",
      cardSubtitle: "accessSubtitle",
      createTab: "createAccountTab",
      signInTab: "passwordSignInTab",
      switchToSignIn: "switchToSignInButton",
      switchToCreate: "switchToCreateButton",
      createPanel: "createAccountPanel",
      signInPanel: "passwordSignInPanel",
      detailsPanel: "accountDetailsStep",
      otpPanel: "accountOtpStep",
      createForm: "createAccountForm",
      displayName: "createDisplayName",
      createEmail: "createEmail",
      createPassword: "createPassword",
      confirmPassword: "confirmPassword",
      toggleCreatePassword: "toggleCreatePassword",
      toggleConfirmPassword: "toggleConfirmPassword",
      createSubmit: "createAccountSubmit",
      createSubmitLabel: "createAccountSubmitLabel",
      createMessage: "createAccountMessage",
      otpEmail: "signupOtpEmail",
      otpForm: "signupOtpForm",
      otpInput: "signupOtpInput",
      otpSubmit: "signupOtpSubmit",
      otpSubmitLabel: "signupOtpSubmitLabel",
      otpMessage: "signupOtpMessage",
      resendButton: "resendSignupOtpButton",
      resendLabel: "resendSignupOtpLabel",
      changeEmailButton: "changeSignupEmailButton",
      cancelOtpButton: "cancelSignupOtpButton",
      signInForm: "passwordSignInForm",
      signInEmail: "passwordSignInEmail",
      signInPassword: "passwordSignInPassword",
      toggleSignInPassword: "toggleSignInPassword",
      signInSubmit: "passwordSignInSubmit",
      signInSubmitLabel: "passwordSignInSubmitLabel",
      signInMessage: "passwordSignInMessage",
      googleButton: "accountGoogleButton",
      googleLabel: "accountGoogleButtonLabel",
      pageMessage: "accountAccessMessage",
      stepDetails: "accountStepDetails",
      stepVerify: "accountStepVerify",
      stepReady: "accountStepReady",
      passwordLengthFeedback: "passwordLengthFeedback",
      passwordMatchFeedback: "passwordMatchFeedback",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, this._root.getElementById(id)]),
    );
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.createTab, "click", () => this._setMode("create"));
    this._listen(this._elements.signInTab, "click", () => this._setMode("sign_in"));
    for (const tab of [this._elements.signInTab, this._elements.createTab]) {
      this._listen(tab, "keydown", (event) => this._handleTabKeydown(event));
    }
    this._listen(this._elements.switchToSignIn, "click", () => this._setMode("sign_in"));
    this._listen(this._elements.switchToCreate, "click", () => this._setMode("create"));
    this._listen(this._elements.createForm, "submit", (event) => {
      event.preventDefault();
      void this._createAccount();
    });
    this._listen(this._elements.otpForm, "submit", (event) => {
      event.preventDefault();
      void this._verifyAccount();
    });
    this._listen(this._elements.signInForm, "submit", (event) => {
      event.preventDefault();
      void this._signIn();
    });
    this._listen(this._elements.googleButton, "click", () => {
      void this._continueWithGoogle();
    });
    this._listen(this._elements.toggleCreatePassword, "click", () => {
      this._togglePassword(
        this._elements.createPassword,
        this._elements.toggleCreatePassword,
      );
    });
    this._listen(this._elements.toggleConfirmPassword, "click", () => {
      this._togglePassword(
        this._elements.confirmPassword,
        this._elements.toggleConfirmPassword,
      );
    });
    this._listen(this._elements.toggleSignInPassword, "click", () => {
      this._togglePassword(
        this._elements.signInPassword,
        this._elements.toggleSignInPassword,
      );
    });
    this._listen(this._elements.otpInput, "input", () => {
      this._elements.otpInput.value = normalizeSignupOtp(
        this._elements.otpInput.value,
      );
      this._elements.otpInput.setCustomValidity("");
    });
    for (const input of [
      this._elements.createPassword,
      this._elements.confirmPassword,
    ]) {
      this._listen(input, "input", () => this._updatePasswordFeedback());
    }
    this._listen(this._elements.resendButton, "click", () => {
      void this._resendCode();
    });
    this._listen(this._elements.changeEmailButton, "click", () => {
      this._returnToDetails();
    });
    this._listen(this._elements.cancelOtpButton, "click", () => {
      this._clearSignupState();
      this._setMode("sign_in");
    });
    this._listen(this._root, "keydown", (event) => {
      if (event.key === "Escape" && this._mode === "create" && this._createStep === "otp") {
        event.preventDefault();
        this._clearSignupState();
        this._setMode("sign_in");
      }
    });
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _handleTabKeydown(event) {
    const nextMode = nextAccessModeForKey(event.key, this._mode);
    if (!nextMode) return;
    event.preventDefault();
    this._setMode(nextMode);
    const tab = nextMode === "create" ? this._elements.createTab : this._elements.signInTab;
    tab.focus?.();
  }

  _updatePasswordFeedback() {
    const feedback = passwordFeedback(
      this._elements.createPassword.value,
      this._elements.confirmPassword.value,
    );
    this._elements.passwordLengthFeedback.dataset.state = feedback.length;
    this._elements.passwordMatchFeedback.dataset.state = feedback.match;
    this._elements.passwordLengthFeedback.textContent = `${feedback.length === "valid" ? "✓" : feedback.length === "invalid" ? "!" : "○"} 8–72 characters`;
    this._elements.passwordMatchFeedback.textContent = `${feedback.match === "valid" ? "✓" : feedback.match === "invalid" ? "!" : "○"} Both passwords match`;
    this._elements.confirmPassword.setCustomValidity(
      feedback.match === "invalid" ? "Passwords do not match." : "",
    );
  }

  _handleAuthState(state) {
    if (this._destroyed) return;
    const decision = routeDecision({ pathname: "auth.html", state });
    if (decision.action === "redirect" && !this._action) {
      if (this._success) return;
      this._goToWorkspace();
      return;
    }
    if (state?.error?.code === "AUTH_NOT_CONFIGURED") {
      this._setMessage(
        this._elements.pageMessage,
        SAFE_MESSAGES.AUTH_NOT_CONFIGURED,
        "error",
      );
      this._elements.createSubmit.disabled = true;
      this._elements.signInSubmit.disabled = true;
      this._elements.googleButton.disabled = true;
      return;
    }
    if (state?.error?.code === "AUTH_REQUEST_TIMEOUT") {
      this._setMessage(
        this._elements.pageMessage,
        SAFE_MESSAGES.AUTH_REQUEST_TIMEOUT,
        "error",
      );
    }
  }

  _setMode(mode) {
    if (this._action || !["create", "sign_in"].includes(mode)) return;
    if (mode === this._mode && this._createStep === "details") return;
    this._mode = mode;
    this._success = false;
    this._clearSecrets();
    this._clearMessages();
    if (mode === "sign_in") this._clearSignupState();
    this._render();
    const target =
      mode === "create" ? this._elements.displayName : this._elements.signInEmail;
    target.focus?.();
  }

  async _createAccount() {
    if (!this._beginAction("create")) return;
    const form = this._elements.createForm;
    const displayName = this._elements.displayName.value.trim();
    const email = this._elements.createEmail.value;
    const password = this._elements.createPassword.value;
    const confirmation = this._elements.confirmPassword.value;
    this._elements.confirmPassword.setCustomValidity(
      password === confirmation ? "" : "Passwords do not match.",
    );
    this._updatePasswordFeedback();

    if (!form.checkValidity() || password !== confirmation) {
      form.reportValidity?.();
      this._finishAction();
      return;
    }

    try {
      const result = await this._auth.signUpWithPassword({
        email,
        password,
        displayName,
      });
      this._elements.createPassword.value = "";
      this._elements.confirmPassword.value = "";
      this._activeEmail = result.email;
      this._activeDisplayName = displayName;

      if (!result.verificationRequired) {
        await this._saveInitialDisplayName();
        this._showSuccessAndNavigate();
        return;
      }

      this._createStep = "otp";
      this._startCooldown();
      this._setMessage(
        this._elements.otpMessage,
        "Verification code sent. Check your email to finish creating your account.",
        "success",
      );
      this._elements.otpInput.focus?.();
    } catch (error) {
      this._setMessage(
        this._elements.createMessage,
        safeErrorMessage(error, "We could not create your account. Please try again."),
        "error",
      );
      this._elements.createPassword.value = "";
      this._elements.confirmPassword.value = "";
    } finally {
      this._finishAction();
    }
  }

  async _verifyAccount() {
    if (!this._beginAction("verify")) return;
    const otp = normalizeSignupOtp(this._elements.otpInput.value);
    this._elements.otpInput.value = otp;
    if (!isCompleteSignupOtp(otp)) {
      this._elements.otpInput.setCustomValidity(
        "Enter the complete six-digit code.",
      );
      this._elements.otpInput.reportValidity?.();
      this._setMessage(
        this._elements.otpMessage,
        SAFE_MESSAGES.INVALID_SIGNUP_OTP,
        "error",
      );
      this._finishAction();
      return;
    }

    try {
      await this._auth.verifySignupOtp(this._activeEmail, otp);
      this._elements.otpInput.value = "";
      await this._saveInitialDisplayName();
      this._createStep = "ready";
      this._showSuccessAndNavigate();
    } catch (error) {
      this._elements.otpInput.value = "";
      this._setMessage(
        this._elements.otpMessage,
        safeErrorMessage(error, "We could not verify the code. Please try again."),
        "error",
      );
    } finally {
      this._finishAction();
    }
  }

  async _signIn() {
    if (!this._beginAction("sign_in")) return;
    const form = this._elements.signInForm;
    if (!form.checkValidity()) {
      form.reportValidity?.();
      this._finishAction();
      return;
    }

    try {
      await this._auth.signInWithPassword({
        email: this._elements.signInEmail.value,
        password: this._elements.signInPassword.value,
      });
      this._elements.signInPassword.value = "";
      this._showSuccessAndNavigate();
    } catch (error) {
      this._elements.signInPassword.value = "";
      this._setMessage(
        this._elements.signInMessage,
        safeErrorMessage(error, "We could not sign in. Please try again."),
        "error",
      );
    } finally {
      this._finishAction();
    }
  }

  async _continueWithGoogle() {
    if (!this._beginAction("google")) return;
    try {
      await this._auth.signInWithGoogle();
    } catch (error) {
      this._setMessage(
        this._elements.pageMessage,
        safeErrorMessage(
          error,
          "Google sign-in could not be completed. Please try again.",
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
    this._elements.otpInput.value = "";
    try {
      await this._auth.resendSignupOtp(this._activeEmail);
      this._startCooldown();
      this._setMessage(
        this._elements.otpMessage,
        "A new verification code has been sent.",
        "success",
      );
    } catch (error) {
      this._setMessage(
        this._elements.otpMessage,
        safeErrorMessage(error, SAFE_MESSAGES.SIGNUP_OTP_RESEND_FAILED),
        "error",
      );
    } finally {
      this._finishAction();
    }
  }

  async _saveInitialDisplayName() {
    if (!this._activeDisplayName) return;
    try {
      await withRequestTimeout(() =>
        this._profile.updateMyProfile({
          displayName: this._activeDisplayName,
        }),
      );
    } catch {
      // Account creation succeeded; profile settings can be completed later.
    }
  }

  _returnToDetails() {
    if (this._action) return;
    const email = this._activeEmail;
    this._clearSignupState();
    this._elements.createEmail.value = email;
    this._render();
    this._elements.createEmail.focus?.();
  }

  _clearSignupState() {
    this._stopCooldown();
    this._elements.otpInput.value = "";
    this._elements.otpInput.setCustomValidity("");
    this._elements.createPassword.value = "";
    this._elements.confirmPassword.value = "";
    this._activeEmail = "";
    this._activeDisplayName = "";
    this._createStep = "details";
    this._updatePasswordFeedback();
  }

  _clearSecrets() {
    if (!this._elements) return;
    this._elements.createPassword.value = "";
    this._elements.confirmPassword.value = "";
    this._elements.signInPassword.value = "";
    this._elements.otpInput.value = "";
    this._elements.confirmPassword.setCustomValidity("");
    this._elements.otpInput.setCustomValidity("");
    for (const [input, button] of [
      [this._elements.createPassword, this._elements.toggleCreatePassword],
      [this._elements.confirmPassword, this._elements.toggleConfirmPassword],
      [this._elements.signInPassword, this._elements.toggleSignInPassword],
    ]) {
      input.type = "password";
      button.setAttribute("aria-pressed", "false");
      button.textContent = "Show";
    }
    this._updatePasswordFeedback();
  }

  _togglePassword(input, button) {
    if (this._action) return;
    const revealing = input.type === "password";
    input.type = revealing ? "text" : "password";
    button.setAttribute("aria-pressed", String(revealing));
    button.textContent = revealing ? "Hide" : "Show";
    button.setAttribute(
      "aria-label",
      `${revealing ? "Hide" : "Show"} ${input.id === "confirmPassword" ? "confirmed " : ""}password`,
    );
    input.focus?.();
  }

  _beginAction(action) {
    if (this._destroyed || this._action) return false;
    this._action = action;
    this._clearMessages();
    this._render();
    return true;
  }

  _finishAction() {
    this._action = null;
    this._render();
  }

  _clearMessages() {
    if (!this._elements) return;
    for (const element of [
      this._elements.pageMessage,
      this._elements.createMessage,
      this._elements.otpMessage,
      this._elements.signInMessage,
    ]) {
      this._setMessage(element, "", "");
    }
  }

  _setMessage(element, message, tone) {
    element.textContent = message;
    element.dataset.tone = tone;
    element.hidden = !message;
  }

  _startCooldown() {
    this._stopCooldown();
    this._resendAvailableAt = this._clock() + SIGNUP_OTP_COOLDOWN_MS;
    this._timer = this._setInterval(() => {
      if (this._resendSecondsRemaining() <= 0) this._stopCooldown();
      this._render();
    }, 1_000);
    this._render();
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

  _showSuccessAndNavigate() {
    if (this._destroyed || this._navigating) return;
    this._stopCooldown();
    this._clearSecrets();
    this._activeEmail = "";
    this._activeDisplayName = "";
    this._action = null;
    this._success = true;
    this._createStep = "ready";
    this._render();
    this._stopSuccessTransition();
    this._successTimer = this._setTimeout(() => {
      this._successTimer = null;
      this._goToWorkspace();
    }, SUCCESS_REDIRECT_DELAY_MS);
  }

  _stopSuccessTransition() {
    if (this._successTimer !== null) this._clearTimeout(this._successTimer);
    this._successTimer = null;
  }

  _goToWorkspace() {
    if (this._navigating) return;
    this._navigating = true;
    this._stopSuccessTransition();
    this._clearSecrets();
    this._activeEmail = "";
    this._activeDisplayName = "";
    navigateOnce(this._location, this._destination, { replace: true });
  }

  _render() {
    if (!this._elements || this._destroyed) return;
    const createMode = this._mode === "create";
    const otpStep = this._createStep === "otp";
    const view = accessViewContent(this._mode, this._createStep, this._success);

    this._root.body?.setAttribute?.(
      "data-auth-view",
      this._success ? "success" : otpStep ? "otp" : this._mode,
    );
    this._elements.storyContext.textContent = view.storyContext;
    this._elements.storyTitle.textContent = view.storyTitle;
    this._elements.storyMessage.textContent = view.storyMessage;
    this._elements.cardKicker.textContent = view.cardKicker;
    this._elements.cardTitle.textContent = view.cardTitle;
    this._elements.cardSubtitle.textContent = view.cardSubtitle;
    this._elements.interactiveContent.hidden = this._success;
    this._elements.successState.hidden = !this._success;
    this._elements.accessRoot.removeAttribute?.("aria-busy");

    this._elements.createTab.setAttribute("aria-selected", String(createMode));
    this._elements.signInTab.setAttribute("aria-selected", String(!createMode));
    this._elements.createTab.setAttribute("tabindex", createMode ? "0" : "-1");
    this._elements.signInTab.setAttribute("tabindex", createMode ? "-1" : "0");
    this._elements.createTab.classList.toggle("is-active", createMode);
    this._elements.signInTab.classList.toggle("is-active", !createMode);
    this._elements.createTab.disabled = false;
    this._elements.signInTab.disabled = false;
    this._elements.createPanel.hidden = !createMode || this._success;
    this._elements.signInPanel.hidden = createMode || this._success;
    this._elements.detailsPanel.hidden = otpStep;
    this._elements.otpPanel.hidden = !otpStep;
    this._elements.otpEmail.textContent = this._activeEmail;

    this._elements.stepDetails.dataset.state = otpStep ? "complete" : "active";
    this._elements.stepVerify.dataset.state =
      this._createStep === "ready" ? "complete" : otpStep ? "active" : "upcoming";
    this._elements.stepReady.dataset.state =
      this._createStep === "ready" ? "active" : "upcoming";

    const creating = this._action === "create";
    const verifying = this._action === "verify";
    const signingIn = this._action === "sign_in";
    const usingGoogle = this._action === "google";
    const resending = this._action === "resend";
    this._elements.createForm.setAttribute("aria-busy", String(creating));
    this._elements.otpForm.setAttribute("aria-busy", String(verifying || resending));
    this._elements.signInForm.setAttribute("aria-busy", String(signingIn));
    for (const element of [
      this._elements.displayName,
      this._elements.createEmail,
      this._elements.createPassword,
      this._elements.confirmPassword,
      this._elements.toggleCreatePassword,
      this._elements.toggleConfirmPassword,
      this._elements.createSubmit,
    ]) element.disabled = creating;
    this._elements.otpInput.disabled = verifying;
    this._elements.otpSubmit.disabled = verifying;
    this._elements.signInEmail.disabled = signingIn;
    this._elements.signInPassword.disabled = signingIn;
    this._elements.toggleSignInPassword.disabled = signingIn;
    this._elements.signInSubmit.disabled = signingIn;
    this._elements.googleButton.disabled = usingGoogle;
    this._elements.createSubmit.setAttribute(
      "aria-busy",
      String(creating),
    );
    this._elements.createSubmitLabel.textContent =
      this._action === "create" ? "Creating your account…" : "Create account";
    this._elements.otpSubmit.setAttribute(
      "aria-busy",
      String(verifying),
    );
    this._elements.otpSubmitLabel.textContent =
      this._action === "verify" ? "Verifying your email…" : "Verify and continue";
    this._elements.signInSubmit.setAttribute(
      "aria-busy",
      String(signingIn),
    );
    this._elements.signInSubmitLabel.textContent =
      this._action === "sign_in" ? "Signing you in…" : "Sign in to workspace";
    this._elements.googleButton.setAttribute(
      "aria-busy",
      String(usingGoogle),
    );
    this._elements.googleLabel.textContent =
      this._action === "google" ? "Continuing with Google…" : "Continue with Google";

    const seconds = this._resendSecondsRemaining();
    this._elements.resendButton.disabled = resending || verifying || seconds > 0;
    this._elements.resendLabel.textContent =
      seconds > 0 ? `Resend code in ${seconds}s` : "Resend verification code";
    this._elements.changeEmailButton.disabled = verifying;
    this._elements.cancelOtpButton.disabled = verifying;
    this._updatePasswordFeedback();
  }
}


const accountAccess = new AccountAccess();


export const initializeAccountAccess = () => accountAccess.initialize();
export const destroyAccountAccess = () => accountAccess.destroy();
