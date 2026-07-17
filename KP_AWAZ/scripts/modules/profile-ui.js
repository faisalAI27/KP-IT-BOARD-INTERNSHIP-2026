import {
  getCurrentAuthState,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
} from "../services/auth-service.js?v=20260717-unified-auth";
import { getMyProfile, updateMyProfile } from "../services/profile-api.js";
import { setAuthProfileDisplayName } from "./auth-ui.js?v=20260717-unified-auth";


const PROFILE_ERROR_MESSAGES = Object.freeze({
  AUTHENTICATION_REQUIRED: "Your session has expired. Please sign in again.",
  INVALID_ACCESS_TOKEN: "Your session has expired. Please sign in again.",
  PROFILE_RESPONSE_INVALID: "The profile service returned an invalid response.",
  EMPTY_PROFILE_UPDATE: "No profile changes to save.",
  INVALID_DISPLAY_NAME: "Display name must contain between 2 and 80 characters.",
  INVALID_PREFERRED_LANGUAGE:
    "Preferred language must contain between 1 and 100 characters.",
  INVALID_LEADERBOARD_PREFERENCE:
    "Leaderboard preference must be true or false.",
  PROFILE_PERSISTENCE_FAILED: "The profile could not be saved. Please try again.",
  NETWORK_ERROR: "The KP AWAZ backend could not be reached.",
});
const UNAUTHORIZED_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_ACCESS_TOKEN",
]);


function safeProfileError(error, fallback) {
  const code = typeof error?.code === "string" ? error.code : "PROFILE_REQUEST_FAILED";
  return {
    message: PROFILE_ERROR_MESSAGES[code] ?? fallback,
    code,
    status: Number.isInteger(error?.status) ? error.status : 0,
  };
}


function cloneProfile(profile) {
  return profile
    ? {
        id: profile.id,
        email: profile.email,
        authProvider: profile.authProvider,
        displayName: profile.displayName,
        preferredLanguage: profile.preferredLanguage,
        leaderboardOptIn: profile.leaderboardOptIn,
      }
    : null;
}


function cloneState(state) {
  return {
    status: state.status,
    profile: cloneProfile(state.profile),
    error: state.error ? { ...state.error } : null,
  };
}


const defaultAuthApi = Object.freeze({
  getCurrentAuthState,
  subscribeToAuthChanges,
  verifyCurrentUserWithBackend,
});
const defaultProfileApi = Object.freeze({ getMyProfile, updateMyProfile });
export class ProfileUI {
  constructor({
    root = globalThis.document,
    authApi = defaultAuthApi,
    profileApi = defaultProfileApi,
    setHeaderProfile = setAuthProfileDisplayName,
  } = {}) {
    this._root = root;
    this._auth = authApi;
    this._profileApi = profileApi;
    this._setHeaderProfile = setHeaderProfile;
    this._elements = null;
    this._bindings = [];
    this._unsubscribe = null;
    this._initialized = false;
    this._destroyed = false;
    this._generation = 0;
    this._activeUserId = null;
    this._statusMessage = null;
    this._state = { status: "idle", profile: null, error: null };
  }

  initProfileUI() {
    if (this._initialized) return true;
    this._elements = this._resolveElements();
    if (!this._elements) return false;

    this._destroyed = false;
    this._initialized = true;
    this._bindEvents();
    this._handleAuthState(this._auth.getCurrentAuthState());
    this._unsubscribe = this._auth.subscribeToAuthChanges((state) => {
      if (!this._destroyed) this._handleAuthState(state);
    });
    return true;
  }

  getProfileState() {
    return cloneState(this._state);
  }

  destroyProfileUI() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._initialized = false;
    this._generation += 1;
    this._activeUserId = null;
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const { element, type, listener } of this._bindings) {
      element.removeEventListener(type, listener);
    }
    this._bindings = [];
    this._state = { status: "idle", profile: null, error: null };
    this._statusMessage = null;
    this._clearForm();
    this._setHeaderProfile(null, null);
    this._render();
  }

  _resolveElements() {
    if (!this._root?.getElementById) return null;
    const ids = {
      settings: "profileSettings",
      loading: "profileLoading",
      loadError: "profileLoadError",
      loadErrorMessage: "profileLoadErrorMessage",
      retryButton: "retryProfileButton",
      form: "profileForm",
      displayName: "profileDisplayName",
      verifiedEmail: "profileVerifiedEmail",
      preferredLanguage: "profilePreferredLanguage",
      leaderboardOptIn: "profileLeaderboardOptIn",
      saveButton: "profileSaveButton",
      saveLabel: "profileSaveButtonLabel",
      status: "profileStatus",
    };
    const elements = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, this._root.getElementById(id)]),
    );
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  _bindEvents() {
    this._listen(this._elements.form, "submit", (event) => {
      event.preventDefault();
      void this._saveProfile();
    });
    this._listen(this._elements.retryButton, "click", () => {
      void this._loadProfile();
    });
  }

  _listen(element, type, listener) {
    element.addEventListener(type, listener);
    this._bindings.push({ element, type, listener });
  }

  _handleAuthState(authState) {
    const verifiedUser =
      authState?.status === "signed_in" &&
      authState.backendUser &&
      typeof authState.backendUser.id === "string" &&
      authState.backendUser.id.trim()
        ? authState.backendUser
        : null;

    if (!verifiedUser) {
      this._resetProfile();
      return;
    }

    const userId = verifiedUser.id.trim();
    if (userId === this._activeUserId && this._state.status !== "idle") return;

    this._generation += 1;
    this._activeUserId = userId;
    this._statusMessage = null;
    this._state = { status: "idle", profile: null, error: null };
    this._clearForm();
    this._setHeaderProfile(null, null);
    void this._loadProfile();
  }

  _resetProfile() {
    const alreadyReset =
      this._activeUserId === null &&
      this._state.status === "idle" &&
      this._state.profile === null;
    if (!alreadyReset) this._generation += 1;
    this._activeUserId = null;
    this._statusMessage = null;
    this._state = { status: "idle", profile: null, error: null };
    this._clearForm();
    this._setHeaderProfile(null, null);
    this._render();
  }

  async _loadProfile() {
    if (
      this._destroyed ||
      !this._activeUserId ||
      (this._state.status === "loading" && this._state.profile === null)
    ) {
      return;
    }

    const generation = ++this._generation;
    const userId = this._activeUserId;
    this._statusMessage = null;
    this._state = { status: "loading", profile: null, error: null };
    this._clearForm();
    this._render();

    try {
      const profile = await this._profileApi.getMyProfile();
      if (!this._isCurrent(generation, userId)) return;
      if (profile.id !== userId) {
        throw { code: "PROFILE_RESPONSE_INVALID", status: 200 };
      }
      this._state = { status: "loaded", profile: cloneProfile(profile), error: null };
      this._populateForm(profile);
      this._setHeaderProfile(userId, profile.displayName);
      this._render();
    } catch (error) {
      if (!this._isCurrent(generation, userId)) return;
      if (error?.status === 401 || UNAUTHORIZED_CODES.has(error?.code)) {
        this._handleUnauthorized();
        return;
      }
      this._state = {
        status: "error",
        profile: null,
        error: safeProfileError(error, "Profile settings could not be loaded."),
      };
      this._render();
    }
  }

  async _saveProfile() {
    if (this._destroyed || this._state.status !== "loaded") return;
    const displayName = this._elements.displayName.value.trim();
    this._elements.displayName.value = displayName;
    this._elements.displayName.setCustomValidity?.("");

    const valid =
      displayName.length >= 2 &&
      displayName.length <= 80 &&
      this._elements.displayName.checkValidity() &&
      this._elements.preferredLanguage.checkValidity() &&
      this._elements.form.checkValidity();
    if (!valid) {
      this._elements.form.reportValidity();
      return;
    }

    const preferredLanguage = this._elements.preferredLanguage.value.trim();
    const leaderboardOptIn = Boolean(this._elements.leaderboardOptIn.checked);
    const current = this._state.profile;
    const updates = {};
    if (displayName !== current.displayName) updates.displayName = displayName;
    if (preferredLanguage !== current.preferredLanguage) {
      updates.preferredLanguage = preferredLanguage;
    }
    if (leaderboardOptIn !== current.leaderboardOptIn) {
      updates.leaderboardOptIn = leaderboardOptIn;
    }

    if (Object.keys(updates).length === 0) {
      this._statusMessage = {
        message: "No profile changes to save.",
        tone: "info",
      };
      this._render();
      return;
    }

    const generation = this._generation;
    const userId = this._activeUserId;
    this._statusMessage = null;
    this._state = { status: "saving", profile: current, error: null };
    this._render();

    try {
      const profile = await this._profileApi.updateMyProfile(updates);
      if (!this._isCurrent(generation, userId)) return;
      if (profile.id !== userId) {
        throw { code: "PROFILE_RESPONSE_INVALID", status: 200 };
      }
      this._state = { status: "loaded", profile: cloneProfile(profile), error: null };
      this._statusMessage = {
        message: "Profile saved successfully.",
        tone: "success",
      };
      this._populateForm(profile);
      this._setHeaderProfile(userId, profile.displayName);
      this._render();
    } catch (error) {
      if (!this._isCurrent(generation, userId)) return;
      if (error?.status === 401 || UNAUTHORIZED_CODES.has(error?.code)) {
        this._handleUnauthorized();
        return;
      }
      const safeError = safeProfileError(error, "Profile changes could not be saved.");
      this._state = { status: "loaded", profile: current, error: safeError };
      this._statusMessage = { message: safeError.message, tone: "error" };
      this._render();
    }
  }

  _handleUnauthorized() {
    this._resetProfile();
    Promise.resolve()
      .then(() => this._auth.verifyCurrentUserWithBackend())
      .catch(() => {});
  }

  _isCurrent(generation, userId) {
    return (
      !this._destroyed &&
      generation === this._generation &&
      userId === this._activeUserId
    );
  }

  _populateForm(profile) {
    this._ensureLanguageOption(profile.preferredLanguage);
    this._elements.displayName.value = profile.displayName;
    this._elements.verifiedEmail.value = profile.email ?? "";
    this._elements.preferredLanguage.value = profile.preferredLanguage;
    this._elements.leaderboardOptIn.checked = profile.leaderboardOptIn;
  }

  _ensureLanguageOption(language) {
    const options = Array.from(this._elements.preferredLanguage.options ?? []);
    if (options.some((option) => option.value === language)) return;
    if (!this._root?.createElement || !this._elements.preferredLanguage.append) return;
    const option = this._root.createElement("option");
    option.value = language;
    option.textContent = language;
    this._elements.preferredLanguage.append(option);
  }

  _clearForm() {
    if (!this._elements) return;
    this._elements.displayName.value = "";
    this._elements.verifiedEmail.value = "";
    this._elements.preferredLanguage.value = "Pashto";
    this._elements.leaderboardOptIn.checked = false;
  }

  _render() {
    if (!this._elements) return;
    const status = this._state.status;
    const hasActiveUser = Boolean(this._activeUserId) && !this._destroyed;
    const hasProfile = Boolean(this._state.profile);
    const editable = hasProfile && status === "loaded";
    const saving = status === "saving";

    this._elements.settings.hidden = !hasActiveUser;
    this._elements.loading.hidden = status !== "loading";
    this._elements.loadError.hidden = status !== "error";
    this._elements.loadErrorMessage.textContent = this._state.error?.message ?? "";
    this._elements.retryButton.disabled = status === "loading";
    this._elements.form.hidden = !hasProfile;
    this._elements.displayName.disabled = !editable;
    this._elements.preferredLanguage.disabled = !editable;
    this._elements.leaderboardOptIn.disabled = !editable;
    this._elements.saveButton.disabled = !editable;
    this._elements.saveLabel.textContent = saving ? "Saving…" : "Save profile";
    this._elements.status.textContent = this._statusMessage?.message ?? "";
    this._elements.status.dataset.tone = this._statusMessage?.tone ?? "";
    this._elements.status.hidden = !this._statusMessage?.message;
  }
}


const profileUI = new ProfileUI();


export const initProfileUI = () => profileUI.initProfileUI();
export const destroyProfileUI = () => profileUI.destroyProfileUI();
