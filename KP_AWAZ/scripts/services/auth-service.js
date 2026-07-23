import { appConfig } from "../config.js?v=20260723-auth-config-v2";
import {
  AuthConfigurationError,
  getSupabaseClient,
  isSupabaseConfigured,
  resolveAuthRedirectUrl,
} from "./supabase-client.js?v=20260723-auth-config-v2";
import {
  AUTH_REQUEST_TIMEOUT_MESSAGE,
  AUTH_REQUEST_TIMEOUT_MS,
  isRequestTimeoutError,
  withRequestTimeout,
} from "./request-timeout.js?v=20260717-auth-routing";


const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_VERIFICATION_OTP_LENGTH = 6;
export const EMAIL_OTP_LENGTH = EMAIL_VERIFICATION_OTP_LENGTH;
export const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 72;
const EMAIL_OTP_PATTERN = new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`);
const EXISTING_ACCOUNT_SIGNUP_CODES = new Set([
  "email_exists",
  "user_already_exists",
]);
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
  "PASSWORD_RECOVERY",
]);
const SAFE_DEVELOPMENT_DIAGNOSTICS = new Set([
  "supabase_sign_in_failed",
  "backend_verification_failed",
  "profile_load_failed",
  "request_timeout",
  "network_unavailable",
]);


export class AuthServiceError extends Error {
  constructor(
    message,
    { code = "AUTH_ERROR", status = 0, diagnostic = null } = {},
  ) {
    super(message);
    this.name = "AuthServiceError";
    this.code = code;
    this.status = status;
    this.diagnostic =
      appConfig.environment === "development" &&
      SAFE_DEVELOPMENT_DIAGNOSTICS.has(diagnostic)
        ? diagnostic
        : null;
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
  const result = {
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
  if (SAFE_DEVELOPMENT_DIAGNOSTICS.has(error?.diagnostic)) {
    result.diagnostic = error.diagnostic;
  }
  return result;
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


function requestTimeoutError() {
  return new AuthServiceError(AUTH_REQUEST_TIMEOUT_MESSAGE, {
    code: "AUTH_REQUEST_TIMEOUT",
    diagnostic: "request_timeout",
  });
}


function preserveRequestTimeout(error, fallback) {
  return error?.code === "AUTH_REQUEST_TIMEOUT" ? error : fallback;
}


function accountAlreadyExistsError() {
  return new AuthServiceError("An account already exists with this email.", {
    code: "ACCOUNT_ALREADY_EXISTS",
  });
}


function isExistingAccountSignupError(error) {
  const code = typeof error?.code === "string" ? error.code.trim().toLowerCase() : "";
  return EXISTING_ACCOUNT_SIGNUP_CODES.has(code);
}


function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}


function normalizeEmailOtp(otp) {
  return typeof otp === "string" ? otp.replace(/[\s-]+/g, "") : "";
}


function normalizeRecoveryOtp(otp) {
  return typeof otp === "string" ? otp.trim().replace(/\s+/g, "") : "";
}


function requireValidEmail(email) {
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
  return cleanedEmail;
}


function requireValidPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < ACCOUNT_PASSWORD_MIN_LENGTH ||
    password.length > ACCOUNT_PASSWORD_MAX_LENGTH
  ) {
    throw new AuthServiceError(
      `Use a password between ${ACCOUNT_PASSWORD_MIN_LENGTH} and ${ACCOUNT_PASSWORD_MAX_LENGTH} characters.`,
      { code: "INVALID_PASSWORD" },
    );
  }
  return password;
}


function requireValidDisplayName(displayName) {
  const cleanedName =
    typeof displayName === "string" ? displayName.trim() : "";
  if (cleanedName.length < 2 || cleanedName.length > 80) {
    throw new AuthServiceError(
      "Display name must contain between 2 and 80 characters.",
      { code: "INVALID_DISPLAY_NAME" },
    );
  }
  return cleanedName;
}


function backendVerificationDiagnostic(error) {
  if (error?.code === "AUTH_REQUEST_TIMEOUT") return "request_timeout";
  if (error?.code === "AUTH_BACKEND_UNAVAILABLE") return "network_unavailable";
  return "backend_verification_failed";
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
    passwordResetRedirectUrl = null,
    requestTimeoutMs = AUTH_REQUEST_TIMEOUT_MS,
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
    this._passwordResetRedirectUrl = passwordResetRedirectUrl;
    this._requestTimeoutMs = requestTimeoutMs;
    this._listeners = new Set();
    this._unsubscribeAuth = null;
    this._session = null;
    this._backendUser = null;
    this._initialized = false;
    this._initializationPromise = null;
    this._destroyed = false;
    this._verificationEpoch = 0;
    this._verificationPromise = null;
    this._verificationAccessToken = null;
    this._verifiedAccessToken = null;
    this._emailOtpVerificationActive = false;
    this._passwordVerificationActive = false;
    this._recoveryOtpVerificationActive = false;
    this._passwordRecoveryActive = false;
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

  isPasswordRecoverySession() {
    return Boolean(
      this._passwordRecoveryActive &&
        this.getCurrentAccessToken(),
    );
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

  async _runRequest(operation, { onTimeout = null } = {}) {
    try {
      return await withRequestTimeout(operation, {
        timeoutMs: this._requestTimeoutMs,
        onTimeout,
      });
    } catch (error) {
      if (isRequestTimeoutError(error)) throw requestTimeoutError();
      throw error;
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
      this._registerAuthSubscription();
      const session = await this._loadSession();
      const epoch = this._replaceSession(session);
      this._initialized = true;

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
      const { error } = await this._runRequest(() =>
        client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: this._resolvedRedirectUrl() },
        }),
      );
      if (error) throw error;
    } catch (error) {
      throw preserveRequestTimeout(
        error,
        new AuthServiceError("Google sign-in could not be completed.", {
          code: "GOOGLE_SIGN_IN_FAILED",
        }),
      );
    }

    return { ok: true, redirecting: true };
  }

  async checkAccountStatus(email) {
    const cleanedEmail = requireValidEmail(email);
    let response;
    try {
      response = await this._runRequest(() =>
        this._fetch(`${this._apiBaseUrl}/auth/account-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: cleanedEmail }),
        }),
      );
    } catch {
      throw new AuthServiceError(
        "We could not check this email right now. Please try again.",
        { code: "ACCOUNT_STATUS_CHECK_FAILED" },
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (
      !response.ok ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof payload.accountExists !== "boolean"
    ) {
      throw new AuthServiceError(
        "We could not check this email right now. Please try again.",
        { code: "ACCOUNT_STATUS_CHECK_FAILED" },
      );
    }

    return { accountExists: payload.accountExists, email: cleanedEmail };
  }

  async requestEmailOtp(email) {
    const cleanedEmail = requireValidEmail(email);

    const client = this._ensureClient();
    try {
      const { error } = await this._runRequest(() =>
        client.auth.signInWithOtp({
          email: cleanedEmail,
          options: {
            shouldCreateUser: true,
          },
        }),
      );
      if (error) throw error;
    } catch (error) {
      throw preserveRequestTimeout(
        error,
        new AuthServiceError(
          "We could not send the sign-in code. Please try again.",
          { code: "EMAIL_OTP_SEND_FAILED" },
        ),
      );
    }

    return { ok: true, email: cleanedEmail };
  }

  async verifyEmailOtp(email, otp) {
    const cleanedEmail = requireValidEmail(email);

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
        verification = await this._runRequest(() =>
          client.auth.verifyOtp({
            email: cleanedEmail,
            token: cleanedOtp,
            type: "email",
          }),
        );
      } catch (error) {
        if (isExistingAccountSignupError(error)) {
          throw accountAlreadyExistsError();
        }
        throw preserveRequestTimeout(
          error,
          new AuthServiceError(
            "We could not verify the code. Please try again.",
            { code: "EMAIL_OTP_VERIFY_FAILED" },
          ),
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
      } catch (error) {
        throw preserveRequestTimeout(
          error,
          new AuthServiceError(
            "We could not verify the code. Please try again.",
            { code: "EMAIL_OTP_VERIFY_FAILED" },
          ),
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

  async signUpWithPassword({ email, password, displayName } = {}) {
    const cleanedEmail = requireValidEmail(email);
    const safePassword = requireValidPassword(password);
    const cleanedName = requireValidDisplayName(displayName);
    const client = this._ensureClient();
    this._passwordVerificationActive = true;

    try {
      let result;
      try {
        result = await this._runRequest(() =>
          client.auth.signUp({
            email: cleanedEmail,
            password: safePassword,
            options: {
              data: { display_name: cleanedName },
            },
          }),
        );
      } catch (error) {
        throw preserveRequestTimeout(
          error,
          new AuthServiceError(
            "We could not create your account. Please try again.",
            { code: "PASSWORD_SIGN_UP_FAILED" },
          ),
        );
      }

      if (result?.error) {
        if (isExistingAccountSignupError(result.error)) {
          throw accountAlreadyExistsError();
        }
        throw new AuthServiceError(
          "We could not create your account. Please try again.",
          { code: "PASSWORD_SIGN_UP_FAILED" },
        );
      }

      const session = result?.data?.session ?? null;
      if (session) await this._verifyInteractiveSession(session);
      return {
        ok: true,
        email: cleanedEmail,
        verificationRequired: !session,
      };
    } finally {
      this._passwordVerificationActive = false;
    }
  }

  async resendSignupOtp(email) {
    const cleanedEmail = requireValidEmail(email);
    const client = this._ensureClient();
    try {
      const { error } = await this._runRequest(() =>
        client.auth.resend({
          type: "signup",
          email: cleanedEmail,
        }),
      );
      if (error) throw error;
    } catch (error) {
      throw preserveRequestTimeout(
        error,
        new AuthServiceError(
          "We could not resend the verification code. Please try again.",
          { code: "SIGNUP_OTP_RESEND_FAILED" },
        ),
      );
    }
    return { ok: true, email: cleanedEmail };
  }

  async verifySignupOtp(email, otp) {
    const cleanedEmail = requireValidEmail(email);
    const cleanedOtp = normalizeEmailOtp(otp);
    if (!EMAIL_OTP_PATTERN.test(cleanedOtp)) {
      throw new AuthServiceError("Enter the complete six-digit code.", {
        code: "INVALID_SIGNUP_OTP",
      });
    }

    const client = this._ensureClient();
    this._passwordVerificationActive = true;
    try {
      let result;
      try {
        result = await this._runRequest(() =>
          client.auth.verifyOtp({
            email: cleanedEmail,
            token: cleanedOtp,
            type: "email",
          }),
        );
      } catch (error) {
        throw preserveRequestTimeout(
          error,
          new AuthServiceError(
            "We could not verify the code. Please try again.",
            { code: "SIGNUP_OTP_VERIFY_FAILED" },
          ),
        );
      }

      if (result?.error) {
        throw new AuthServiceError(
          "Invalid or expired code. Request a new code and try again.",
          { code: "INVALID_OR_EXPIRED_SIGNUP_OTP" },
        );
      }

      const session = result?.data?.session ?? (await this._loadSession());
      if (!session) {
        throw new AuthServiceError(
          "We could not verify the code. Please try again.",
          { code: "SIGNUP_OTP_VERIFY_FAILED" },
        );
      }
      await this._verifyInteractiveSession(session);
      return { ok: true, email: cleanedEmail };
    } finally {
      this._passwordVerificationActive = false;
    }
  }

  async signInWithPassword({ email, password } = {}) {
    const cleanedEmail = requireValidEmail(email);
    const safePassword = requireValidPassword(password);
    const client = this._ensureClient();
    this._passwordVerificationActive = true;

    try {
      let result;
      try {
        result = await this._runRequest(() =>
          client.auth.signInWithPassword({
            email: cleanedEmail,
            password: safePassword,
          }),
        );
      } catch (error) {
        throw preserveRequestTimeout(
          error,
          new AuthServiceError(
            "We could not sign you in with that email and password.",
            {
              code: "PASSWORD_SIGN_IN_FAILED",
              diagnostic: "supabase_sign_in_failed",
            },
          ),
        );
      }
      if (result?.error || !result?.data?.session) {
        throw new AuthServiceError(
          "We could not sign you in with that email and password.",
          {
            code: "PASSWORD_SIGN_IN_FAILED",
            diagnostic: "supabase_sign_in_failed",
          },
        );
      }
      try {
        await this._verifyInteractiveSession(result.data.session);
      } catch (error) {
        throw new AuthServiceError(
          "You signed in successfully, but KP AWAZ could not open your workspace. Please try again.",
          {
            code: "BACKEND_VERIFICATION_FAILED",
            status: Number.isInteger(error?.status) ? error.status : 0,
            diagnostic: backendVerificationDiagnostic(error),
          },
        );
      }
      return { ok: true, email: cleanedEmail };
    } finally {
      this._passwordVerificationActive = false;
    }
  }

  async requestPasswordReset(email) {
    const cleanedEmail = requireValidEmail(email);
    const client = this._ensureClient();
    let redirectTo;
    try {
      const configuredRedirect =
        typeof this._passwordResetRedirectUrl === "string" &&
        this._passwordResetRedirectUrl.trim()
          ? this._passwordResetRedirectUrl.trim()
          : appConfig.auth.passwordResetRedirectUrl;
      redirectTo = new URL(configuredRedirect, this._locationOrigin).href;
    } catch {
      throw new AuthServiceError(
        "We could not start password recovery. Please try again.",
        { code: "PASSWORD_RESET_REQUEST_FAILED" },
      );
    }

    try {
      const { error } = await this._runRequest(() =>
        client.auth.resetPasswordForEmail(cleanedEmail, { redirectTo }),
      );
      if (error) throw error;
    } catch (error) {
      throw preserveRequestTimeout(
        error,
        new AuthServiceError(
          "We could not start password recovery. Please try again.",
          { code: "PASSWORD_RESET_REQUEST_FAILED" },
        ),
      );
    }
    return { ok: true, email: cleanedEmail };
  }

  async verifyRecoveryOtp(email, otp) {
    const cleanedEmail = requireValidEmail(email);
    const cleanedOtp = normalizeRecoveryOtp(otp);
    if (!EMAIL_OTP_PATTERN.test(cleanedOtp)) {
      throw new AuthServiceError("Enter the complete six-digit recovery code.", {
        code: "INVALID_RECOVERY_OTP",
      });
    }

    const client = this._ensureClient();
    this._recoveryOtpVerificationActive = true;
    try {
      let result;
      try {
        result = await this._runRequest(() =>
          client.auth.verifyOtp({
            email: cleanedEmail,
            token: cleanedOtp,
            type: "recovery",
          }),
        );
      } catch (error) {
        throw preserveRequestTimeout(
          error,
          new AuthServiceError(
            "The recovery code is invalid or has expired. Request a new code and try again.",
            { code: "RECOVERY_OTP_VERIFY_FAILED" },
          ),
        );
      }

      if (result?.error) {
        throw new AuthServiceError(
          "The recovery code is invalid or has expired. Request a new code and try again.",
          { code: "INVALID_OR_EXPIRED_RECOVERY_OTP" },
        );
      }
      const session = result?.data?.session ?? (await this._loadSession());
      if (
        !session ||
        typeof session.access_token !== "string" ||
        !session.access_token.trim()
      ) {
        throw new AuthServiceError(
          "The recovery code is invalid or has expired. Request a new code and try again.",
          { code: "RECOVERY_OTP_VERIFY_FAILED" },
        );
      }

      this._replaceSession(session);
      this._backendUser = null;
      this._verifiedAccessToken = null;
      this._passwordRecoveryActive = true;
      this._publish("recovery");
      return { ok: true, email: cleanedEmail };
    } finally {
      this._recoveryOtpVerificationActive = false;
    }
  }

  async updatePassword(password) {
    const safePassword = requireValidPassword(password);
    if (
      !this._passwordRecoveryActive ||
      !this.getCurrentAccessToken()
    ) {
      throw new AuthServiceError("A verified session is required.", {
        code: "PASSWORD_UPDATE_SESSION_REQUIRED",
        status: 401,
      });
    }

    const client = this._ensureClient();
    try {
      const { error } = await this._runRequest(() =>
        client.auth.updateUser({ password: safePassword }),
      );
      if (error) throw error;
    } catch (error) {
      throw preserveRequestTimeout(
        error,
        new AuthServiceError(
          "We could not update the password. Please try again.",
          { code: "PASSWORD_UPDATE_FAILED" },
        ),
      );
    }
    this._passwordRecoveryActive = false;
    return { ok: true };
  }

  async signOut() {
    const client = this._ensureClient();
    try {
      const { error } = await this._runRequest(() => client.auth.signOut());
      if (error) throw error;
    } catch (error) {
      throw preserveRequestTimeout(
        error,
        new AuthServiceError("Sign-out could not be completed.", {
          code: "SIGN_OUT_FAILED",
        }),
      );
    }

    this._replaceSession(null);
    this._passwordRecoveryActive = false;
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

    if (this._backendUser && this._verifiedAccessToken === accessToken) {
      if (this._state.status !== "signed_in") this._publish("signed_in");
      return { ...this._backendUser };
    }

    let verification = this._verificationPromise;
    if (!verification || this._verificationAccessToken !== accessToken) {
      this._verificationAccessToken = accessToken;
      verification = this._requestVerifiedUser(accessToken);
      this._verificationPromise = verification;
    }

    try {
      const verifiedUser = await verification;
      if (!this._isCurrentVerification(expectedEpoch)) return null;
      if (this._backendUser && this._verifiedAccessToken === accessToken) {
        return { ...this._backendUser };
      }
      this._backendUser = verifiedUser;
      this._verifiedAccessToken = accessToken;
      this._publish("signed_in");
      return { ...verifiedUser };
    } catch (error) {
      this._publishVerificationError(error, expectedEpoch);
      throw error;
    } finally {
      if (this._verificationPromise === verification) {
        this._verificationPromise = null;
        this._verificationAccessToken = null;
      }
    }
  }

  async _requestVerifiedUser(accessToken) {
    let response;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    try {
      response = await this._runRequest(
        () =>
          this._fetch(`${this._apiBaseUrl}/auth/me`, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            ...(controller ? { signal: controller.signal } : {}),
          }),
        { onTimeout: () => controller?.abort() },
      );
    } catch (requestError) {
      const error = preserveRequestTimeout(
        requestError,
        new AuthServiceError(
          "The authentication service could not be reached.",
          { code: "AUTH_BACKEND_UNAVAILABLE", status: 0 },
        ),
      );
      throw error;
    }

    let body = null;
    try {
      body = await this._runRequest(() => response.json());
    } catch (error) {
      if (error?.code === "AUTH_REQUEST_TIMEOUT") throw error;
      // A safe malformed-response error is created below.
    }

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
      throw error;
    }

    const verifiedUser = safeBackendUser(body);
    if (!verifiedUser) {
      const error = new AuthServiceError(
        "The backend returned an invalid authentication response.",
        { code: "INVALID_BACKEND_AUTH_RESPONSE", status: response.status },
      );
      throw error;
    }
    return verifiedUser;
  }

  destroyAuthService() {
    if (this._destroyed) return;

    this._destroyed = true;
    this._initialized = false;
    this._verificationEpoch += 1;
    this._verificationPromise = null;
    this._verificationAccessToken = null;
    this._verifiedAccessToken = null;
    this._emailOtpVerificationActive = false;
    this._passwordVerificationActive = false;
    this._recoveryOtpVerificationActive = false;
    this._passwordRecoveryActive = false;
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
      result = await this._runRequest(() =>
        this._ensureClient().auth.getSession(),
      );
    } catch (error) {
      throw preserveRequestTimeout(error, sessionRestoreError());
    }
    if (result?.error) throw sessionRestoreError();
    return result?.data?.session ?? null;
  }

  async _verifyInteractiveSession(session) {
    const epoch = this._replaceSession(session);
    this._publish("loading");
    const backendUser = await this.verifyCurrentUserWithBackend(epoch);
    if (!backendUser) {
      const state = this.getCurrentAuthState();
      if (state.status !== "signed_in" || !state.backendUser) {
        throw new AuthServiceError(
          "Account verification could not be completed. Please try again.",
          { code: "ACCOUNT_VERIFICATION_FAILED" },
        );
      }
    }
    return backendUser;
  }

  _replaceSession(session) {
    const nextSession = session && typeof session === "object" ? session : null;
    const previousToken = this.getCurrentAccessToken();
    const nextToken =
      typeof nextSession?.access_token === "string" && nextSession.access_token.trim()
        ? nextSession.access_token
        : null;
    this._session = nextSession;
    if (previousToken !== nextToken) {
      this._backendUser = null;
      this._verifiedAccessToken = null;
      this._verificationEpoch += 1;
    }
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
    if (
      event === "SIGNED_IN" &&
      (this._emailOtpVerificationActive ||
        this._passwordVerificationActive ||
        this._recoveryOtpVerificationActive)
    ) {
      return;
    }
    if (event === "SIGNED_OUT" || !session) {
      this._replaceSession(null);
      this._passwordRecoveryActive = false;
      this._publish("signed_out");
      return;
    }

    if (event === "PASSWORD_RECOVERY") {
      this._replaceSession(session);
      this._backendUser = null;
      this._verifiedAccessToken = null;
      this._passwordRecoveryActive = true;
      this._publish("recovery");
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
export const isPasswordRecoverySession = () =>
  authService.isPasswordRecoverySession();
export const signInWithGoogle = () => authService.signInWithGoogle();
export const checkAccountStatus = (email) =>
  authService.checkAccountStatus(email);
export const requestEmailOtp = (email) => authService.requestEmailOtp(email);
export const verifyEmailOtp = (email, otp) =>
  authService.verifyEmailOtp(email, otp);
export const signUpWithPassword = (input) =>
  authService.signUpWithPassword(input);
export const resendSignupOtp = (email) => authService.resendSignupOtp(email);
export const verifySignupOtp = (email, otp) =>
  authService.verifySignupOtp(email, otp);
export const signInWithPassword = (input) =>
  authService.signInWithPassword(input);
export const requestPasswordReset = (email) =>
  authService.requestPasswordReset(email);
export const verifyRecoveryOtp = (email, otp) =>
  authService.verifyRecoveryOtp(email, otp);
export const updatePassword = (password) => authService.updatePassword(password);
export const signOut = () => authService.signOut();
export const subscribeToAuthChanges = (callback) =>
  authService.subscribeToAuthChanges(callback);
export const verifyCurrentUserWithBackend = () =>
  authService.verifyCurrentUserWithBackend();
export const getCurrentAuthState = () => authService.getCurrentAuthState();
export const destroyAuthService = () => authService.destroyAuthService();
