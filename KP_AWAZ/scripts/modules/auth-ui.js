import {
  EMAIL_OTP_LENGTH,
  getCurrentAuthState,
  requestEmailOtp,
  signInWithGoogle,
  signOut,
  subscribeToAuthChanges,
  verifyEmailOtp,
  verifyCurrentUserWithBackend,
} from "../services/auth-service.js?v=20260717-unified-auth";


const EMAIL_OTP_COOLDOWN_MS = 60_000;
const EMAIL_OTP_ACTIONS = new Set([
  "email_request",
  "otp_resend",
  "otp_verify",
]);
const SIGN_IN_DESCRIPTION =
  "Continue with Google or use a six-digit code sent to your email.";
const UI_ERROR_MESSAGES = Object.freeze({
  AUTH_NOT_CONFIGURED: "Account sign-in is not configured.",
  GOOGLE_SIGN_IN_FAILED: "Google sign-in could not be completed. Please try again.",
  EMAIL_OTP_SEND_FAILED: "We could not send the sign-in code. Please try again.",
  EMAIL_OTP_VERIFY_FAILED: "We could not verify the code. Please try again.",
  INVALID_OR_EXPIRED_EMAIL_OTP:
    "Invalid or expired code. Request a new code and try again.",
  INVALID_EMAIL_OTP: "Enter the complete six-digit code.",
  INVALID_EMAIL: "Enter a valid email address.",
  SIGN_OUT_FAILED: "Sign-out could not be completed. Please try again.",
  AUTHENTICATION_REQUIRED: "Your session has expired. Sign out, then sign in again.",
  INVALID_ACCESS_TOKEN: "Your session has expired. Sign out, then sign in again.",
  AUTH_SERVICE_UNAVAILABLE:
    "Your session exists, but account verification is temporarily unavailable.",
  INVALID_AUTH_RESPONSE:
    "Your session exists, but account verification is temporarily unavailable.",
  INVALID_BACKEND_AUTH_RESPONSE:
    "Your session exists, but account verification is temporarily unavailable.",
  AUTH_BACKEND_UNAVAILABLE:
    "Your session exists, but account verification is temporarily unavailable.",
  BACKEND_AUTH_FAILED:
    "Your session exists, but account verification is temporarily unavailable.",
  SESSION_RESTORE_FAILED: "Your account session could not be restored. Sign in again.",
});
const TEMPORARY_VERIFICATION_CODES = new Set([
  "AUTH_SERVICE_UNAVAILABLE",
  "INVALID_AUTH_RESPONSE",
  "INVALID_BACKEND_AUTH_RESPONSE",
  "AUTH_BACKEND_UNAVAILABLE",
  "BACKEND_AUTH_FAILED",
]);
const INVALID_SESSION_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_ACCESS_TOKEN",
]);


function safeUiErrorMessage(error, fallback = "Authentication could not be completed.") {
  const code = typeof error?.code === "string" ? error.code : "";
  return UI_ERROR_MESSAGES[code] ?? fallback;
}


function providerLabel(provider) {
  if (provider === "google") return "Signed in with Google";
  if (provider === "email") return "Signed in with an email code";
  return "Verified account";
}


function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}


function normalizeOtp(otp) {
  return typeof otp === "string" ? otp.replace(/[\s-]+/g, "") : "";
}


function isCompleteOtp(otp) {
  return new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`).test(otp);
}


function compactAccountLabel(email) {
  if (typeof email !== "string" || !email.trim()) return "Account";
  const prefix = email.trim().split("@", 1)[0].trim();
  if (!prefix) return "Account";
  return prefix.length > 18 ? `${prefix.slice(0, 17)}…` : prefix;
}


function compactProfileLabel(displayName) {
  if (typeof displayName !== "string" || !displayName.trim()) return null;
  const cleaned = displayName.trim();
  return cleaned.length > 18 ? `${cleaned.slice(0, 17)}…` : cleaned;
}


export function getAuthViewModel(state) {
  const normalizedState = state && typeof state === "object" ? state : {};
  const error =
    normalizedState.error && typeof normalizedState.error === "object"
      ? normalizedState.error
      : null;

  if (normalizedState.status === "loading") {
    return {
      headerLabel: "Checking account…",
      headerKind: "loading",
      headerDisabled: true,
      dialogMode: "sign_in",
      title: "Sign in to KP AWAZ",
      description: SIGN_IN_DESCRIPTION,
      signInMessage: "",
      accountEmail: "Account not verified",
      accountProvider: "Verification in progress",
      accountMessage: "",
      showRetry: false,
      showSignOut: false,
    };
  }

  if (normalizedState.status === "signed_in" && normalizedState.backendUser) {
    const email =
      typeof normalizedState.backendUser.email === "string" &&
      normalizedState.backendUser.email.trim()
        ? normalizedState.backendUser.email.trim()
        : null;
    const provider =
      typeof normalizedState.backendUser.provider === "string"
        ? normalizedState.backendUser.provider.trim().toLowerCase()
        : null;
    return {
      headerLabel: compactAccountLabel(email),
      headerKind: "account",
      headerDisabled: false,
      dialogMode: "account",
      title: "Your KP AWAZ account",
      description: "Your session has been verified securely by KP AWAZ.",
      signInMessage: "",
      accountEmail: email ?? "Email not available",
      accountProvider: providerLabel(provider),
      accountMessage: "",
      showRetry: false,
      showSignOut: true,
    };
  }

  if (normalizedState.status === "error" && error?.code === "AUTH_NOT_CONFIGURED") {
    return {
      headerLabel: "Sign in unavailable",
      headerKind: "unavailable",
      headerDisabled: true,
      dialogMode: "sign_in",
      title: "Sign in to KP AWAZ",
      description: SIGN_IN_DESCRIPTION,
      signInMessage: safeUiErrorMessage(error),
      accountEmail: "Account not verified",
      accountProvider: "Verification unavailable",
      accountMessage: "",
      showRetry: false,
      showSignOut: false,
    };
  }

  if (normalizedState.status === "error" && normalizedState.session) {
    const isInvalidSession = INVALID_SESSION_CODES.has(error?.code);
    const isTemporary =
      error?.status === 503 || TEMPORARY_VERIFICATION_CODES.has(error?.code);
    return {
      headerLabel: "Account issue",
      headerKind: "issue",
      headerDisabled: false,
      dialogMode: "account",
      title: isInvalidSession ? "Session expired" : "Account verification",
      description: isInvalidSession
        ? "Your account is not verified for KP AWAZ right now."
        : "Your Supabase session is present, but KP AWAZ still needs to verify it.",
      signInMessage: "",
      accountEmail: "Account not verified",
      accountProvider: "Supabase session detected",
      accountMessage: safeUiErrorMessage(error),
      showRetry: isTemporary && !isInvalidSession,
      showSignOut: true,
    };
  }

  if (normalizedState.status === "error") {
    return {
      headerLabel: "Sign in",
      headerKind: "signed_out",
      headerDisabled: false,
      dialogMode: "sign_in",
      title: "Sign in to KP AWAZ",
      description: SIGN_IN_DESCRIPTION,
      signInMessage: safeUiErrorMessage(error),
      accountEmail: "Account not verified",
      accountProvider: "Verification unavailable",
      accountMessage: "",
      showRetry: false,
      showSignOut: false,
    };
  }

  return {
    headerLabel: "Sign in",
    headerKind: "signed_out",
    headerDisabled: false,
    dialogMode: "sign_in",
    title: "Sign in to KP AWAZ",
    description: SIGN_IN_DESCRIPTION,
    signInMessage: "",
    accountEmail: "Account not verified",
    accountProvider: "Verified account",
    accountMessage: "",
    showRetry: false,
    showSignOut: false,
  };
}


const defaultAuthApi = Object.freeze({
  getCurrentAuthState,
  requestEmailOtp,
  signInWithGoogle,
  signOut,
  subscribeToAuthChanges,
  verifyEmailOtp,
  verifyCurrentUserWithBackend,
});


export class AuthUI {
  constructor({
    root = globalThis.document,
    authApi = defaultAuthApi,
    clock = () => Date.now(),
    setIntervalImpl = (...args) => globalThis.setInterval(...args),
    clearIntervalImpl = (timer) => globalThis.clearInterval(timer),
  } = {}) {
    this._root = root;
    this._auth = authApi;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._initialized = false;
    this._destroyed = false;
    this._pendingAction = null;
    this._activeEmail = "";
    this._emailFlowEpoch = 0;
    this._emailStep = "email";
    this._resendAvailableAt = 0;
    this._resendTimer = null;
    this._clock = clock;
    this._setInterval = setIntervalImpl;
    this._clearInterval = clearIntervalImpl;
    this._profileIdentity = null;
    this._signInMessage = null;
    this._accountMessage = null;
    this._state = {
      status: "loading",
      session: null,
      backendUser: null,
      error: null,
    };
  }

  initAuthUI() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;

    this._destroyed = false;
    this._initialized = true;
    this._bindEvents();
    this._elements.otpInput.maxLength = EMAIL_OTP_LENGTH;
    this._elements.otpInput.pattern = `[0-9]{${EMAIL_OTP_LENGTH}}`;
    this._state = this._auth.getCurrentAuthState();
    this._render();
    this._unsubscribe = this._auth.subscribeToAuthChanges((state) => {
      if (this._destroyed) return;
      this._state = state;
      if (
        state.status !== "signed_in" ||
        state.backendUser?.id !== this._profileIdentity?.userId
      ) {
        this._profileIdentity = null;
      }
      if (state.status === "signed_in") {
        this._signInMessage = null;
        this._clearOtpInput();
      }
      if (state.status === "signed_out") {
        this._accountMessage = null;
        this._resetEmailOtp({ clearEmail: true });
      }
      this._render();
    });
    return true;
  }

  setProfileDisplayName(userId, displayName) {
    if (!this._initialized || this._destroyed) return;
    const cleanedUserId = typeof userId === "string" ? userId.trim() : "";
    const cleanedDisplayName = compactProfileLabel(displayName);
    const fullDisplayName =
      typeof displayName === "string" ? displayName.trim().slice(0, 80) : "";
    const verifiedUserId = this._state.backendUser?.id;
    this._profileIdentity =
      cleanedUserId &&
      cleanedDisplayName &&
      this._state.status === "signed_in" &&
      cleanedUserId === verifiedUserId
        ? {
            userId: cleanedUserId,
            displayName: cleanedDisplayName,
            fullDisplayName,
          }
        : null;
    this._render();
  }

  openDialog() {
    if (!this._initialized || this._destroyed) return;
    const model = getAuthViewModel(this._state);
    if (model.headerDisabled || this._elements.dialog.open) return;

    this._signInMessage = null;
    this._accountMessage = null;
    this._render();
    this._elements.dialog.showModal();
    this._root.body?.classList?.add("auth-dialog-open");
    queueMicrotask(() => {
      if (this._destroyed || !this._elements.dialog.open) return;
      const focusTarget =
        model.dialogMode === "account"
          ? this._elements.signOutButton
          : this._elements.googleButton;
      focusTarget.focus();
    });
  }

  closeDialog() {
    if (!this._initialized || !this._elements.dialog.open) return;
    this._resetEmailOtp({ clearEmail: true });
    this._elements.dialog.close();
  }

  destroyAuthUI() {
    if (this._destroyed) return;
    this._resetEmailOtp({ clearEmail: true });
    this._destroyed = true;
    this._initialized = false;
    this._pendingAction = null;
    this._profileIdentity = null;
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    if (this._elements?.dialog.open) this._elements.dialog.close();
    this._root?.body?.classList?.remove("auth-dialog-open");
  }

  _resolveElements() {
    if (!this._root?.getElementById) return null;
    const ids = {
      headerButton: "authHeaderButton",
      headerLabel: "authHeaderButtonLabel",
      dialog: "authDialog",
      closeButton: "authDialogClose",
      title: "authDialogTitle",
      description: "authDialogDescription",
      signInView: "authSignInView",
      accountView: "authAccountView",
      googleButton: "authGoogleButton",
      googleLabel: "authGoogleButtonLabel",
      emailStep: "authEmailStep",
      emailForm: "authEmailForm",
      emailInput: "authEmailInput",
      emailSubmit: "authEmailSubmit",
      emailSubmitLabel: "authEmailSubmitLabel",
      otpStep: "authOtpStep",
      otpEmail: "authOtpEmail",
      otpForm: "authOtpForm",
      otpInput: "authOtpInput",
      otpSubmit: "authOtpSubmit",
      otpSubmitLabel: "authOtpSubmitLabel",
      otpResend: "authOtpResend",
      otpResendLabel: "authOtpResendLabel",
      otpChangeEmail: "authOtpChangeEmail",
      otpCancel: "authOtpCancel",
      signInStatus: "authSignInStatus",
      accountEmail: "authAccountEmail",
      accountProvider: "authAccountProvider",
      accountStatus: "authAccountStatus",
      retryButton: "authRetryButton",
      retryLabel: "authRetryButtonLabel",
      signOutButton: "authSignOutButton",
      signOutLabel: "authSignOutButtonLabel",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, this._root.getElementById(id)]),
    );
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.headerButton, "click", () => {
      if (this._state.status !== "signed_in") this.openDialog();
    });
    this._listen(this._elements.closeButton, "click", () => this.closeDialog());
    this._listen(this._elements.dialog, "cancel", (event) => {
      event.preventDefault();
      this.closeDialog();
    });
    this._listen(this._elements.dialog, "click", (event) => {
      if (event.target === this._elements.dialog) this.closeDialog();
    });
    this._listen(this._elements.dialog, "close", () => {
      this._root.body?.classList?.remove("auth-dialog-open");
      this._resetEmailOtp({ clearEmail: true });
      this._signInMessage = null;
      this._accountMessage = null;
      this._elements.headerButton.focus();
      this._render();
    });
    this._listen(this._elements.googleButton, "click", () => {
      void this._startGoogleSignIn();
    });
    this._listen(this._elements.emailForm, "submit", (event) => {
      event.preventDefault();
      void this._requestEmailOtp();
    });
    this._listen(this._elements.otpForm, "submit", (event) => {
      event.preventDefault();
      void this._verifyEmailOtp();
    });
    this._listen(this._elements.otpInput, "input", () => {
      this._normalizeOtpInput();
    });
    this._listen(this._elements.otpInput, "paste", (event) => {
      this._pasteOtp(event);
    });
    this._listen(this._elements.otpResend, "click", () => {
      void this._resendEmailOtp();
    });
    this._listen(this._elements.otpChangeEmail, "click", () => {
      this._useDifferentEmail();
    });
    this._listen(this._elements.otpCancel, "click", () => {
      this.closeDialog();
    });
    this._listen(this._elements.signOutButton, "click", () => {
      void this._signOut();
    });
    this._listen(this._elements.retryButton, "click", () => {
      void this._retryVerification();
    });
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  async _startGoogleSignIn() {
    if (!this._beginAction("google")) return;
    let redirectStarted = false;
    try {
      const result = await this._auth.signInWithGoogle();
      redirectStarted = Boolean(result?.ok && result?.redirecting);
    } catch (error) {
      if (!this._destroyed) {
        this._signInMessage = {
          message: safeUiErrorMessage(error, "Google sign-in could not be completed."),
          tone: "error",
        };
      }
    } finally {
      if (!this._destroyed && !redirectStarted) {
        this._pendingAction = null;
        this._render();
      }
    }
  }

  async _requestEmailOtp() {
    if (this._pendingAction || this._destroyed) return;
    const email = normalizeEmail(this._elements.emailInput.value);
    this._elements.emailInput.value = email;
    this._elements.emailInput.setCustomValidity("");
    if (!email || !this._elements.emailInput.checkValidity()) {
      this._signInMessage = {
        message: UI_ERROR_MESSAGES.INVALID_EMAIL,
        tone: "error",
      };
      this._elements.emailInput.reportValidity();
      this._render();
      return;
    }
    if (!this._beginAction("email_request")) return;
    const epoch = this._emailFlowEpoch;

    try {
      const result = await this._auth.requestEmailOtp(email);
      if (this._isCurrentEmailFlow(epoch)) {
        this._activeEmail = normalizeEmail(result?.email) || email;
        this._emailStep = "otp";
        this._clearOtpInput();
        this._startResendCooldown();
        this._signInMessage = {
          message: "A six-digit sign-in code has been sent to your email.",
          tone: "success",
        };
        queueMicrotask(() => {
          if (this._isCurrentEmailFlow(epoch) && this._emailStep === "otp") {
            this._elements.otpInput.focus();
          }
        });
      }
    } catch (error) {
      if (this._isCurrentEmailFlow(epoch)) {
        this._signInMessage = {
          message: safeUiErrorMessage(
            error,
            "We could not send the sign-in code. Please try again.",
          ),
          tone: "error",
        };
      }
    } finally {
      if (this._isCurrentEmailFlow(epoch)) {
        this._pendingAction = null;
        this._render();
      }
    }
  }

  async _verifyEmailOtp() {
    if (this._pendingAction || this._destroyed || !this._activeEmail) return;
    const otp = normalizeOtp(this._elements.otpInput.value);
    this._elements.otpInput.value = otp;
    this._elements.otpInput.setCustomValidity("");
    if (!isCompleteOtp(otp)) {
      const hasNonnumericCharacters = otp.length > 0 && !/^\d+$/.test(otp);
      const message = hasNonnumericCharacters
        ? "Use digits only for the sign-in code."
        : UI_ERROR_MESSAGES.INVALID_EMAIL_OTP;
      this._elements.otpInput.setCustomValidity(message);
      this._signInMessage = { message, tone: "error" };
      this._elements.otpInput.reportValidity();
      this._render();
      return;
    }
    if (!this._beginAction("otp_verify")) return;
    const epoch = this._emailFlowEpoch;

    try {
      await this._auth.verifyEmailOtp(this._activeEmail, otp);
      if (this._isCurrentEmailFlow(epoch)) {
        this._pendingAction = null;
        this._signInMessage = null;
        this._resetEmailOtp({ clearEmail: true });
        if (this._elements.dialog.open) this._elements.dialog.close();
      }
    } catch (error) {
      if (this._isCurrentEmailFlow(epoch)) {
        this._clearOtpInput();
        this._signInMessage = {
          message: safeUiErrorMessage(
            error,
            "We could not verify the code. Please try again.",
          ),
          tone: "error",
        };
        queueMicrotask(() => {
          if (this._isCurrentEmailFlow(epoch)) this._elements.otpInput.focus();
        });
      }
    } finally {
      if (this._isCurrentEmailFlow(epoch)) {
        this._pendingAction = null;
        this._render();
      }
    }
  }

  async _resendEmailOtp() {
    if (
      this._pendingAction ||
      this._destroyed ||
      !this._activeEmail ||
      this._resendSecondsRemaining() > 0
    ) {
      return;
    }
    if (!this._beginAction("otp_resend")) return;
    const epoch = this._emailFlowEpoch;
    const email = this._activeEmail;
    this._clearOtpInput();

    try {
      await this._auth.requestEmailOtp(email);
      if (this._isCurrentEmailFlow(epoch)) {
        this._startResendCooldown();
        this._signInMessage = {
          message: "A new six-digit sign-in code was sent.",
          tone: "success",
        };
      }
    } catch (error) {
      if (this._isCurrentEmailFlow(epoch)) {
        this._signInMessage = {
          message: safeUiErrorMessage(
            error,
            "We could not send the sign-in code. Please try again.",
          ),
          tone: "error",
        };
      }
    } finally {
      if (this._isCurrentEmailFlow(epoch)) {
        this._pendingAction = null;
        this._render();
      }
    }
  }

  _normalizeOtpInput() {
    const compact = normalizeOtp(this._elements.otpInput.value);
    this._elements.otpInput.value = compact;
    this._elements.otpInput.setCustomValidity(
      compact && !/^\d+$/.test(compact)
        ? "Use digits only for the sign-in code."
        : "",
    );
  }

  _pasteOtp(event) {
    const pasted = event?.clipboardData?.getData?.("text");
    if (typeof pasted !== "string") return;
    event.preventDefault();
    this._elements.otpInput.value = normalizeOtp(pasted);
    this._normalizeOtpInput();
  }

  _useDifferentEmail() {
    if (this._pendingAction || this._destroyed) return;
    const email = this._activeEmail;
    this._resetEmailOtp({ clearEmail: false });
    this._elements.emailInput.value = email;
    this._signInMessage = null;
    this._render();
    queueMicrotask(() => {
      if (!this._destroyed && this._emailStep === "email") {
        this._elements.emailInput.focus();
      }
    });
  }

  async _signOut() {
    if (!this._beginAction("sign_out")) return;
    try {
      await this._auth.signOut();
      if (!this._destroyed) {
        this._accountMessage = null;
        this.closeDialog();
      }
    } catch (error) {
      if (!this._destroyed) {
        this._accountMessage = {
          message: safeUiErrorMessage(error, "Sign-out could not be completed."),
          tone: "error",
        };
      }
    } finally {
      if (!this._destroyed) {
        this._pendingAction = null;
        this._render();
      }
    }
  }

  async _retryVerification() {
    if (!this._beginAction("retry")) return;
    try {
      await this._auth.verifyCurrentUserWithBackend();
      if (!this._destroyed) this._accountMessage = null;
    } catch (error) {
      if (!this._destroyed) {
        this._accountMessage = {
          message: safeUiErrorMessage(
            error,
            "Account verification is temporarily unavailable.",
          ),
          tone: "error",
        };
      }
    } finally {
      if (!this._destroyed) {
        this._pendingAction = null;
        this._render();
      }
    }
  }

  _startResendCooldown() {
    this._stopResendCooldown();
    this._resendAvailableAt = this._clock() + EMAIL_OTP_COOLDOWN_MS;
    this._resendTimer = this._setInterval(() => {
      if (this._destroyed || this._resendSecondsRemaining() <= 0) {
        this._stopResendCooldown({ preserveAvailability: true });
      }
      this._render();
    }, 1000);
    this._resendTimer?.unref?.();
  }

  _stopResendCooldown({ preserveAvailability = false } = {}) {
    if (this._resendTimer !== null) {
      this._clearInterval(this._resendTimer);
      this._resendTimer = null;
    }
    if (!preserveAvailability) this._resendAvailableAt = 0;
  }

  _resendSecondsRemaining() {
    if (!this._resendAvailableAt) return 0;
    return Math.max(
      0,
      Math.ceil((this._resendAvailableAt - this._clock()) / 1000),
    );
  }

  _clearOtpInput() {
    if (!this._elements?.otpInput) return;
    this._elements.otpInput.value = "";
    this._elements.otpInput.setCustomValidity("");
  }

  _resetEmailOtp({ clearEmail = false } = {}) {
    this._emailFlowEpoch += 1;
    this._activeEmail = "";
    this._emailStep = "email";
    this._stopResendCooldown();
    this._clearOtpInput();
    if (clearEmail && this._elements?.emailInput) {
      this._elements.emailInput.value = "";
      this._elements.emailInput.setCustomValidity("");
    }
    if (EMAIL_OTP_ACTIONS.has(this._pendingAction)) this._pendingAction = null;
  }

  _isCurrentEmailFlow(epoch) {
    return !this._destroyed && epoch === this._emailFlowEpoch;
  }

  _beginAction(action) {
    if (this._pendingAction || this._destroyed) return false;
    this._pendingAction = action;
    if (action === "google" || EMAIL_OTP_ACTIONS.has(action)) {
      this._signInMessage = null;
    } else {
      this._accountMessage = null;
    }
    this._render();
    return true;
  }

  _render() {
    if (!this._elements || this._destroyed) return;
    const model = getAuthViewModel(this._state);
    const pending = this._pendingAction;

    const profileHeaderLabel =
      model.headerKind === "account" &&
      this._profileIdentity?.userId === this._state.backendUser?.id
        ? this._profileIdentity.displayName
        : null;
    this._elements.headerLabel.textContent = profileHeaderLabel ?? model.headerLabel;
    this._elements.headerButton.title =
      this._profileIdentity?.fullDisplayName ?? model.headerLabel;
    this._elements.headerButton.dataset.authKind = model.headerKind;
    this._elements.headerButton.disabled = model.headerDisabled;
    const accountNavigation = model.headerKind === "account";
    this._elements.headerButton.setAttribute(
      "aria-controls",
      accountNavigation ? "accountSection" : "authDialog",
    );
    if (accountNavigation) {
      this._elements.headerButton.removeAttribute?.("aria-haspopup");
    } else {
      this._elements.headerButton.setAttribute("aria-haspopup", "dialog");
    }
    this._elements.title.textContent = model.title;
    this._elements.description.textContent = model.description;
    this._elements.signInView.hidden = model.dialogMode !== "sign_in";
    this._elements.accountView.hidden = model.dialogMode !== "account";
    this._elements.emailStep.hidden = this._emailStep !== "email";
    this._elements.otpStep.hidden = this._emailStep !== "otp";
    this._elements.otpEmail.textContent = this._activeEmail;
    this._elements.accountEmail.textContent = model.accountEmail;
    this._elements.accountProvider.textContent = model.accountProvider;

    this._elements.googleButton.disabled = Boolean(pending);
    this._elements.googleLabel.textContent =
      pending === "google" ? "Connecting to Google…" : "Continue with Google";
    this._elements.emailInput.disabled = Boolean(pending);
    this._elements.emailSubmit.disabled = Boolean(pending);
    this._elements.emailSubmitLabel.textContent =
      pending === "email_request" ? "Sending…" : "Send six-digit code";
    this._elements.otpInput.disabled = Boolean(pending);
    this._elements.otpSubmit.disabled = Boolean(pending);
    this._elements.otpSubmitLabel.textContent =
      pending === "otp_verify" ? "Verifying…" : "Verify and sign in";
    const resendSeconds = this._resendSecondsRemaining();
    this._elements.otpResend.disabled =
      Boolean(pending) || !this._activeEmail || resendSeconds > 0;
    this._elements.otpResendLabel.textContent = resendSeconds > 0
      ? `Resend code in ${resendSeconds}s`
      : "Resend code";
    this._elements.otpChangeEmail.disabled = Boolean(pending);
    this._elements.otpCancel.disabled = false;
    this._elements.retryButton.hidden = !model.showRetry;
    this._elements.retryButton.disabled = Boolean(pending);
    this._elements.retryLabel.textContent =
      pending === "retry" ? "Verifying…" : "Retry verification";
    this._elements.signOutButton.hidden = !model.showSignOut;
    this._elements.signOutButton.disabled = Boolean(pending);
    this._elements.signOutLabel.textContent =
      pending === "sign_out" ? "Signing out…" : "Sign out";

    const signInMessage = this._signInMessage ??
      (model.signInMessage
        ? { message: model.signInMessage, tone: "error" }
        : null);
    const accountMessage = this._accountMessage ??
      (model.accountMessage
        ? { message: model.accountMessage, tone: "error" }
        : null);
    this._renderMessage(this._elements.signInStatus, signInMessage);
    this._renderMessage(this._elements.accountStatus, accountMessage);
  }

  _renderMessage(element, message) {
    element.textContent = message?.message ?? "";
    element.dataset.tone = message?.tone ?? "";
    element.hidden = !message?.message;
  }
}


const authUI = new AuthUI();


export const initAuthUI = () => authUI.initAuthUI();
export const destroyAuthUI = () => authUI.destroyAuthUI();
export const openAuthDialog = () => authUI.openDialog();
export const setAuthProfileDisplayName = (userId, displayName) =>
  authUI.setProfileDisplayName(userId, displayName);
