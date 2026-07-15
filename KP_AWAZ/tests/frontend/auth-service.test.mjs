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
  signOutError = null,
} = {}) {
  const calls = {
    getSession: 0,
    google: [],
    email: [],
    signOut: 0,
    subscriptions: 0,
    unsubscriptions: 0,
  };
  let authCallback = null;

  const client = {
    auth: {
      async getSession() {
        calls.getSession += 1;
        if (sessionError instanceof Error) throw sessionError;
        return {
          data: { session: initialSession },
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
      async signOut() {
        calls.signOut += 1;
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


test("valid trimmed email starts a magic-link request", async () => {
  const fake = createFakeSupabase();
  const service = createService(fake);

  const result = await service.signInWithEmail("  person@example.com  ");

  assert.deepEqual(fake.calls.email, [
    {
      email: "person@example.com",
      options: {
        emailRedirectTo: REDIRECT_URL,
        shouldCreateUser: true,
      },
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    message: "Check your email for the sign-in link.",
  });
  assert.equal(JSON.stringify(result).includes("existing"), false);
});


test("blank and clearly malformed email addresses are rejected", async (context) => {
  for (const email of ["", "   ", "missing-at.example.com", "person@example"]) {
    await context.test(email || "blank", async () => {
      const service = createService(createFakeSupabase());
      await assert.rejects(service.signInWithEmail(email), (error) => {
        assert.equal(error.code, "INVALID_EMAIL");
        return true;
      });
    });
  }
});


test("Supabase email error becomes a safe frontend error", async () => {
  const fake = createFakeSupabase({
    emailError: new Error(`raw ${ACCESS_TOKEN}`),
  });
  const service = createService(fake);

  await assert.rejects(service.signInWithEmail("person@example.com"), (error) => {
    assert.equal(error.code, "EMAIL_SIGN_IN_FAILED");
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
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
