import {
  getCurrentAuthState,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
} from "../services/auth-service.js";


const UI_ERROR_MESSAGES = Object.freeze({
  AUTH_NOT_CONFIGURED: "Account sign-in is not configured.",
  GOOGLE_SIGN_IN_FAILED: "Google sign-in could not be started. Please try again.",
  EMAIL_SIGN_IN_FAILED: "The sign-in email could not be sent. Please try again.",
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
  if (provider === "email") return "Signed in with an email magic link";
  return "Verified account";
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
      description:
        "Save your place in the community using Google or a secure email link.",
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
      description:
        "Save your place in the community using Google or a secure email link.",
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
      description:
        "Save your place in the community using Google or a secure email link.",
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
    description:
      "Save your place in the community using Google or a secure email link.",
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
  signInWithEmail,
  signInWithGoogle,
  signOut,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
});


export class AuthUI {
  constructor({ root = globalThis.document, authApi = defaultAuthApi } = {}) {
    this._root = root;
    this._auth = authApi;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._initialized = false;
    this._destroyed = false;
    this._pendingAction = null;
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
      if (state.status === "signed_in") this._signInMessage = null;
      if (state.status === "signed_out") this._accountMessage = null;
      this._render();
    });
    return true;
  }

  setProfileDisplayName(userId, displayName) {
    if (!this._initialized || this._destroyed) return;
    const cleanedUserId = typeof userId === "string" ? userId.trim() : "";
    const cleanedDisplayName = compactProfileLabel(displayName);
    const verifiedUserId = this._state.backendUser?.id;
    this._profileIdentity =
      cleanedUserId &&
      cleanedDisplayName &&
      this._state.status === "signed_in" &&
      cleanedUserId === verifiedUserId
        ? { userId: cleanedUserId, displayName: cleanedDisplayName }
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
    this._elements.dialog.close();
  }

  destroyAuthUI() {
    if (this._destroyed) return;
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
      emailForm: "authEmailForm",
      emailInput: "authEmailInput",
      emailSubmit: "authEmailSubmit",
      emailSubmitLabel: "authEmailSubmitLabel",
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
    this._listen(this._elements.headerButton, "click", () => this.openDialog());
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
      void this._sendMagicLink();
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
          message: safeUiErrorMessage(error, "Google sign-in could not be started."),
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

  async _sendMagicLink() {
    if (this._pendingAction || this._destroyed) return;
    const email = this._elements.emailInput.value.trim();
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
    if (!this._beginAction("email")) return;

    try {
      await this._auth.signInWithEmail(email);
      if (!this._destroyed) {
        this._signInMessage = {
          message: "Check your email for the sign-in link.",
          tone: "success",
        };
      }
    } catch (error) {
      if (!this._destroyed) {
        this._signInMessage = {
          message: safeUiErrorMessage(error, "The sign-in email could not be sent."),
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

  _beginAction(action) {
    if (this._pendingAction || this._destroyed) return false;
    this._pendingAction = action;
    if (action === "google" || action === "email") this._signInMessage = null;
    else this._accountMessage = null;
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
    this._elements.headerButton.dataset.authKind = model.headerKind;
    this._elements.headerButton.disabled = model.headerDisabled;
    this._elements.title.textContent = model.title;
    this._elements.description.textContent = model.description;
    this._elements.signInView.hidden = model.dialogMode !== "sign_in";
    this._elements.accountView.hidden = model.dialogMode !== "account";
    this._elements.accountEmail.textContent = model.accountEmail;
    this._elements.accountProvider.textContent = model.accountProvider;

    this._elements.googleButton.disabled = Boolean(pending);
    this._elements.googleLabel.textContent =
      pending === "google" ? "Connecting to Google…" : "Continue with Google";
    this._elements.emailInput.disabled = Boolean(pending);
    this._elements.emailSubmit.disabled = Boolean(pending);
    this._elements.emailSubmitLabel.textContent =
      pending === "email" ? "Sending…" : "Send sign-in link";
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
