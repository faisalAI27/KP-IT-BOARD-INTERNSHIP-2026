import { appConfig } from "../config.js";
import {
  AuthConfigurationError,
  getSupabaseClient,
  isSupabaseConfigured,
  resolveAuthRedirectUrl,
} from "./supabase-client.js";


const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_OTP_LENGTH = 6;
const EMAIL_OTP_PATTERN = new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`);
const BACKEND_AUTH_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_ACCESS_TOKEN",
  "AUTH_NOT_CONFIGURED",
  "AUTH_SERVICE_UNAVAILABLE",
  "INVALID_AUTH_RESPONSE",
]);
const AUTH_EVENTS = new Set([
  "INITIAL_SESSION",
  "SIGNED_IN",
  "SIGNED_OUT",
  "TOKEN_REFRESHED",
  "USER_UPDATED",
]);


export class AuthServiceError extends Error {
  constructor(message, { code = "AUTH_ERROR", status = 0 } = {}) {
    super(message);
    this.name = "AuthServiceError";
    this.code = code;
    this.status = status;
  }
}


function safeSessionSummary(session) {
  if (!session || typeof session !== "object") return null;

  const rawUser =
    session.user && typeof session.user === "object" ? session.user : {};
  const rawMetadata =
    rawUser.app_metadata && typeof rawUser.app_metadata === "object"
      ? rawUser.app_metadata
      : {};
  const userId =
    typeof rawUser.id === "string" && rawUser.id.trim()
      ? rawUser.id.trim()
      : null;
  const email =
    typeof rawUser.email === "string" && rawUser.email.trim()
      ? rawUser.email.trim()
      : null;
  const provider =
    typeof rawMetadata.provider === "string" && rawMetadata.provider.trim()
      ? rawMetadata.provider.trim()
      : null;

  return {
    userId,
    email,
    provider,
    accessTokenAvailable: Boolean(
      typeof session.access_token === "string" && session.access_token.trim(),
    ),
  };
}


function safeBackendUser(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (typeof payload.id !== "string" || !payload.id.trim()) return null;
  if (payload.email !== null && typeof payload.email !== "string") return null;
  if (payload.provider !== null && typeof payload.provider !== "string") {
    return null;
  }

  return {
    id: payload.id.trim(),
    email:
      typeof payload.email === "string" ? payload.email.trim() || null : null,
    provider:
      typeof payload.provider === "string"
        ? payload.provider.trim() || null
        : null,
  };
}


function publicError(error) {
  return {
    message:
      typeof error?.message === "string" && error.message.trim()
        ? error.message.trim()
        : "Authentication could not be completed.",
    code:
      typeof error?.code === "string" && error.code.trim()
        ? error.code.trim()
        : "AUTH_ERROR",
    status: Number.isInteger(error?.status) ? error.status : 0,
  };
}


function cloneState(state) {
  return {
    status: state.status,
    session: state.session ? { ...state.session } : null,
    backendUser: state.backendUser ? { ...state.backendUser } : null,
    error: state.error ? { ...state.error } : null,
  };
}


function sessionRestoreError() {
  return new AuthServiceError("The authentication session could not be restored.", {
    code: "SESSION_RESTORE_FAILED",
  });
}


function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}


function normalizeEmailOtp(otp) {
  return typeof otp === "string" ? otp.replace(/[\s-]+/g, "") : "";
}


export class AuthService {
  constructor({
    apiBaseUrl = appConfig.api.baseUrl,
    client = null,
    clientFactory = getSupabaseClient,
    configured,
    fetchImpl = (...args) => globalThis.fetch(...args),
    locationOrigin = globalThis.location?.origin,
    redirectUrl = null,
  } = {}) {
    this._apiBaseUrl =
      typeof apiBaseUrl === "string" ? apiBaseUrl.trim().replace(/\/+$/, "") : "";
    this._client = client;
    this._clientFactory = clientFactory;
    this._configured =
      typeof configured === "boolean"
        ? configured
        : client
          ? true
          : isSupabaseConfigured();
    this._fetch = fetchImpl;
    this._locationOrigin = locationOrigin;
    this._redirectUrl = redirectUrl;
    this._listeners = new Set();
    this._unsubscribeAuth = null;
    this._session = null;
    this._backendUser = null;
    this._initialized = false;
    this._initializationPromise = null;
    this._destroyed = false;
    this._verificationEpoch = 0;
    this._emailOtpVerificationActive = false;
    this._state = {
      status: "loading",
      session: null,
      backendUser: null,
      error: null,
    };
  }

  getCurrentAuthState() {
    return cloneState(this._state);
  }

  getCurrentAccessToken() {
    const token = this._session?.access_token;
    return typeof token === "string" && token.trim() ? token : null;
  }

  subscribeToAuthChanges(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Auth change callback must be a function.");
    }

    this._listeners.add(callback);
    try {
      callback(this.getCurrentAuthState());
    } catch {
      // A listener cannot prevent itself from receiving later safe updates.
    }
    return () => this._listeners.delete(callback);
  }

  async initializeAuthService() {
    if (this._initialized) return this.getCurrentAuthState();
    if (this._initializationPromise) return this._initializationPromise;

    this._destroyed = false;
    this._initializationPromise = this._initialize();
    try {
      return await this._initializationPromise;
    } finally {
      this._initializationPromise = null;
    }
  }

  async _initialize() {
    if (!this._configured) {
      this._initialized = true;
      this._publishError(new AuthConfigurationError());
      return this.getCurrentAuthState();
    }

    try {
      this._ensureClient();
      const session = await this._loadSession();
      const epoch = this._replaceSession(session);
      this._initialized = true;
      this._registerAuthSubscription();

      if (!session) {
        this._publish("signed_out");
        return this.getCurrentAuthState();
      }

      this._publish("loading");
      try {
        await this.verifyCurrentUserWithBackend(epoch);
      } catch {
        // Verification publishes a safe state; initialization remains isolated.
      }
    } catch (error) {
      this._initialized = true;
      const safeError =
        error instanceof AuthConfigurationError || error instanceof AuthServiceError
          ? error
          : sessionRestoreError();
      this._publishError(safeError);
    }

    return this.getCurrentAuthState();
  }

  async getCurrentSession() {
    let session;
    try {
      this._ensureClient();
      session = await this._loadSession();
    } catch (error) {
      const safeError =
        error instanceof AuthConfigurationError || error instanceof AuthServiceError
          ? error
          : sessionRestoreError();
      this._publishError(safeError);
      throw safeError;
    }
    const epoch = this._replaceSession(session);

    if (!session) {
      this._publish("signed_out");
      return null;
    }

    this._publish("loading");
    try {
      await this.verifyCurrentUserWithBackend(epoch);
    } catch {
      // The caller can inspect the safe verification error through public state.
    }
    return safeSessionSummary(session);
  }

  async signInWithGoogle() {
    const client = this._ensureClient();
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: this._resolvedRedirectUrl() },
      });
      if (error) throw error;
    } catch {
      throw new AuthServiceError("Google sign-in could not be completed.", {
        code: "GOOGLE_SIGN_IN_FAILED",
      });
    }

    return { ok: true, redirecting: true };
  }

  async requestEmailOtp(email) {
    const cleanedEmail = normalizeEmail(email);
    if (
      !cleanedEmail ||
      cleanedEmail.length > 254 ||
      !EMAIL_PATTERN.test(cleanedEmail)
    ) {
      throw new AuthServiceError("Enter a valid email address.", {
        code: "INVALID_EMAIL",
      });
    }

    const client = this._ensureClient();
    try {
      const { error } = await client.auth.signInWithOtp({
        email: cleanedEmail,
        options: {
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
    } catch {
      throw new AuthServiceError(
        "We could not send the sign-in code. Please try again.",
        {
          code: "EMAIL_OTP_SEND_FAILED",
        },
      );
    }

    return { ok: true, email: cleanedEmail };
  }

  async verifyEmailOtp(email, otp) {
    const cleanedEmail = normalizeEmail(email);
    if (
      !cleanedEmail ||
      cleanedEmail.length > 254 ||
      !EMAIL_PATTERN.test(cleanedEmail)
    ) {
      throw new AuthServiceError("Enter a valid email address.", {
        code: "INVALID_EMAIL",
      });
    }

    const cleanedOtp = normalizeEmailOtp(otp);
    if (!EMAIL_OTP_PATTERN.test(cleanedOtp)) {
      throw new AuthServiceError("Enter the complete six-digit code.", {
        code: "INVALID_EMAIL_OTP",
      });
    }

    const client = this._ensureClient();
    this._emailOtpVerificationActive = true;
    try {
      let verification;
      try {
        verification = await client.auth.verifyOtp({
          email: cleanedEmail,
          token: cleanedOtp,
          type: "email",
        });
      } catch {
        throw new AuthServiceError(
          "We could not verify the code. Please try again.",
          { code: "EMAIL_OTP_VERIFY_FAILED" },
        );
      }

      if (verification?.error) {
        throw new AuthServiceError(
          "Invalid or expired code. Request a new code and try again.",
          { code: "INVALID_OR_EXPIRED_EMAIL_OTP" },
        );
      }

      let session;
      try {
        session = await this._loadSession();
      } catch {
        throw new AuthServiceError(
          "We could not verify the code. Please try again.",
          { code: "EMAIL_OTP_VERIFY_FAILED" },
        );
      }
      if (!session) {
        throw new AuthServiceError(
          "We could not verify the code. Please try again.",
          { code: "EMAIL_OTP_VERIFY_FAILED" },
        );
      }

      const epoch = this._replaceSession(session);
      this._publish("loading");
      const backendUser = await this.verifyCurrentUserWithBackend(epoch);
      if (!backendUser) {
        const state = this.getCurrentAuthState();
        if (state.status !== "signed_in" || !state.backendUser) {
          throw new AuthServiceError(
            "We could not verify the code. Please try again.",
            { code: "EMAIL_OTP_VERIFY_FAILED" },
          );
        }
      }

      return { ok: true, email: cleanedEmail };
    } finally {
      this._emailOtpVerificationActive = false;
    }
  }

  async signOut() {
    const client = this._ensureClient();
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    } catch {
      throw new AuthServiceError("Sign-out could not be completed.", {
        code: "SIGN_OUT_FAILED",
      });
    }

    this._replaceSession(null);
    this._publish("signed_out");
    return { ok: true };
  }

  async verifyCurrentUserWithBackend(expectedEpoch = this._verificationEpoch) {
    const accessToken = this.getCurrentAccessToken();
    if (!accessToken) {
      const error = new AuthServiceError("Authentication is required.", {
        code: "AUTHENTICATION_REQUIRED",
        status: 401,
      });
      this._publishVerificationError(error, expectedEpoch);
      throw error;
    }

    let response;
    try {
      response = await this._fetch(`${this._apiBaseUrl}/auth/me`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      const error = new AuthServiceError(
        "The authentication service could not be reached.",
        { code: "AUTH_BACKEND_UNAVAILABLE", status: 0 },
      );
      this._publishVerificationError(error, expectedEpoch);
      throw error;
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      // A safe malformed-response error is created below.
    }

    if (!this._isCurrentVerification(expectedEpoch)) return null;

    if (!response.ok) {
      const backendCode =
        typeof body?.code === "string" && BACKEND_AUTH_CODES.has(body.code)
          ? body.code
          : "BACKEND_AUTH_FAILED";
      let backendMessage =
        typeof body?.message === "string" && body.message.trim()
          ? body.message.trim()
          : "Backend authentication could not be completed.";
      if (backendMessage.includes(accessToken)) {
        backendMessage = "Backend authentication could not be completed.";
      }
      const error = new AuthServiceError(backendMessage, {
        code: backendCode,
        status: response.status,
      });
      this._publishVerificationError(error, expectedEpoch);
      throw error;
    }

    const verifiedUser = safeBackendUser(body);
    if (!verifiedUser) {
      const error = new AuthServiceError(
        "The backend returned an invalid authentication response.",
        { code: "INVALID_BACKEND_AUTH_RESPONSE", status: response.status },
      );
      this._publishVerificationError(error, expectedEpoch);
      throw error;
    }

    if (!this._isCurrentVerification(expectedEpoch)) return null;
    this._backendUser = verifiedUser;
    this._publish("signed_in");
    return { ...verifiedUser };
  }

  destroyAuthService() {
    if (this._destroyed) return;

    this._destroyed = true;
    this._initialized = false;
    this._verificationEpoch += 1;
    this._emailOtpVerificationActive = false;
    this._unsubscribeAuth?.();
    this._unsubscribeAuth = null;
    this._listeners.clear();
    this._session = null;
    this._backendUser = null;
    this._state = {
      status: "loading",
      session: null,
      backendUser: null,
      error: null,
    };
  }

  _ensureClient() {
    if (!this._configured) throw new AuthConfigurationError();
    if (!this._client) {
      this._client = this._clientFactory({
        locationOrigin: this._locationOrigin,
      });
    }
    return this._client;
  }

  _resolvedRedirectUrl() {
    if (typeof this._redirectUrl === "string" && this._redirectUrl.trim()) {
      return this._redirectUrl.trim();
    }
    return resolveAuthRedirectUrl(appConfig.auth, this._locationOrigin);
  }

  async _loadSession() {
    let result;
    try {
      result = await this._ensureClient().auth.getSession();
    } catch {
      throw sessionRestoreError();
    }
    if (result?.error) throw sessionRestoreError();
    return result?.data?.session ?? null;
  }

  _replaceSession(session) {
    this._session = session && typeof session === "object" ? session : null;
    this._backendUser = null;
    this._verificationEpoch += 1;
    return this._verificationEpoch;
  }

  _registerAuthSubscription() {
    if (this._unsubscribeAuth) return;

    const result = this._client.auth.onAuthStateChange((event, session) => {
      if (this._destroyed || !AUTH_EVENTS.has(event)) return;
      queueMicrotask(() => {
        if (this._destroyed) return;
        void this._handleAuthEvent(event, session);
      });
    });
    const subscription = result?.data?.subscription;
    this._unsubscribeAuth =
      typeof subscription?.unsubscribe === "function"
        ? () => subscription.unsubscribe()
        : () => {};
  }

  async _handleAuthEvent(event, session) {
    if (this._destroyed) return;
    if (event === "SIGNED_IN" && this._emailOtpVerificationActive) return;
    if (event === "SIGNED_OUT" || !session) {
      this._replaceSession(null);
      this._publish("signed_out");
      return;
    }

    const epoch = this._replaceSession(session);
    this._publish("loading");
    try {
      await this.verifyCurrentUserWithBackend(epoch);
    } catch {
      // Verification already published a safe error for this event.
    }
  }

  _isCurrentVerification(expectedEpoch) {
    return !this._destroyed && expectedEpoch === this._verificationEpoch;
  }

  _publishVerificationError(error, expectedEpoch) {
    if (!this._isCurrentVerification(expectedEpoch)) return;
    this._backendUser = null;
    this._publishError(error);
  }

  _publish(status) {
    this._state = {
      status,
      session: safeSessionSummary(this._session),
      backendUser: this._backendUser ? { ...this._backendUser } : null,
      error: null,
    };
    this._notifyListeners();
  }

  _publishError(error) {
    this._state = {
      status: "error",
      session: safeSessionSummary(this._session),
      backendUser: null,
      error: publicError(error),
    };
    this._notifyListeners();
  }

  _notifyListeners() {
    const state = this.getCurrentAuthState();
    for (const listener of this._listeners) {
      try {
        listener(cloneState(state));
      } catch {
        // Application listeners cannot break authentication state updates.
      }
    }
  }
}


const authService = new AuthService();


export const initializeAuthService = () => authService.initializeAuthService();
export const getCurrentSession = () => authService.getCurrentSession();
export const getCurrentAccessToken = () => authService.getCurrentAccessToken();
export const signInWithGoogle = () => authService.signInWithGoogle();
export const requestEmailOtp = (email) => authService.requestEmailOtp(email);
export const verifyEmailOtp = (email, otp) =>
  authService.verifyEmailOtp(email, otp);
export const signOut = () => authService.signOut();
export const subscribeToAuthChanges = (callback) =>
  authService.subscribeToAuthChanges(callback);
export const verifyCurrentUserWithBackend = () =>
  authService.verifyCurrentUserWithBackend();
export const getCurrentAuthState = () => authService.getCurrentAuthState();
export const destroyAuthService = () => authService.destroyAuthService();
