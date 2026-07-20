import {
  destroyAuthService,
  initializeAuthService,
  subscribeToAuthChanges,
} from "../services/auth-service.js?v=20260717-auth-routing";
import { isVerifiedAuthState } from "../services/route-guard.js?v=20260717-auth-routing";


export function contributionDestination(state) {
  return isVerifiedAuthState(state)
    ? "contribute.html"
    : "auth.html?next=contribute.html";
}


export class PublicRouting {
  constructor({
    root = globalThis.document,
    authApi = {
      destroyAuthService,
      initializeAuthService,
      subscribeToAuthChanges,
    },
  } = {}) {
    this._root = root;
    this._auth = authApi;
    this._unsubscribe = null;
    this._state = null;
  }

  async initialize() {
    this._unsubscribe = this._auth.subscribeToAuthChanges((state) => {
      if (state?.status !== "loading") this._applyState(state);
    });
    const state = await this._auth.initializeAuthService();
    this._applyState(state);
    return state;
  }

  destroy() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._auth.destroyAuthService();
  }

  _applyState(state) {
    if (state?.status === "loading") return;
    this._state = state;
    const verified = isVerifiedAuthState(state);
    const destination = contributionDestination(state);
    for (const link of this._root.querySelectorAll?.("[data-start-contributing]") ?? []) {
      link.setAttribute("href", destination);
    }

    const accountButton = this._root.getElementById?.("authHeaderButton");
    const accountLabel = this._root.getElementById?.("authHeaderButtonLabel");
    const profileLink = this._root.getElementById?.("publicAccountLink");
    if (!accountButton) return;
    accountButton.dataset.authKind = verified ? "account" : "signed-out";
    accountButton.setAttribute("href", verified ? "dashboard.html" : "auth.html");
    accountButton.removeAttribute("aria-disabled");
    if (accountLabel) accountLabel.textContent = verified ? "Dashboard" : "Sign In";
    if (profileLink) profileLink.hidden = !verified;
  }
}
