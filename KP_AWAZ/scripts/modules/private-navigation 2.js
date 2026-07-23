import {
  getCurrentAuthState,
  signOut,
  subscribeToAuthChanges,
} from "../services/auth-service.js?v=20260717-auth-routing";


export const PRIVATE_SECTION_CHANGED_EVENT =
  "kp-awaz:private-section-changed";
export const ACCOUNT_SECTION = "account";
export const MY_CONTRIBUTIONS_SECTION = "my-contributions";

const SECTION_HASHES = Object.freeze({
  [ACCOUNT_SECTION]: "#accountSection",
  [MY_CONTRIBUTIONS_SECTION]: "#myContributionsPageSection",
});


function verifiedUserId(state) {
  const userId =
    state?.status === "signed_in" && typeof state.backendUser?.id === "string"
      ? state.backendUser.id.trim()
      : "";
  return userId || null;
}


function emptyState() {
  return {
    status: "signed_out",
    currentSection: "public",
    signingOut: false,
    error: null,
  };
}


const defaultAuthApi = Object.freeze({
  getCurrentAuthState,
  signOut,
  subscribeToAuthChanges,
});


export class PrivateNavigation {
  constructor({
    root = globalThis.document,
    authApi = defaultAuthApi,
    eventTarget = globalThis.window,
    historyApi = globalThis.history,
    locationApi = globalThis.location,
    CustomEventConstructor = globalThis.CustomEvent,
    schedule = (callback) => globalThis.requestAnimationFrame(callback),
  } = {}) {
    this._root = root;
    this._auth = authApi;
    this._eventTarget = eventTarget;
    this._history = historyApi;
    this._location = locationApi;
    this._CustomEvent = CustomEventConstructor;
    this._schedule = schedule;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._initialized = false;
    this._destroyed = false;
    this._activeUserId = null;
    this._state = emptyState();
  }

  initializePrivateNavigation() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;

    this._initialized = true;
    this._destroyed = false;
    this._bindEvents();
    this._handleAuthState(this._auth.getCurrentAuthState());
    this._unsubscribe = this._auth.subscribeToAuthChanges((state) => {
      if (!this._destroyed) this._handleAuthState(state);
    });
    return true;
  }

  getState() {
    return { ...this._state };
  }

  openSection(section, { updateHistory = true, focus = true } = {}) {
    if (
      this._destroyed ||
      this._state.status !== "signed_in" ||
      !Object.hasOwn(SECTION_HASHES, section)
    ) {
      return false;
    }

    this._state = {
      ...this._state,
      currentSection: section,
      error: null,
    };
    if (updateHistory) this._writeHash(SECTION_HASHES[section]);
    this._render();
    this._dispatchSectionChanged(section);
    if (focus) this._focusSection(section);
    return true;
  }

  showPublicSection({ replaceHistory = false } = {}) {
    const wasPrivate = this._state.currentSection !== "public";
    this._state = {
      ...this._state,
      currentSection: "public",
      error: null,
    };
    if (replaceHistory) this._writeHash("#top", { replace: true });
    this._render();
    if (wasPrivate) this._dispatchSectionChanged("public");
  }

  destroyPrivateNavigation() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._initialized = false;
    this._activeUserId = null;
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._state = emptyState();
    this._render();
  }

  _resolveElements() {
    if (!this._root?.getElementById) return null;
    const ids = {
      accountButton: "authHeaderButton",
      contributionsButton: "myContributionsNavButton",
      accountSection: "accountSection",
      accountHeading: "accountSectionTitle",
      contributionsSection: "myContributionsPageSection",
      contributionsHeading: "myContributionsPageTitle",
      signOutButton: "accountSignOutButton",
      signOutLabel: "accountSignOutButtonLabel",
      signOutStatus: "accountSignOutStatus",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, this._root.getElementById(id)]),
    );
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.accountButton, "click", () => {
      if (this._state.status === "signed_in") this.openSection(ACCOUNT_SECTION);
    });
    this._listen(this._elements.contributionsButton, "click", () => {
      this.openSection(MY_CONTRIBUTIONS_SECTION);
    });
    this._listen(this._elements.signOutButton, "click", () => {
      void this._signOut();
    });
    for (const link of this._root.querySelectorAll?.("[data-public-nav]") ?? []) {
      this._listen(link, "click", () => this.showPublicSection());
    }
    if (this._eventTarget?.addEventListener) {
      this._listen(this._eventTarget, "hashchange", () => this._syncFromLocation());
      this._listen(this._eventTarget, "popstate", () => this._syncFromLocation());
    }
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _handleAuthState(authState) {
    const userId = verifiedUserId(authState);
    if (!userId) {
      const privateHash = Object.values(SECTION_HASHES).includes(
        this._location?.hash,
      );
      this._activeUserId = null;
      this._state = emptyState();
      if (privateHash) this._writeHash("#top", { replace: true });
      this._render();
      this._dispatchSectionChanged("public");
      return;
    }

    const accountChanged = userId !== this._activeUserId;
    this._activeUserId = userId;
    this._state = {
      status: "signed_in",
      currentSection: accountChanged ? "public" : this._state.currentSection,
      signingOut: false,
      error: null,
    };
    this._syncFromLocation({ focus: false });
  }

  _syncFromLocation({ focus = false } = {}) {
    const section = Object.entries(SECTION_HASHES).find(
      ([, hash]) => hash === this._location?.hash,
    )?.[0];
    if (section && this._state.status === "signed_in") {
      this.openSection(section, { updateHistory: false, focus });
      return;
    }
    this.showPublicSection();
  }

  _writeHash(hash, { replace = false } = {}) {
    if (!hash || this._location?.hash === hash) return;
    const method = replace ? "replaceState" : "pushState";
    if (typeof this._history?.[method] === "function") {
      this._history[method](null, "", hash);
      return;
    }
    if (this._location) this._location.hash = hash;
  }

  _dispatchSectionChanged(section) {
    if (
      !this._eventTarget?.dispatchEvent ||
      typeof this._CustomEvent !== "function"
    ) {
      return;
    }
    this._eventTarget.dispatchEvent(
      new this._CustomEvent(PRIVATE_SECTION_CHANGED_EVENT, {
        detail: { section },
      }),
    );
  }

  _focusSection(section) {
    const target =
      section === ACCOUNT_SECTION
        ? this._elements.accountHeading
        : this._elements.contributionsHeading;
    this._schedule?.(() => {
      if (this._destroyed || this._state.currentSection !== section) return;
      target.scrollIntoView?.({ behavior: "instant", block: "start" });
      target.focus?.({ preventScroll: true });
    });
  }

  async _signOut() {
    if (
      this._destroyed ||
      this._state.status !== "signed_in" ||
      this._state.signingOut
    ) {
      return false;
    }
    this._state = { ...this._state, signingOut: true, error: null };
    this._render();
    try {
      await this._auth.signOut();
      return true;
    } catch {
      if (!this._destroyed) {
        this._state = {
          ...this._state,
          signingOut: false,
          error: "Sign-out could not be completed. Please try again.",
        };
        this._render();
      }
      return false;
    }
  }

  _render() {
    if (!this._elements) return;
    const signedIn = this._state.status === "signed_in" && !this._destroyed;
    const accountOpen =
      signedIn && this._state.currentSection === ACCOUNT_SECTION;
    const contributionsOpen =
      signedIn && this._state.currentSection === MY_CONTRIBUTIONS_SECTION;

    this._elements.contributionsButton.hidden = !signedIn;
    this._elements.accountSection.hidden = !accountOpen;
    this._elements.contributionsSection.hidden = !contributionsOpen;
    this._setCurrent(this._elements.accountButton, accountOpen);
    this._setCurrent(this._elements.contributionsButton, contributionsOpen);
    this._elements.signOutButton.disabled = this._state.signingOut;
    this._elements.signOutLabel.textContent = this._state.signingOut
      ? "Signing out…"
      : "Sign out";
    this._elements.signOutStatus.textContent = this._state.error ?? "";
    this._elements.signOutStatus.hidden = !this._state.error;
  }

  _setCurrent(element, current) {
    if (current) element.setAttribute("aria-current", "page");
    else element.removeAttribute?.("aria-current");
  }
}


const privateNavigation = new PrivateNavigation();


export const initializePrivateNavigation = () =>
  privateNavigation.initializePrivateNavigation();
export const destroyPrivateNavigation = () =>
  privateNavigation.destroyPrivateNavigation();
