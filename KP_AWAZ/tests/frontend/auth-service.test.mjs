import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  AuthService,
  AuthServiceError,
} from "../../scripts/services/auth-service.js";
import {
  AuthConfigurationError,
  getSupabaseClient,
  isSupabaseConfigured,
  normalizeSupabaseUrl,
  resetSupabaseClientForTests,
  resolveAuthRedirectUrl,
} from "../../scripts/services/supabase-client.js";


const SUPABASE_URL = "https://test-project.supabase.co";
const PUBLISHABLE_KEY = "test-publishable-key";
const REDIRECT_URL = "https://app.example.test/auth/callback";
const API_BASE_URL = "https://api.example.test/api";
const USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092";
const SECOND_USER_ID = "ced70c1c-1455-4015-8578-34ff93655dab";
const ACCESS_TOKEN = "fake-access-token-private";
const REFRESH_TOKEN = "fake-refresh-token-private";
const PROVIDER_TOKEN = "fake-provider-token-private";


afterEach(() => {
  resetSupabaseClientForTests();
});


function authConfig(overrides = {}) {
  return {
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: PUBLISHABLE_KEY,
    redirectUrl: "",
    ...overrides,
  };
}


function session(overrides = {}) {
  return {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    provider_token: PROVIDER_TOKEN,
    provider_refresh_token: "fake-provider-refresh-token-private",
    user: {
      id: USER_ID,
      email: "person@example.com",
      app_metadata: {
        provider: "google",
        private_role: "must-not-appear",
      },
      user_metadata: { private_name: "must-not-appear" },
    },
    ...overrides,
  };
}


function verifiedUser(overrides = {}) {
  return {
    id: USER_ID,
    email: "person@example.com",
    provider: "google",
    ...overrides,
  };
}


function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}


function createFakeSupabase({
  initialSession = null,
  sessionError = null,
  googleError = null,
  emailError = null,
  signUpError = null,
  passwordSignInError = null,
  resendError = null,
  resetError = null,
  updateUserError = null,
  otpError = null,
  signUpSession = null,
  otpSession = session({
    user: {
      id: USER_ID,
      email: "person@example.com",
      app_metadata: { provider: "email" },
    },
  }),
  signOutError = null,
} = {}) {
  const calls = {
    getSession: 0,
    google: [],
    email: [],
    signUp: [],
    passwordSignIn: [],
    resend: [],
    passwordReset: [],
    updateUser: [],
    otp: [],
    signOut: 0,
    subscriptions: 0,
    unsubscriptions: 0,
  };
  let authCallback = null;
  let currentSession = initialSession;

  const client = {
    auth: {
      async getSession() {
        calls.getSession += 1;
        if (sessionError instanceof Error) throw sessionError;
        return {
          data: { session: currentSession },
          error: sessionError,
        };
      },
      async signInWithOAuth(input) {
        calls.google.push(input);
        return { data: {}, error: googleError };
      },
      async signInWithOtp(input) {
        calls.email.push(input);
        return { data: {}, error: emailError };
      },
      async signUp(input) {
        calls.signUp.push(input);
        if (!signUpError && signUpSession) currentSession = signUpSession;
        return {
          data: { session: signUpError ? null : signUpSession },
          error: signUpError,
        };
      },
      async signInWithPassword(input) {
        calls.passwordSignIn.push(input);
        if (!passwordSignInError) currentSession = otpSession;
        return {
          data: { session: passwordSignInError ? null : otpSession },
          error: passwordSignInError,
        };
      },
      async resend(input) {
        calls.resend.push(input);
        return { data: {}, error: resendError };
      },
      async resetPasswordForEmail(email, options) {
        calls.passwordReset.push({ email, options });
        return { data: {}, error: resetError };
      },
      async updateUser(input) {
        calls.updateUser.push(input);
        return { data: {}, error: updateUserError };
      },
      async verifyOtp(input) {
        calls.otp.push(input);
        if (!otpError) currentSession = otpSession;
        return {
          data: { session: otpError ? null : otpSession },
          error: otpError,
        };
      },
      async signOut() {
        calls.signOut += 1;
        if (!signOutError) currentSession = null;
        return { error: signOutError };
      },
      onAuthStateChange(callback) {
        calls.subscriptions += 1;
        authCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe() {
                calls.unsubscriptions += 1;
                authCallback = null;
              },
            },
          },
        };
      },
    },
  };

  return {
    calls,
    client,
    emit(event, nextSession) {
      currentSession = nextSession;
      authCallback?.(event, nextSession);
    },
  };
}


function createService(fake, overrides = {}) {
  return new AuthService({
    apiBaseUrl: API_BASE_URL,
    client: fake.client,
    configured: true,
    fetchImpl: async () => jsonResponse(verifiedUser()),
    redirectUrl: REDIRECT_URL,
    ...overrides,
  });
}


async function settleAuthEvent() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}


test("missing Supabase URL reports not configured", () => {
  assert.equal(isSupabaseConfigured(authConfig({ supabaseUrl: "" })), false);
});


test("missing publishable key reports not configured", () => {
  assert.equal(
    isSupabaseConfigured(authConfig({ supabasePublishableKey: "" })),
    false,
  );
});


test("complete Supabase configuration reports configured", () => {
  assert.equal(isSupabaseConfigured(authConfig()), true);
});


test("Supabase URL trailing slashes are removed", () => {
  assert.equal(normalizeSupabaseUrl(`${SUPABASE_URL}///`), SUPABASE_URL);
});


test("blank redirect URL uses the application root", () => {
  assert.equal(
    resolveAuthRedirectUrl(authConfig(), "http://127.0.0.1:4173"),
    "http://127.0.0.1:4173/",
  );
});


test("explicit redirect URL is respected", () => {
  assert.equal(
    resolveAuthRedirectUrl(authConfig({ redirectUrl: REDIRECT_URL })),
    REDIRECT_URL,
  );
});


test("configuration errors never contain configured key values", () => {
  assert.throws(
    () =>
      getSupabaseClient({
        config: authConfig({ supabaseUrl: "" }),
        createClientImpl() {
          throw new Error("must not be called");
        },
        locationOrigin: "https://app.example.test",
      }),
    (error) => {
      assert.ok(error instanceof AuthConfigurationError);
      assert.equal(error.code, "AUTH_NOT_CONFIGURED");
      assert.equal(String(error).includes(PUBLISHABLE_KEY), false);
      return true;
    },
  );
});


test("Supabase browser client is singleton and created only once", () => {
  let creations = 0;
  const createdClient = { auth: {} };
  const options = {
    config: authConfig(),
    createClientImpl() {
      creations += 1;
      return createdClient;
    },
    locationOrigin: "https://app.example.test",
  };

  assert.equal(getSupabaseClient(options), createdClient);
  assert.equal(getSupabaseClient(options), createdClient);
  assert.equal(creations, 1);
});


test("client receives the publishable key and secure browser auth options", () => {
  let creation;
  getSupabaseClient({
    config: authConfig(),
    createClientImpl(url, key, options) {
      creation = { url, key, options };
      return { auth: {} };
    },
    locationOrigin: "https://app.example.test",
  });

  assert.equal(creation.url, SUPABASE_URL);
  assert.equal(creation.key, PUBLISHABLE_KEY);
  assert.deepEqual(creation.options.auth, {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  });
  assert.equal("serviceRoleKey" in creation.options, false);
  assert.equal("storage" in creation.options.auth, false);
});


test("Google sign-in uses provider, redirect, and no unnecessary scopes", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake);

  const result = await service.signInWithGoogle();

  assert.deepEqual(result, { ok: true, redirecting: true });
  assert.deepEqual(fake.calls.google, [
    {
      provider: "google",
      options: { redirectTo: REDIRECT_URL },
    },
  ]);
  assert.equal("scopes" in fake.calls.google[0].options, false);
  assert.equal("prompt" in fake.calls.google[0].options, false);
  assert.equal(fake.calls.email.length, 0);
  assert.equal(fake.calls.otp.length, 0);
});


test("Google sign-in failure becomes a safe frontend error", async () => {
  const fake = createFakeSupabase({
    googleError: new Error(`raw ${ACCESS_TOKEN}`),
  });
  const service = createService(fake);

  await assert.rejects(service.signInWithGoogle(), (error) => {
    assert.ok(error instanceof AuthServiceError);
    assert.equal(error.code, "GOOGLE_SIGN_IN_FAILED");
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
});


test("missing configuration prevents Google sign-in", async () => {
  const service = new AuthService({ configured: false });

  await assert.rejects(service.signInWithGoogle(), AuthConfigurationError);
});


test("Google sign-in does not store provider tokens in public state", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake);

  await service.signInWithGoogle();

  assert.equal(
    JSON.stringify(service.getCurrentAuthState()).includes(PROVIDER_TOKEN),
    false,
  );
});


test("valid normalized email requests a six-digit sign-in code", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake);

  const result = await service.requestEmailOtp("  Person@Example.com  ");

  assert.deepEqual(fake.calls.email, [
    {
      email: "person@example.com",
      options: {
        shouldCreateUser: true,
      },
    },
  ]);
  assert.deepEqual(result, { ok: true, email: "person@example.com" });
  assert.equal("emailRedirectTo" in fake.calls.email[0].options, false);
});


test("blank and clearly malformed email addresses are rejected", async (context) => {
  for (const email of ["", "   ", "missing-at.example.com", "person@example"]) {
    await context.test(email || "blank", async () => {
      const service = createService(createFakeSupabase());
      await assert.rejects(service.requestEmailOtp(email), (error) => {
        assert.equal(error.code, "INVALID_EMAIL");
        return true;
      });
    });
  }
});


test("Supabase code-request error becomes a safe frontend error", async () => {
  const fake = createFakeSupabase({
    emailError: new Error(`raw ${ACCESS_TOKEN}`),
  });
  const service = createService(fake);

  await assert.rejects(service.requestEmailOtp("person@example.com"), (error) => {
    assert.equal(error.code, "EMAIL_OTP_SEND_FAILED");
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
});


test("six-digit email OTP verifies with type email and enters signed-in state", async () => {
  const fake = createFakeSupabase();
  const backendRequests = [];
  const service = createService(fake, {
    fetchImpl: async (url, options) => {
      backendRequests.push({ url, options });
      return jsonResponse(verifiedUser({ provider: "email" }));
    },
  });

  const result = await service.verifyEmailOtp(
    "  Person@Example.com ",
    " 12 34 56 ",
  );

  assert.deepEqual(fake.calls.otp, [
    {
      email: "person@example.com",
      token: "123456",
      type: "email",
    },
  ]);
  assert.deepEqual(result, { ok: true, email: "person@example.com" });
  assert.equal(fake.calls.getSession, 1);
  assert.equal(service.getCurrentAuthState().status, "signed_in");
  assert.deepEqual(
    service.getCurrentAuthState().backendUser,
    verifiedUser({ provider: "email" }),
  );
  assert.equal(backendRequests.length, 1);
  assert.equal(backendRequests[0].url, `${API_BASE_URL}/auth/me`);
  assert.equal(
    backendRequests[0].options.headers.Authorization,
    `Bearer ${ACCESS_TOKEN}`,
  );
  assert.equal(JSON.stringify(backendRequests).includes("123456"), false);
});


test("email OTP normalization removes harmless spaces and hyphens", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake);

  await service.verifyEmailOtp("person@example.com", "12-34 56");

  assert.deepEqual(fake.calls.otp[0], {
    email: "person@example.com",
    token: "123456",
    type: "email",
  });
});


test("incomplete and nonnumeric OTP values are rejected before Supabase", async (context) => {
  for (const otp of ["", "12345", "1234567", "12a456"]) {
    await context.test(otp || "blank", async () => {
      const fake = createFakeSupabase();
      const service = createService(fake);

      await assert.rejects(
        service.verifyEmailOtp("person@example.com", otp),
        (error) => {
          assert.equal(error.code, "INVALID_EMAIL_OTP");
          return true;
        },
      );
      assert.equal(fake.calls.otp.length, 0);
    });
  }
});


test("invalid or expired Supabase OTP returns only the safe fixed error", async () => {
  const fake = createFakeSupabase({
    otpError: new Error(`expired 123456 ${ACCESS_TOKEN}`),
  });
  const service = createService(fake);

  await assert.rejects(
    service.verifyEmailOtp("person@example.com", "123456"),
    (error) => {
      assert.equal(error.code, "INVALID_OR_EXPIRED_EMAIL_OTP");
      assert.equal(
        error.message,
        "Invalid or expired code. Request a new code and try again.",
      );
      assert.equal(error.message.includes("123456"), false);
      assert.equal(error.message.includes(ACCESS_TOKEN), false);
      return true;
    },
  );
});


test("password signup normalizes identity and requests email verification", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake);
  const password = "voice-path-2026";

  const result = await service.signUpWithPassword({
    email: "  Person@Example.com ",
    password,
    displayName: "  Faisal Imran  ",
  });

  assert.deepEqual(result, {
    ok: true,
    email: "person@example.com",
    verificationRequired: true,
  });
  assert.deepEqual(fake.calls.signUp, [
    {
      email: "person@example.com",
      password,
      options: { data: { display_name: "Faisal Imran" } },
    },
  ]);
  assert.equal(JSON.stringify(result).includes(password), false);
  assert.equal(JSON.stringify(service.getCurrentAuthState()).includes(password), false);
});


test("account status normalizes email and calls only the FastAPI endpoint", async () => {
  const fake = createFakeSupabase();
  const requests = [];
  const service = createService(fake, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ accountExists: true });
    },
  });

  const result = await service.checkAccountStatus(" Person@Example.com ");

  assert.deepEqual(result, {
    accountExists: true,
    email: "person@example.com",
  });
  assert.equal(requests[0].url, `${API_BASE_URL}/auth/account-status`);
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    email: "person@example.com",
  });
  assert.equal("Authorization" in requests[0].options.headers, false);
  assert.equal(fake.calls.signUp.length, 0);
});


test("invalid account-status email is rejected before any request", async () => {
  let requests = 0;
  const service = createService(createFakeSupabase(), {
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse({ accountExists: false });
    },
  });

  await assert.rejects(service.checkAccountStatus("invalid"), (error) => {
    assert.equal(error.code, "INVALID_EMAIL");
    return true;
  });
  assert.equal(requests, 0);
});


test("account-status failures expose only the safe retry message", async () => {
  const service = createService(createFakeSupabase(), {
    fetchImpl: async () =>
      jsonResponse({ message: `raw ${ACCESS_TOKEN}`, userId: USER_ID }, 503),
  });

  await assert.rejects(
    service.checkAccountStatus("person@example.com"),
    (error) => {
      assert.equal(error.code, "ACCOUNT_STATUS_CHECK_FAILED");
      assert.equal(
        error.message,
        "We could not check this email right now. Please try again.",
      );
      assert.equal(error.message.includes(ACCESS_TOKEN), false);
      return true;
    },
  );
});


for (const code of ["email_exists", "user_already_exists"]) {
  test(`${code} is mapped to the safe existing-account result`, async () => {
    const fake = createFakeSupabase({ signUpError: { code, message: "raw" } });
    const service = createService(fake);

    await assert.rejects(
      service.signUpWithPassword({
        email: "person@example.com",
        password: "strong-password",
        displayName: "Person",
      }),
      (error) => {
        assert.equal(error.code, "ACCOUNT_ALREADY_EXISTS");
        assert.equal(error.message, "An account already exists with this email.");
        assert.equal(error.message.includes("raw"), false);
        return true;
      },
    );
  });
}


test("invalid password signup details are rejected before Supabase", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake);

  await assert.rejects(
    service.signUpWithPassword({
      email: "person@example.com",
      password: "short",
      displayName: "Person",
    }),
    (error) => error.code === "INVALID_PASSWORD",
  );
  await assert.rejects(
    service.signUpWithPassword({
      email: "person@example.com",
      password: "long-enough-password",
      displayName: "x",
    }),
    (error) => error.code === "INVALID_DISPLAY_NAME",
  );
  assert.equal(fake.calls.signUp.length, 0);
});


test("signup OTP verifies with type email and enters the existing backend flow", async () => {
  const fake = createFakeSupabase();
  const backendRequests = [];
  const service = createService(fake, {
    fetchImpl: async (url, options) => {
      backendRequests.push({ url, options });
      return jsonResponse(verifiedUser({ provider: "email" }));
    },
  });

  const result = await service.verifySignupOtp(
    " Person@Example.com ",
    "12 34 56",
  );

  assert.deepEqual(fake.calls.otp, [
    {
      email: "person@example.com",
      token: "123456",
      type: "email",
    },
  ]);
  assert.deepEqual(result, { ok: true, email: "person@example.com" });
  assert.equal(service.getCurrentAuthState().status, "signed_in");
  assert.equal(backendRequests.length, 1);
  assert.equal(JSON.stringify(backendRequests).includes("123456"), false);
});


test("signup OTP resend uses the verified signup email contract", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake);

  const result = await service.resendSignupOtp(" PERSON@example.com ");

  assert.deepEqual(result, { ok: true, email: "person@example.com" });
  assert.deepEqual(fake.calls.resend, [
    { type: "signup", email: "person@example.com" },
  ]);
});


test("password sign-in verifies the resulting session with FastAPI", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake);
  const password = "returning-voice-2026";

  const result = await service.signInWithPassword({
    email: "Person@Example.com",
    password,
  });

  assert.deepEqual(result, { ok: true, email: "person@example.com" });
  assert.deepEqual(fake.calls.passwordSignIn, [
    { email: "person@example.com", password },
  ]);
  assert.equal(service.getCurrentAuthState().status, "signed_in");
  assert.equal(JSON.stringify(service.getCurrentAuthState()).includes(password), false);
});


test("password authentication failures never expose raw Supabase errors", async () => {
  const fake = createFakeSupabase({
    signUpError: new Error(`duplicate ${ACCESS_TOKEN}`),
    passwordSignInError: new Error(`invalid ${REFRESH_TOKEN}`),
    resendError: new Error("smtp-private-detail"),
  });
  const service = createService(fake);

  await assert.rejects(
    service.signUpWithPassword({
      email: "person@example.com",
      password: "secure-password",
      displayName: "Person",
    }),
    (error) =>
      error.code === "PASSWORD_SIGN_UP_FAILED" &&
      error.message === "We could not create your account. Please try again." &&
      !error.message.includes(ACCESS_TOKEN),
  );
  await assert.rejects(
    service.signInWithPassword({
      email: "person@example.com",
      password: "secure-password",
    }),
    (error) =>
      error.code === "PASSWORD_SIGN_IN_FAILED" &&
      error.message ===
        "We could not sign you in with that email and password." &&
      !error.message.includes(REFRESH_TOKEN),
  );
  await assert.rejects(
    service.resendSignupOtp("person@example.com"),
    (error) =>
      error.code === "SIGNUP_OTP_RESEND_FAILED" &&
      !error.message.includes("smtp-private-detail"),
  );
});


test("password recovery normalizes email and uses the allowed reset page", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake, {
    locationOrigin: "https://app.example.test",
  });

  const result = await service.requestPasswordReset(" Person@Example.com ");

  assert.deepEqual(result, { ok: true, email: "person@example.com" });
  assert.deepEqual(fake.calls.passwordReset, [{
    email: "person@example.com",
    options: { redirectTo: "https://app.example.test/reset-password.html" },
  }]);
});


test("password recovery respects the configured production reset URL", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake, {
    locationOrigin: "https://app.example.test",
    passwordResetRedirectUrl: "https://voice.example.test/reset-password.html",
  });

  await service.requestPasswordReset("person@example.com");

  assert.equal(
    fake.calls.passwordReset[0].options.redirectTo,
    "https://voice.example.test/reset-password.html",
  );
});


test("verified password-recovery session can update password through Supabase only", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake);
  await service.initializeAuthService();
  fake.emit("PASSWORD_RECOVERY", session());
  await settleAuthEvent();

  assert.equal(service.isPasswordRecoverySession(), true);
  await service.updatePassword("a-secure-new-password");

  assert.deepEqual(fake.calls.updateUser, [{ password: "a-secure-new-password" }]);
  assert.equal(service.isPasswordRecoverySession(), false);
});


test("six-digit recovery OTP uses recovery type and never calls FastAPI", async () => {
  const fake = createFakeSupabase();
  let backendCalls = 0;
  const service = createService(fake, {
    fetchImpl: async () => {
      backendCalls += 1;
      return jsonResponse(verifiedUser());
    },
  });

  const result = await service.verifyRecoveryOtp(
    " Person@Example.com ",
    " 123 456 ",
  );

  assert.deepEqual(result, { ok: true, email: "person@example.com" });
  assert.deepEqual(fake.calls.otp, [{
    email: "person@example.com",
    token: "123456",
    type: "recovery",
  }]);
  assert.equal(backendCalls, 0);
  assert.equal(service.isPasswordRecoverySession(), true);
});


test("recovery OTP rejects letters and incomplete values before Supabase", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake);

  for (const otp of ["12345", "12a456", "123-456"]) {
    await assert.rejects(service.verifyRecoveryOtp("person@example.com", otp), {
      code: "INVALID_RECOVERY_OTP",
    });
  }
  assert.equal(fake.calls.otp.length, 0);
});


test("FastAPI failure after password acceptance is not reported as a password failure", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake, {
    fetchImpl: async () => {
      throw new Error("backend offline");
    },
  });

  await assert.rejects(
    service.signInWithPassword({
      email: "Person@Example.com",
      password: " password-kept-exactly ",
    }),
    (error) => {
      assert.equal(error.code, "BACKEND_VERIFICATION_FAILED");
      assert.equal(
        error.message,
        "You signed in successfully, but KP AWAZ could not open your workspace. Please try again.",
      );
      return true;
    },
  );
  assert.deepEqual(fake.calls.passwordSignIn, [{
    email: "person@example.com",
    password: " password-kept-exactly ",
  }]);
  assert.equal(service.getCurrentAccessToken(), ACCESS_TOKEN);
});


test("OTP verification failure never exposes raw Supabase secrets", async () => {
  const fake = createFakeSupabase();
  fake.client.auth.verifyOtp = async () => {
    throw new Error(`network 123456 ${REFRESH_TOKEN}`);
  };
  const service = createService(fake);

  await assert.rejects(
    service.verifyEmailOtp("person@example.com", "123456"),
    (error) => {
      assert.equal(error.code, "EMAIL_OTP_VERIFY_FAILED");
      assert.equal(
        error.message,
        "We could not verify the code. Please try again.",
      );
      assert.equal(error.message.includes("123456"), false);
      assert.equal(error.message.includes(REFRESH_TOKEN), false);
      return true;
    },
  );
});


test("null session initializes as signed out", async () => {
  const fake = createFakeSupabase({ initialSession: null });
  const service = createService(fake);

  const state = await service.initializeAuthService();

  assert.equal(state.status, "signed_out");
  assert.equal(state.session, null);
  assert.equal(fake.calls.subscriptions, 1);
});


test("existing session is restored and verified by FastAPI", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake);

  const state = await service.initializeAuthService();

  assert.equal(state.status, "signed_in");
  assert.deepEqual(state.backendUser, verifiedUser());
  assert.equal(service.getCurrentAccessToken(), ACCESS_TOKEN);
});


test("public auth state exposes no session or provider token values", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake);

  const state = await service.initializeAuthService();
  const serialized = JSON.stringify(state);

  assert.equal(state.session.accessTokenAvailable, true);
  for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, PROVIDER_TOKEN]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(serialized.includes("private_name"), false);
  assert.equal(serialized.includes("private_role"), false);
  assert.deepEqual(Object.keys(state.session).sort(), [
    "accessTokenAvailable",
    "email",
    "provider",
    "userId",
  ]);
});


test("session restoration errors become safe public errors", async () => {
  const fake = createFakeSupabase({
    sessionError: new Error(`raw ${ACCESS_TOKEN}`),
  });
  const service = createService(fake);

  const state = await service.initializeAuthService();

  assert.equal(state.status, "error");
  assert.equal(state.error.code, "SESSION_RESTORE_FAILED");
  assert.equal(JSON.stringify(state).includes(ACCESS_TOKEN), false);
});


test("missing configuration is isolated as a safe initialization state", async () => {
  const service = new AuthService({ configured: false });

  const state = await service.initializeAuthService();

  assert.equal(state.status, "error");
  assert.equal(state.error.code, "AUTH_NOT_CONFIGURED");
});


test("backend verification uses API URL and bearer access token only", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  let capturedRequest;
  const service = createService(fake, {
    fetchImpl: async (url, options) => {
      capturedRequest = { url, options };
      return jsonResponse(verifiedUser());
    },
  });

  await service.initializeAuthService();

  assert.equal(capturedRequest.url, `${API_BASE_URL}/auth/me`);
  assert.equal(capturedRequest.options.method, "GET");
  assert.equal(
    capturedRequest.options.headers.Authorization,
    `Bearer ${ACCESS_TOKEN}`,
  );
  assert.equal(capturedRequest.url.includes(ACCESS_TOKEN), false);
  assert.equal(
    JSON.stringify(capturedRequest.options).includes(REFRESH_TOKEN),
    false,
  );
});


test("valid backend response is reduced to verified user fields", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake, {
    fetchImpl: async () =>
      jsonResponse({
        ...verifiedUser(),
        access_token: "must-not-appear",
        app_metadata: { private: true },
      }),
  });

  const state = await service.initializeAuthService();

  assert.deepEqual(state.backendUser, verifiedUser());
  assert.deepEqual(Object.keys(state.backendUser).sort(), [
    "email",
    "id",
    "provider",
  ]);
});


test("malformed backend success response is rejected safely", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake, {
    fetchImpl: async () => jsonResponse({ email: "missing-id@example.com" }),
  });

  const state = await service.initializeAuthService();

  assert.equal(state.status, "error");
  assert.equal(state.backendUser, null);
  assert.equal(state.error.code, "INVALID_BACKEND_AUTH_RESPONSE");
});


test("backend 401 clears verification and preserves safe session summary", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake, {
    fetchImpl: async () =>
      jsonResponse(
        {
          message: "The access token is invalid or expired.",
          code: "INVALID_ACCESS_TOKEN",
        },
        401,
      ),
  });

  const state = await service.initializeAuthService();

  assert.equal(state.status, "error");
  assert.equal(state.backendUser, null);
  assert.equal(state.session.accessTokenAvailable, true);
  assert.equal(state.error.code, "INVALID_ACCESS_TOKEN");
  assert.equal(state.error.status, 401);
});


test("backend 503 preserves internal session and verification error", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake, {
    fetchImpl: async () =>
      jsonResponse(
        {
          message: "Authentication is temporarily unavailable.",
          code: "AUTH_SERVICE_UNAVAILABLE",
        },
        503,
      ),
  });

  const state = await service.initializeAuthService();

  assert.equal(state.status, "error");
  assert.equal(service.getCurrentAccessToken(), ACCESS_TOKEN);
  assert.equal(state.error.code, "AUTH_SERVICE_UNAVAILABLE");
  assert.equal(state.error.status, 503);
});


test("backend network errors use a safe token-free code", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake, {
    fetchImpl: async () => {
      throw new Error(`network failure ${ACCESS_TOKEN}`);
    },
  });

  const state = await service.initializeAuthService();

  assert.equal(state.error.code, "AUTH_BACKEND_UNAVAILABLE");
  assert.equal(state.error.status, 0);
  assert.equal(JSON.stringify(state).includes(ACCESS_TOKEN), false);
});


test("backend error messages cannot echo the access token", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake, {
    fetchImpl: async () =>
      jsonResponse(
        {
          message: `Rejected token ${ACCESS_TOKEN}`,
          code: "INVALID_ACCESS_TOKEN",
        },
        401,
      ),
  });
  await service.initializeAuthService();

  await assert.rejects(service.verifyCurrentUserWithBackend(), (error) => {
    assert.equal(error.code, "INVALID_ACCESS_TOKEN");
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
});


test("INITIAL_SESSION restores and verifies the emitted session", async () => {
  const fake = createFakeSupabase({ initialSession: null });
  const service = createService(fake);
  await service.initializeAuthService();

  fake.emit("INITIAL_SESSION", session());
  await settleAuthEvent();

  assert.equal(service.getCurrentAuthState().status, "signed_in");
});


test("SIGNED_IN triggers backend verification", async () => {
  const fake = createFakeSupabase({ initialSession: null });
  let verifications = 0;
  const service = createService(fake, {
    fetchImpl: async () => {
      verifications += 1;
      return jsonResponse(verifiedUser());
    },
  });
  await service.initializeAuthService();

  fake.emit("SIGNED_IN", session());
  await settleAuthEvent();

  assert.equal(verifications, 1);
  assert.equal(service.getCurrentAuthState().status, "signed_in");
});


test("SIGNED_OUT clears the verified user and session", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake);
  await service.initializeAuthService();

  fake.emit("SIGNED_OUT", null);
  await settleAuthEvent();

  const state = service.getCurrentAuthState();
  assert.equal(state.status, "signed_out");
  assert.equal(state.session, null);
  assert.equal(state.backendUser, null);
});


test("TOKEN_REFRESHED updates the internal access token and reverifies", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const authorizationHeaders = [];
  const service = createService(fake, {
    fetchImpl: async (_, options) => {
      authorizationHeaders.push(options.headers.Authorization);
      return jsonResponse(verifiedUser());
    },
  });
  await service.initializeAuthService();

  const refreshedToken = "refreshed-access-token-private";
  fake.emit("TOKEN_REFRESHED", session({ access_token: refreshedToken }));
  await settleAuthEvent();

  assert.equal(service.getCurrentAccessToken(), refreshedToken);
  assert.deepEqual(authorizationHeaders, [
    `Bearer ${ACCESS_TOKEN}`,
    `Bearer ${refreshedToken}`,
  ]);
  assert.equal(
    JSON.stringify(service.getCurrentAuthState()).includes(refreshedToken),
    false,
  );
});


test("USER_UPDATED refreshes the safe session summary", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake);
  await service.initializeAuthService();

  fake.emit(
    "USER_UPDATED",
    session({
      user: {
        id: USER_ID,
        email: "updated@example.com",
        app_metadata: { provider: "email" },
        user_metadata: { private: true },
      },
    }),
  );
  await settleAuthEvent();

  const summary = service.getCurrentAuthState().session;
  assert.equal(summary.email, "updated@example.com");
  assert.equal(summary.provider, "email");
  assert.equal("user_metadata" in summary, false);
});


test("duplicate initialization creates one auth subscription", async () => {
  const fake = createFakeSupabase({ initialSession: null });
  const service = createService(fake);

  await Promise.all([
    service.initializeAuthService(),
    service.initializeAuthService(),
  ]);
  await service.initializeAuthService();

  assert.equal(fake.calls.getSession, 1);
  assert.equal(fake.calls.subscriptions, 1);
});


test("bootstrap and initial-session event share one backend verification", async () => {
  const restored = session();
  const fake = createFakeSupabase({ initialSession: restored });
  let resolveVerification;
  let backendCalls = 0;
  const service = createService(fake, {
    fetchImpl: () => {
      backendCalls += 1;
      return new Promise((resolve) => {
        resolveVerification = resolve;
      });
    },
  });

  const initialization = service.initializeAuthService();
  await settleAuthEvent();
  fake.emit("INITIAL_SESSION", restored);
  await settleAuthEvent();
  assert.equal(backendCalls, 1);
  resolveVerification(jsonResponse(verifiedUser()));
  await initialization;
  await settleAuthEvent();

  assert.equal(service.getCurrentAuthState().status, "signed_in");
  assert.equal(backendCalls, 1);
});


test("authentication bootstrap timeout keeps the session and publishes a safe recoverable error", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake, {
    requestTimeoutMs: 5,
    fetchImpl: () => new Promise(() => {}),
  });

  const state = await service.initializeAuthService();

  assert.equal(state.status, "error");
  assert.equal(state.error.code, "AUTH_REQUEST_TIMEOUT");
  assert.equal(
    state.error.message,
    "We could not complete the authentication request. Please try again.",
  );
  assert.equal(state.session.userId, USER_ID);
  assert.equal(fake.calls.signOut, 0);
  assert.equal(fake.calls.subscriptions, 1);
});


test("password login timeout is safe and never signs the user out", async () => {
  const fake = createFakeSupabase({ initialSession: null });
  fake.client.auth.signInWithPassword = () => new Promise(() => {});
  const service = createService(fake, { requestTimeoutMs: 5 });

  await assert.rejects(
    service.signInWithPassword({
      email: "person@example.com",
      password: "strong-password",
    }),
    (error) =>
      error.code === "AUTH_REQUEST_TIMEOUT" &&
      error.message === "We could not complete the authentication request. Please try again.",
  );
  assert.equal(fake.calls.signOut, 0);
});


test("application auth listener can unsubscribe", async () => {
  const fake = createFakeSupabase({ initialSession: null });
  const service = createService(fake);
  const states = [];
  const unsubscribe = service.subscribeToAuthChanges((state) => {
    states.push(state.status);
  });
  await service.initializeAuthService();
  unsubscribe();

  fake.emit("SIGNED_IN", session());
  await settleAuthEvent();

  assert.deepEqual(states, ["loading", "signed_out"]);
});


test("destroy removes Supabase subscription and is idempotent", async () => {
  const fake = createFakeSupabase({ initialSession: null });
  const service = createService(fake);
  await service.initializeAuthService();

  service.destroyAuthService();
  service.destroyAuthService();
  fake.emit("SIGNED_IN", session());
  await settleAuthEvent();

  assert.equal(fake.calls.unsubscriptions, 1);
  assert.equal(service.getCurrentAuthState().status, "loading");
});


test("stale backend verification after destroy is ignored", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  let resolveVerification;
  const service = createService(fake, {
    fetchImpl: () =>
      new Promise((resolve) => {
        resolveVerification = resolve;
      }),
  });

  const initialization = service.initializeAuthService();
  await settleAuthEvent();
  service.destroyAuthService();
  resolveVerification(jsonResponse(verifiedUser()));
  await initialization;

  assert.equal(service.getCurrentAuthState().backendUser, null);
  assert.equal(service.getCurrentAuthState().status, "loading");
});


test("older session verification cannot overwrite a newer session", async () => {
  const fake = createFakeSupabase({ initialSession: null });
  const pending = new Map();
  const service = createService(fake, {
    fetchImpl: (_, options) =>
      new Promise((resolve) => {
        pending.set(options.headers.Authorization, resolve);
      }),
  });
  await service.initializeAuthService();

  fake.emit("SIGNED_IN", session());
  await settleAuthEvent();
  const secondToken = "newer-access-token-private";
  fake.emit(
    "TOKEN_REFRESHED",
    session({
      access_token: secondToken,
      user: {
        id: SECOND_USER_ID,
        email: "newer@example.com",
        app_metadata: { provider: "google" },
      },
    }),
  );
  await settleAuthEvent();

  pending.get(`Bearer ${secondToken}`)(
    jsonResponse(
      verifiedUser({ id: SECOND_USER_ID, email: "newer@example.com" }),
    ),
  );
  await settleAuthEvent();
  pending.get(`Bearer ${ACCESS_TOKEN}`)(jsonResponse(verifiedUser()));
  await settleAuthEvent();

  assert.equal(service.getCurrentAuthState().backendUser.id, SECOND_USER_ID);
});


test("successful sign-out clears safe state without touching other storage", async () => {
  const fake = createFakeSupabase({ initialSession: session() });
  const service = createService(fake);
  await service.initializeAuthService();

  const result = await service.signOut();

  assert.deepEqual(result, { ok: true });
  assert.equal(fake.calls.signOut, 1);
  assert.equal(service.getCurrentAuthState().status, "signed_out");
  assert.equal(service.getCurrentAccessToken(), null);
});


test("sign-out failure is converted to a safe error", async () => {
  const fake = createFakeSupabase({
    signOutError: new Error(`raw ${REFRESH_TOKEN}`),
  });
  const service = createService(fake);

  await assert.rejects(service.signOut(), (error) => {
    assert.equal(error.code, "SIGN_OUT_FAILED");
    assert.equal(error.message.includes(REFRESH_TOKEN), false);
    return true;
  });
});
