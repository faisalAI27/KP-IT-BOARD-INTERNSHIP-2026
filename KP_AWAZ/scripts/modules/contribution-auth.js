import {
  getCurrentAuthState,
  subscribeToAuthChanges,
} from "../services/auth-service.js?v=20260717-auth-routing";
import { openAuthDialog } from "./auth-ui.js?v=20260717-member-workspace";


const defaultAuthApi = Object.freeze({
  getCurrentAuthState,
  subscribeToAuthChanges,
});


function verifiedUserId(state) {
  const userId =
    state?.status === "signed_in" && typeof state.backendUser?.id === "string"
      ? state.backendUser.id.trim()
      : "";
  return userId || null;
}


export class ContributionAuthController {
  constructor({
    authApi = defaultAuthApi,
    recorders = [],
    statusElement = null,
    messageElement = null,
    signInButton = null,
    openSignIn = openAuthDialog,
    onAccessChange = () => {},
    onSessionInvalidated = () => {},
  } = {}) {
    this._auth = authApi;
    this._recorders = recorders;
    this._statusElement = statusElement;
    this._messageElement = messageElement;
    this._signInButton = signInButton;
    this._openSignIn = openSignIn;
    this._onAccessChange = onAccessChange;
    this._onSessionInvalidated = onSessionInvalidated;
    this._unsubscribe = null;
    this._initialized = false;
    this._destroyed = false;
    this._generation = 0;
    this._activeUserId = null;
    this._status = "loading";
    this._pending = new Map();
    this._handleSignIn = () => {
      if (!this.canContribute()) this._openSignIn();
    };
  }

  init() {
    if (this._initialized) return true;
    this._initialized = true;
    this._destroyed = false;
    this._signInButton?.addEventListener("click", this._handleSignIn);
    this._handleAuthState(this._auth.getCurrentAuthState());
    this._unsubscribe = this._auth.subscribeToAuthChanges((state) => {
      if (!this._destroyed) this._handleAuthState(state);
    });
    return true;
  }

  canContribute() {
    return (
      this._initialized &&
      !this._destroyed &&
      this._status === "signed_in" &&
      Boolean(this._activeUserId)
    );
  }

  beginSubmission(kind) {
    if (!this.canContribute() || this._pending.has(kind)) return null;
    const context = Object.freeze({
      kind,
      generation: this._generation,
      userId: this._activeUserId,
    });
    this._pending.set(kind, context);
    return context;
  }

  finishSubmission(context) {
    if (!context || this._pending.get(context.kind) !== context) return false;
    this._pending.delete(context.kind);
    return this.isCurrent(context);
  }

  isCurrent(context) {
    return Boolean(
      context &&
        this.canContribute() &&
        context.generation === this._generation &&
        context.userId === this._activeUserId,
    );
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._initialized = false;
    this._generation += 1;
    this._activeUserId = null;
    this._pending.clear();
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._signInButton?.removeEventListener("click", this._handleSignIn);
    this._resetRecorders();
    this._render();
  }

  _handleAuthState(state) {
    const nextUserId = verifiedUserId(state);
    const nextStatus = nextUserId ? "signed_in" : state?.status ?? "loading";
    const sessionChanged =
      nextUserId !== this._activeUserId || nextStatus !== this._status;

    if (sessionChanged) {
      this._generation += 1;
      this._pending.clear();
      this._resetRecorders();
      this._onSessionInvalidated();
    }

    this._activeUserId = nextUserId;
    this._status = nextStatus;
    this._render();
  }

  _resetRecorders() {
    for (const recorder of this._recorders) recorder?.reset?.();
  }

  _render() {
    const verified = this.canContribute();
    const loading = !verified && this._status === "loading";
    if (this._statusElement) this._statusElement.hidden = verified;
    if (this._messageElement) {
      this._messageElement.textContent = loading
        ? "Verifying your account before recording…"
        : "Sign in to record and contribute your voice.";
    }
    if (this._signInButton) this._signInButton.hidden = verified || loading;
    this._onAccessChange({ verified, status: this._status });
  }
}
