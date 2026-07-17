import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LeaderboardApi,
  LeaderboardApiError,
  validateLeaderboardResponse,
  validatePersonalLeaderboardContext,
} from "../../scripts/services/leaderboard-api.js";


const ACCESS_TOKEN = "private-access-token-value";
const ADMIN_KEY = "private-admin-secret-value";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const ITEM = Object.freeze({
  rank: 1,
  displayName: "Faisal Imran",
  approvedContributions: 3,
});
const LEADERBOARD = Object.freeze({
  items: [ITEM],
  total: 1,
  limit: 20,
  offset: 0,
});
const PERSONAL_CONTEXT = Object.freeze({
  leaderboardOptIn: true,
  leaderboardEligible: true,
  currentUser: ITEM,
  items: [{ ...ITEM, isCurrentUser: true }],
  total: 1,
  limit: 20,
  offset: 0,
});


function response({ ok = true, status = 200, body = LEADERBOARD } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}


function fixture({ fetchImpl } = {}) {
  const calls = [];
  const resolvedFetch =
    fetchImpl ??
    (async (url, options) => {
      calls.push({ url, options });
      return response();
    });
  return {
    api: new LeaderboardApi({
      apiBaseUrl: "http://127.0.0.1:8000/api/",
      fetchImpl: resolvedFetch,
    }),
    calls,
  };
}


test("public leaderboard request uses GET", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard();
  assert.equal(calls[0].options.method, "GET");
});


test("personal context uses the authenticated containing-page route", async () => {
  const calls = [];
  const api = new LeaderboardApi({
    apiBaseUrl: "http://127.0.0.1:8000/api",
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ body: PERSONAL_CONTEXT });
    },
  });

  await api.getPersonalLeaderboardContext();

  assert.equal(new URL(calls[0].url).pathname, "/api/leaderboard/me/context");
  assert.equal(new URL(calls[0].url).searchParams.get("limit"), "20");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(calls[0].options.method, "GET");
});


test("personal context never sends a user or profile identity", async () => {
  const calls = [];
  const api = new LeaderboardApi({
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ body: PERSONAL_CONTEXT });
    },
  });

  await api.getPersonalLeaderboardContext({
    userId: USER_ID,
    profileId: PROFILE_ID,
  });

  assert.equal(JSON.stringify(calls).includes(USER_ID), false);
  assert.equal(JSON.stringify(calls).includes(PROFILE_ID), false);
  assert.equal(calls[0].url.includes(ACCESS_TOKEN), false);
});


test("personal context requires an access token before fetch", async () => {
  let fetches = 0;
  const api = new LeaderboardApi({
    getAccessToken: () => null,
    fetchImpl: async () => {
      fetches += 1;
      return response({ body: PERSONAL_CONTEXT });
    },
  });

  await assert.rejects(api.getPersonalLeaderboardContext(), {
    code: "AUTHENTICATION_REQUIRED",
    status: 401,
  });
  assert.equal(fetches, 0);
});


test("personal context backend errors cannot expose token values", async () => {
  const api = new LeaderboardApi({
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async () =>
      response({
        ok: false,
        status: 500,
        body: {
          code: "LEADERBOARD_CONTEXT_QUERY_FAILED",
          message: `query failed with access token ${ACCESS_TOKEN}`,
        },
      }),
  });

  await assert.rejects(api.getPersonalLeaderboardContext(), (error) => {
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    assert.equal(error.code, "LEADERBOARD_CONTEXT_QUERY_FAILED");
    return true;
  });
});


test("eligible personal context requires exactly one current-user marker", () => {
  assert.throws(
    () =>
      validatePersonalLeaderboardContext({
        ...PERSONAL_CONTEXT,
        items: [{ ...ITEM, isCurrentUser: false }],
      }),
    { code: "LEADERBOARD_RESPONSE_INVALID" },
  );
});


test("malformed personal context items fail with the safe response error", () => {
  assert.throws(
    () => validatePersonalLeaderboardContext({ ...PERSONAL_CONTEXT, items: null }),
    { code: "LEADERBOARD_RESPONSE_INVALID" },
  );
});


test("ineligible personal context preserves private approved count safely", () => {
  const result = validatePersonalLeaderboardContext({
    leaderboardOptIn: false,
    leaderboardEligible: false,
    currentUser: {
      rank: null,
      displayName: "Private Contributor",
      approvedContributions: 7,
      email: "secret@example.com",
    },
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  });

  assert.equal(result.currentUser.approvedContributions, 7);
  assert.equal(JSON.stringify(result).includes("secret@example.com"), false);
});


test("public leaderboard request uses the correct route", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard();
  assert.equal(new URL(calls[0].url).pathname, "/api/leaderboard");
});


test("public leaderboard default limit is twenty", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard();
  assert.equal(new URL(calls[0].url).searchParams.get("limit"), "20");
});


test("public leaderboard default offset is zero", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard();
  assert.equal(new URL(calls[0].url).searchParams.get("offset"), "0");
});


test("custom public leaderboard limit works", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard({ limit: 7 });
  assert.equal(new URL(calls[0].url).searchParams.get("limit"), "7");
});


test("custom public leaderboard offset works", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard({ offset: 40 });
  assert.equal(new URL(calls[0].url).searchParams.get("offset"), "40");
});


test("Authorization header is never sent", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard({ accessToken: ACCESS_TOKEN });
  assert.equal("Authorization" in calls[0].options.headers, false);
  assert.equal(calls[0].options.credentials, "omit");
});


test("X-Admin-Key header is never sent", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard({ adminKey: ADMIN_KEY });
  assert.equal("X-Admin-Key" in calls[0].options.headers, false);
  assert.equal(JSON.stringify(calls[0]).includes(ADMIN_KEY), false);
});


test("access token is not placed in the public URL", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard({ accessToken: ACCESS_TOKEN });
  assert.equal(calls[0].url.includes(ACCESS_TOKEN), false);
});


test("user ID is not sent", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard({ userId: USER_ID });
  assert.equal(JSON.stringify(calls[0]).includes(USER_ID), false);
});


test("profile ID is not sent", async () => {
  const { api, calls } = fixture();
  await api.getPublicLeaderboard({ profileId: PROFILE_ID });
  assert.equal(JSON.stringify(calls[0]).includes(PROFILE_ID), false);
});


test("valid leaderboard response is accepted with only public fields", () => {
  const result = validateLeaderboardResponse({
    ...LEADERBOARD,
    items: [{ ...ITEM, profileId: PROFILE_ID, points: 3 }],
  });
  assert.deepEqual(result, LEADERBOARD);
  assert.deepEqual(Object.keys(result.items[0]).sort(), [
    "approvedContributions",
    "displayName",
    "rank",
  ]);
});


test("tied backend ranks are accepted", () => {
  const result = validateLeaderboardResponse({
    items: [ITEM, { ...ITEM, displayName: "Another Contributor" }],
    total: 2,
    limit: 20,
    offset: 0,
  });
  assert.deepEqual(result.items.map((item) => item.rank), [1, 1]);
});


test("duplicate display names remain separate", () => {
  const result = validateLeaderboardResponse({
    items: [ITEM, { ...ITEM }],
    total: 2,
    limit: 20,
    offset: 0,
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].displayName, result.items[1].displayName);
});


test("malformed rank is rejected", () => {
  assert.throws(
    () =>
      validateLeaderboardResponse({
        ...LEADERBOARD,
        items: [{ ...ITEM, rank: 0 }],
      }),
    { code: "LEADERBOARD_RESPONSE_INVALID" },
  );
});


test("blank display name is rejected", () => {
  assert.throws(
    () =>
      validateLeaderboardResponse({
        ...LEADERBOARD,
        items: [{ ...ITEM, displayName: "   " }],
      }),
    { code: "LEADERBOARD_RESPONSE_INVALID" },
  );
});


test("invalid approved contribution count is rejected", () => {
  assert.throws(
    () =>
      validateLeaderboardResponse({
        ...LEADERBOARD,
        items: [{ ...ITEM, approvedContributions: 0 }],
      }),
    { code: "LEADERBOARD_RESPONSE_INVALID" },
  );
});


test("invalid total is rejected", () => {
  assert.throws(
    () => validateLeaderboardResponse({ ...LEADERBOARD, total: -1 }),
    { code: "LEADERBOARD_RESPONSE_INVALID" },
  );
});


test("invalid limit is rejected before fetch", async () => {
  const { api, calls } = fixture();
  await assert.rejects(api.getPublicLeaderboard({ limit: 101 }), {
    code: "INVALID_LIMIT",
  });
  assert.equal(calls.length, 0);
});


test("invalid offset is rejected before fetch", async () => {
  const { api, calls } = fixture();
  await assert.rejects(api.getPublicLeaderboard({ offset: -1 }), {
    code: "INVALID_OFFSET",
  });
  assert.equal(calls.length, 0);
});


test("safe backend leaderboard errors are preserved", async () => {
  const api = new LeaderboardApi({
    fetchImpl: async () =>
      response({
        ok: false,
        status: 500,
        body: {
          message: "The public leaderboard could not be loaded.",
          code: "LEADERBOARD_QUERY_FAILED",
        },
      }),
  });
  await assert.rejects(api.getPublicLeaderboard(), (error) => {
    assert.equal(error.message, "The public leaderboard could not be loaded.");
    assert.equal(error.code, "LEADERBOARD_QUERY_FAILED");
    assert.equal(error.status, 500);
    return true;
  });
});


test("network failures use a safe leaderboard error", async () => {
  const api = new LeaderboardApi({
    fetchImpl: async () => {
      throw new Error(`network failed with ${ACCESS_TOKEN}`);
    },
  });
  await assert.rejects(api.getPublicLeaderboard(), (error) => {
    assert.equal(error instanceof LeaderboardApiError, true);
    assert.equal(error.code, "NETWORK_ERROR");
    assert.equal(error.status, 0);
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
});


test("tokens and secret values do not appear in leaderboard errors", async () => {
  const api = new LeaderboardApi({
    fetchImpl: async () =>
      response({
        ok: false,
        status: 500,
        body: {
          message: `server exposed access token ${ACCESS_TOKEN} and secret ${ADMIN_KEY}`,
          code: "LEADERBOARD_QUERY_FAILED",
        },
      }),
  });
  await assert.rejects(api.getPublicLeaderboard(), (error) => {
    const serialized = `${error.message} ${error.code} ${JSON.stringify(error)}`;
    assert.equal(serialized.includes(ACCESS_TOKEN), false);
    assert.equal(serialized.includes(ADMIN_KEY), false);
    return true;
  });
});
