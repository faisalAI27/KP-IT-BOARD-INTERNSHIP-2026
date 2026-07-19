import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ProfileApi,
  ProfileApiError,
  validateProfileConsentResponse,
  validateProfileStatisticsResponse,
} from "../../scripts/services/profile-api.js";


const ACCESS_TOKEN = "private-profile-access-token";
const PROFILE = Object.freeze({
  id: "0d5dd8f5-93df-462b-b234-a16973089092",
  email: "person@example.com",
  authProvider: "google",
  displayName: "Person",
  preferredLanguage: "Pashto",
  leaderboardOptIn: false,
  createdAt: "2026-07-15T12:00:00Z",
  updatedAt: "2026-07-15T12:00:00Z",
  lastLoginAt: "2026-07-15T12:00:00Z",
});
const STATISTICS = Object.freeze({
  totalContributions: 4,
  pendingContributions: 2,
  approvedContributions: 1,
  rejectedContributions: 1,
  leaderboardOptIn: true,
  leaderboardEligible: true,
  publicRank: 3,
});
const CONSENT_SUMMARY = Object.freeze({
  currentPolicyVersion: "1.0",
  mostRecentConsentAt: "2026-07-18T08:30:00Z",
});


function response({ ok = true, status = 200, body = PROFILE } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}


function fixture({ getAccessToken = () => ACCESS_TOKEN, fetchImpl } = {}) {
  const calls = [];
  const resolvedFetch =
    fetchImpl ??
    (async (url, options) => {
      calls.push({ url, options });
      return response();
    });
  return {
    api: new ProfileApi({
      apiBaseUrl: "http://127.0.0.1:8000/api/",
      fetchImpl: resolvedFetch,
      getAccessToken,
    }),
    calls,
  };
}


test("GET uses the current-user profile endpoint and bearer token", async () => {
  const { api, calls } = fixture();

  await api.getMyProfile();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8000/api/profile/me");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(calls[0].url.includes(ACCESS_TOKEN), false);
  assert.equal("body" in calls[0].options, false);
});


test("PATCH uses the profile endpoint, bearer token, and JSON body", async () => {
  const { api, calls } = fixture();

  await api.updateMyProfile({ displayName: "Faisal Imran" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8000/api/profile/me");
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    displayName: "Faisal Imran",
  });
});


test("contribution statistics GET uses the authenticated current-user endpoint", async () => {
  const { api, calls } = fixture({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ body: STATISTICS });
    },
  });

  const result = await api.getMyContributionStatistics();

  assert.deepEqual(result, STATISTICS);
  assert.equal(
    calls[0].url,
    "http://127.0.0.1:8000/api/profile/me/statistics",
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(calls[0].url.includes(ACCESS_TOKEN), false);
});


test("consent summary GET uses the private current-user endpoint", async () => {
  const { api, calls } = fixture({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ body: CONSENT_SUMMARY });
    },
  });

  const result = await api.getMyConsentSummary();

  assert.deepEqual(result, CONSENT_SUMMARY);
  assert.equal(calls[0].url, "http://127.0.0.1:8000/api/profile/me/consent");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(calls[0].url.includes(ACCESS_TOKEN), false);
});


test("consent summary accepts null legacy date and rejects unsafe fields", () => {
  assert.deepEqual(
    validateProfileConsentResponse({
      currentPolicyVersion: "1.0",
      mostRecentConsentAt: null,
      userId: "private-user",
      consentGiven: true,
    }),
    { currentPolicyVersion: "1.0", mostRecentConsentAt: null },
  );
  for (const invalid of [
    null,
    {},
    { ...CONSENT_SUMMARY, currentPolicyVersion: "" },
    { ...CONSENT_SUMMARY, mostRecentConsentAt: "not-a-date" },
    { ...CONSENT_SUMMARY, mostRecentConsentAt: 42 },
  ]) {
    assert.throws(
      () => validateProfileConsentResponse(invalid),
      (error) => error.code === "PROFILE_CONSENT_RESPONSE_INVALID",
    );
  }
});


test("statistics validation requires exact nonnegative review counts", () => {
  for (const invalid of [
    { ...STATISTICS, pendingContributions: -1 },
    { ...STATISTICS, approvedContributions: 2 },
    { ...STATISTICS, rejectedContributions: "1" },
    { ...STATISTICS, leaderboardOptIn: "true" },
    { ...STATISTICS, publicRank: 0 },
  ]) {
    assert.throws(
      () => validateProfileStatisticsResponse(invalid),
      (error) => error.code === "PROFILE_STATISTICS_RESPONSE_INVALID",
    );
  }
});


test("refresh tokens are never sent", async () => {
  const { api, calls } = fixture();

  await api.getMyProfile();

  const request = JSON.stringify(calls[0]);
  assert.equal(request.includes("refresh"), false);
  assert.equal(request.includes("provider_token"), false);
});


test("GET returns only a validated safe profile", async () => {
  const rawProfile = {
    ...PROFILE,
    access_token: "do-not-return",
    app_metadata: { secret: "do-not-return" },
  };
  const { api } = fixture({
    fetchImpl: async () => response({ body: rawProfile }),
  });

  const profile = await api.getMyProfile();

  assert.deepEqual(profile, {
    id: PROFILE.id,
    email: PROFILE.email,
    authProvider: PROFILE.authProvider,
    displayName: PROFILE.displayName,
    preferredLanguage: PROFILE.preferredLanguage,
    leaderboardOptIn: false,
    createdAt: PROFILE.createdAt,
  });
  assert.equal(JSON.stringify(profile).includes("do-not-return"), false);
  assert.equal(profile.createdAt, PROFILE.createdAt);
});


test("PATCH validates and returns the backend profile", async () => {
  const updated = {
    ...PROFILE,
    displayName: "Faisal Imran",
    preferredLanguage: "Urdu",
    leaderboardOptIn: true,
  };
  const { api } = fixture({
    fetchImpl: async () => response({ body: updated }),
  });

  const profile = await api.updateMyProfile({ leaderboardOptIn: true });

  assert.equal(profile.displayName, "Faisal Imran");
  assert.equal(profile.preferredLanguage, "Urdu");
  assert.equal(profile.leaderboardOptIn, true);
});


test("nullable verified identity fields are handled safely", async () => {
  const { api } = fixture({
    fetchImpl: async () =>
      response({ body: { ...PROFILE, email: null, authProvider: null } }),
  });

  const profile = await api.getMyProfile();

  assert.equal(profile.email, null);
  assert.equal(profile.authProvider, null);
});


test("malformed profile responses are rejected", async (context) => {
  const invalidProfiles = [
    null,
    [],
    {},
    { ...PROFILE, id: "" },
    { ...PROFILE, displayName: "A" },
    { ...PROFILE, preferredLanguage: "" },
    { ...PROFILE, leaderboardOptIn: "false" },
    { ...PROFILE, email: 42 },
    { ...PROFILE, authProvider: {} },
    { ...PROFILE, createdAt: "not-a-date" },
  ];

  for (const invalidProfile of invalidProfiles) {
    await context.test(JSON.stringify(invalidProfile), async () => {
      const { api } = fixture({
        fetchImpl: async () => response({ body: invalidProfile }),
      });
      await assert.rejects(api.getMyProfile(), (error) => {
        assert.equal(error.code, "PROFILE_RESPONSE_INVALID");
        assert.equal(error.status, 200);
        return true;
      });
    });
  }
});


test("missing session is rejected before fetch", async () => {
  let fetchCalls = 0;
  const { api } = fixture({
    getAccessToken: () => null,
    fetchImpl: async () => {
      fetchCalls += 1;
      return response();
    },
  });

  await assert.rejects(api.getMyProfile(), (error) => {
    assert.equal(error.code, "AUTHENTICATION_REQUIRED");
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(fetchCalls, 0);
});


test("blank access token is rejected safely", async () => {
  const { api } = fixture({ getAccessToken: () => "   " });

  await assert.rejects(api.getMyProfile(), {
    code: "AUTHENTICATION_REQUIRED",
    status: 401,
  });
});


test("empty updates are rejected before fetch", async (context) => {
  for (const updates of [{}, { displayName: undefined }, null]) {
    await context.test(String(updates), async () => {
      let fetchCalls = 0;
      const { api } = fixture({
        fetchImpl: async () => {
          fetchCalls += 1;
          return response();
        },
      });
      await assert.rejects(api.updateMyProfile(updates), {
        code: "EMPTY_PROFILE_UPDATE",
      });
      assert.equal(fetchCalls, 0);
    });
  }
});


test("undefined fields are omitted from PATCH", async () => {
  const { api, calls } = fixture();

  await api.updateMyProfile({
    displayName: "  Faisal Imran  ",
    preferredLanguage: undefined,
    leaderboardOptIn: undefined,
  });

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    displayName: "Faisal Imran",
  });
});


test("identity and timestamp fields cannot be sent", async (context) => {
  const forbiddenFields = [
    "id",
    "userId",
    "email",
    "authProvider",
    "createdAt",
    "updatedAt",
    "lastLoginAt",
    "accessToken",
  ];

  for (const fieldName of forbiddenFields) {
    await context.test(fieldName, async () => {
      const { api } = fixture();
      await assert.rejects(api.updateMyProfile({ [fieldName]: "value" }), {
        code: "INVALID_PROFILE_UPDATE",
      });
    });
  }
});


test("backend error message, code, and status are preserved", async () => {
  const { api } = fixture({
    fetchImpl: async () =>
      response({
        ok: false,
        status: 400,
        body: {
          message: "Display name must contain between 2 and 80 characters.",
          code: "INVALID_DISPLAY_NAME",
        },
      }),
  });

  await assert.rejects(api.updateMyProfile({ displayName: "Valid Name" }), (error) => {
    assert.equal(
      error.message,
      "Display name must contain between 2 and 80 characters.",
    );
    assert.equal(error.code, "INVALID_DISPLAY_NAME");
    assert.equal(error.status, 400);
    return true;
  });
});


test("malformed backend errors use a safe fallback", async () => {
  const { api } = fixture({
    fetchImpl: async () => response({ ok: false, status: 500, body: null }),
  });

  await assert.rejects(api.getMyProfile(), (error) => {
    assert.equal(error.message, "The profile request could not be completed.");
    assert.equal(error.code, "PROFILE_REQUEST_FAILED");
    assert.equal(error.status, 500);
    return true;
  });
});


test("network failures use a token-free safe fallback", async () => {
  const { api } = fixture({
    fetchImpl: async () => {
      throw new Error(`network failed for ${ACCESS_TOKEN}`);
    },
  });

  await assert.rejects(api.getMyProfile(), (error) => {
    assert.equal(error.code, "NETWORK_ERROR");
    assert.equal(error.status, 0);
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
});


test("backend messages cannot echo the access token", async () => {
  const { api } = fixture({
    fetchImpl: async () =>
      response({
        ok: false,
        status: 500,
        body: {
          message: `failure ${ACCESS_TOKEN}`,
          code: "PROFILE_PERSISTENCE_FAILED",
        },
      }),
  });

  await assert.rejects(api.getMyProfile(), (error) => {
    assert.equal(error instanceof ProfileApiError, true);
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    assert.equal(JSON.stringify(error).includes(ACCESS_TOKEN), false);
    return true;
  });
});


test("backend error codes cannot echo the access token", async () => {
  const { api } = fixture({
    fetchImpl: async () =>
      response({
        ok: false,
        status: 500,
        body: {
          message: "The profile request failed.",
          code: `BAD_${ACCESS_TOKEN}`,
        },
      }),
  });

  await assert.rejects(api.getMyProfile(), (error) => {
    assert.equal(error.code, "PROFILE_REQUEST_FAILED");
    assert.equal(JSON.stringify(error).includes(ACCESS_TOKEN), false);
    return true;
  });
});
