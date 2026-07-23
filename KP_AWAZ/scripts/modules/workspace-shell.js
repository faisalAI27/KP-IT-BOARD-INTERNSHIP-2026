import { loadPartials } from "./partials.js?v=20260717-member-workspace";
import {
  destroyAuthService,
  getCurrentAuthState,
  initializeAuthService,
  signOut,
  subscribeToAuthChanges,
} from "../services/auth-service.js?v=20260717-auth-routing";
import { getMyProfile } from "../services/profile-api.js?v=20260717-member-workspace";
import {
  navigateOnce,
  protectedAuthDestination,
  routeDecision,
} from "../services/route-guard.js?v=20260717-auth-routing";
import { withRequestTimeout } from "../services/request-timeout.js?v=20260717-auth-routing";
import { appConfig } from "../config.js";


const WORKSPACE_PAGES = new Set([
  "overview",
  "contribute",
  "donate-text",
  "contributions",
  "profile",
  "settings",
]);
const PAGE_DESTINATIONS = Object.freeze({
  overview: "dashboard.html",
  contribute: "contribute.html",
  "donate-text": "donate-text.html",
  contributions: "my-contributions.html",
  profile: "profile.html",
  settings: "settings.html",
});


function compactIdentity(value, fallback = "Contributor") {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || fallback;
}


export function initialsForIdentity(displayName, email) {
  const source = compactIdentity(displayName, compactIdentity(email, "K"));
  const pieces = source.split(/[\s@._-]+/).filter(Boolean);
  return pieces
    .slice(0, 2)
    .map((piece) => piece[0]?.toUpperCase() ?? "")
    .join("") || "K";
}


export class WorkspaceShell {
  constructor({
    root = globalThis.document,
    location = globalThis.location,
    authApi = {
      destroyAuthService,
      getCurrentAuthState,
      initializeAuthService,
      signOut,
      subscribeToAuthChanges,
    },
    profileApi = { getMyProfile },
    partialLoader = loadPartials,
  } = {}) {
    this._root = root;
    this._location = location;
    this._auth = authApi;
    this._profile = profileApi;
    this._loadPartials = partialLoader;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._initialized = false;
    this._destroyed = false;
    this._page = "overview";
    this._navigating = false;
    this._signingOut = false;
  }

  async initialize({ page = "overview", onReady = null } = {}) {
    if (this._initialized) return false;
    if (!WORKSPACE_PAGES.has(page)) throw new TypeError("Unknown workspace page.");
    this._page = page;
    this._destroyed = false;

    await this._loadPartials(this._root);
    this._elements = this._resolveElements();
    if (!this._elements) throw new Error("Workspace navigation could not be loaded.");
    this._initialized = true;
    this._bindEvents();
    this._setActivePage();
    this._unsubscribe = this._auth.subscribeToAuthChanges((state) => {
      if (!this._destroyed) this._handleAuthState(state);
    });

    const state = await this._auth.initializeAuthService();
    if (!this._isVerified(state)) {
      this._handleUnverifiedState(state);
      return false;
    }

    const profile = await this._loadProfile(state);
    if (!profile || this._destroyed || this._navigating) return false;
    this._renderIdentity(profile, state.backendUser);
    this._root.body.dataset.workspaceState = "ready";
    if (typeof onReady === "function") {
      await onReady({ state, profile });
    }
    return true;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._closeMenu();
    this._auth.destroyAuthService();
    this._initialized = false;
  }

  updateIdentity(profile, backendUser = getCurrentAuthState().backendUser) {
    if (!this._elements || this._destroyed) return;
    this._renderIdentity(profile, backendUser);
  }

  _resolveElements() {
    const ids = {
      sidebar: "workspaceSidebar",
      menuButton: "workspaceMenuButton",
      menuLabel: "workspaceMenuLabel",
      backdrop: "workspaceBackdrop",
      avatar: "workspaceUserAvatar",
      name: "workspaceUserName",
      email: "workspaceUserEmail",
      signOutButton: "workspaceSignOutButton",
      signOutLabel: "workspaceSignOutLabel",
      guard: "workspaceGuard",
      guardMessage: "workspaceGuardMessage",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, this._root.getElementById(id)]),
    );
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.menuButton, "click", () => {
      const open = !this._elements.sidebar.classList.contains("is-open");
      open ? this._openMenu() : this._closeMenu();
    });
    this._listen(this._elements.backdrop, "click", () => this._closeMenu());
    this._listen(this._root, "keydown", (event) => {
      if (event.key !== "Escape" || !this._elements.sidebar.classList.contains("is-open")) return;
      this._closeMenu({ restoreFocus: true });
    });
    this._listen(this._elements.signOutButton, "click", () => {
      void this._signOut();
    });
    for (const link of this._elements.sidebar.querySelectorAll("a")) {
      this._listen(link, "click", () => this._closeMenu());
    }
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _setActivePage() {
    for (const link of this._elements.sidebar.querySelectorAll("[data-workspace-link]")) {
      const active = link.dataset.workspaceLink === this._page;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }

  _isVerified(state) {
    return Boolean(state?.status === "signed_in" && state.backendUser?.id);
  }

  _handleAuthState(state) {
    const pathname = PAGE_DESTINATIONS[this._page] ?? this._location?.pathname;
    const decision = routeDecision({ pathname, state });
    if (decision.action === "allow" || decision.action === "wait") return;
    this._handleUnverifiedState(state);
  }

  _handleUnverifiedState(state) {
    if (this._navigating || this._signingOut || this._destroyed) return;
    if (state?.status === "signed_out" || !state?.session) {
      this._navigateToAuth();
      return;
    }
    this._root.body.dataset.workspaceState = "error";
    this._elements.guard.hidden = false;
    this._elements.guardMessage.textContent =
      "Your Supabase session is present, but KP AWAZ could not verify it with the backend. Start the backend and try again.";
  }

  async _loadProfile() {
    try {
      return await withRequestTimeout(() => this._profile.getMyProfile());
    } catch {
      if (this._destroyed || this._navigating) return null;
      this._root.body.dataset.workspaceState = "error";
      if (appConfig.environment === "development") {
        this._root.body.dataset.authDiagnostic = "profile_load_failed";
      }
      this._elements.guard.hidden = false;
      this._elements.guardMessage.textContent =
        "Your account is verified, but your profile could not be loaded. Please try again.";
      return null;
    }
  }

  _renderIdentity(profile, backendUser) {
    const displayName = compactIdentity(profile?.displayName);
    const email = compactIdentity(profile?.email ?? backendUser?.email, "Email unavailable");
    this._elements.avatar.textContent = initialsForIdentity(displayName, email);
    this._elements.name.textContent = displayName;
    this._elements.email.textContent = email;
    const greeting = this._root.getElementById("workspaceGreetingName");
    if (greeting) greeting.textContent = displayName.split(/\s+/, 1)[0];
  }

  async _signOut() {
    if (this._elements.signOutButton.disabled) return;
    this._elements.signOutButton.disabled = true;
    this._elements.signOutLabel.textContent = "Signing out…";
    this._signingOut = true;
    try {
      await this._auth.signOut();
      this._navigate("index.html", { replace: true });
    } catch {
      this._signingOut = false;
      this._elements.signOutButton.disabled = false;
      this._elements.signOutLabel.textContent = "Try sign out again";
    }
  }

  _navigateToAuth() {
    if (this._navigating) return;
    this._navigating = true;
    const filename = PAGE_DESTINATIONS[this._page] ?? "dashboard.html";
    this._navigate(protectedAuthDestination(filename));
  }

  _navigate(destination, { replace = false } = {}) {
    this._navigating = true;
    navigateOnce(this._location, destination, { replace });
  }

  _openMenu() {
    this._elements.sidebar.classList.add("is-open");
    this._elements.menuButton.setAttribute("aria-expanded", "true");
    this._elements.menuLabel.textContent = "Close workspace menu";
    this._elements.backdrop.hidden = false;
    this._elements.sidebar.querySelector("a")?.focus({ preventScroll: true });
  }

  _closeMenu({ restoreFocus = false } = {}) {
    if (!this._elements) return;
    this._elements.sidebar.classList.remove("is-open");
    this._elements.menuButton.setAttribute("aria-expanded", "false");
    this._elements.menuLabel.textContent = "Open workspace menu";
    this._elements.backdrop.hidden = true;
    if (restoreFocus) this._elements.menuButton.focus({ preventScroll: true });
  }
}


const workspaceShell = new WorkspaceShell();


export const initializeWorkspace = (options) => workspaceShell.initialize(options);
export const updateWorkspaceIdentity = (profile) => workspaceShell.updateIdentity(profile);
export const destroyWorkspace = () => workspaceShell.destroy();
