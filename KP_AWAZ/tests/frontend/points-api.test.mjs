import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PointsApi,
  PointsApiError,
  validatePointsResponse,
} from "../../scripts/services/points-api.js";


const ACCESS_TOKEN = "private-points-access-token";
const REFRESH_TOKEN = "private-refresh-token";
const USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092";
const PROFILE_ID = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31";
const ITEM = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  entryType: "approvalAward",
  pointsDelta: 1,
  contributionId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-07-16T10:20:00Z",
});
const POINTS = Object.freeze({
  balance: 1,
  items: [ITEM],
  total: 1,
  limit: 20,
  offset: 0,
});


function response({ ok = true, status = 200, body = POINTS } = {}) {
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
    api: new PointsApi({
      apiBaseUrl: "http://127.0.0.1:8000/api/",
      fetchImpl: resolvedFetch,
      getAccessToken,
    }),
    calls,
  };
}


test("points request uses GET", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints();
  assert.equal(calls[0].options.method, "GET");
});


test("points request uses the private current-user endpoint", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints();
  assert.equal(
    new URL(calls[0].url).pathname,
    "/api/profile/me/points",
  );
});


test("default limit is twenty", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints();
  assert.equal(new URL(calls[0].url).searchParams.get("limit"), "20");
});


test("default offset is zero", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints();
  assert.equal(new URL(calls[0].url).searchParams.get("offset"), "0");
});


test("custom limit is sent", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints({ limit: 7 });
  assert.equal(new URL(calls[0].url).searchParams.get("limit"), "7");
});


test("custom offset is sent", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints({ offset: 40 });
  assert.equal(new URL(calls[0].url).searchParams.get("offset"), "40");
});


test("bearer access token is sent in the Authorization header", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints();
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
});


test("access token is not placed in the URL", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints();
  assert.equal(calls[0].url.includes(ACCESS_TOKEN), false);
});


test("refresh token is not sent", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints({ refreshToken: REFRESH_TOKEN });
  assert.equal(JSON.stringify(calls[0]).includes(REFRESH_TOKEN), false);
});


test("user ID is not sent", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints({ userId: USER_ID });
  assert.equal(JSON.stringify(calls[0]).includes(USER_ID), false);
});


test("profile ID is not sent", async () => {
  const { api, calls } = fixture();
  await api.getMyPoints({ profileId: PROFILE_ID });
  assert.equal(JSON.stringify(calls[0]).includes(PROFILE_ID), false);
});


test("valid zero-balance response is accepted", () => {
  const result = validatePointsResponse({
    balance: 0,
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  });
  assert.deepEqual(result, {
    balance: 0,
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  });
});


test("valid positive balance is accepted", () => {
  assert.equal(validatePointsResponse(POINTS).balance, 1);
});


test("valid approvalAward item is accepted safely", () => {
  const raw = { ...ITEM, internal: "remove-me" };
  const result = validatePointsResponse({ ...POINTS, items: [raw] });
  assert.deepEqual(result.items[0], ITEM);
  assert.equal("internal" in result.items[0], false);
});


test("valid approvalReversal item is accepted", () => {
  const result = validatePointsResponse({
    ...POINTS,
    balance: 0,
    items: [{ ...ITEM, entryType: "approvalReversal", pointsDelta: -1 }],
  });
  assert.equal(result.items[0].entryType, "approvalReversal");
  assert.equal(result.items[0].pointsDelta, -1);
});


test("valid approvedBackfill item is accepted", () => {
  const result = validatePointsResponse({
    ...POINTS,
    items: [{ ...ITEM, entryType: "approvedBackfill" }],
  });
  assert.equal(result.items[0].entryType, "approvedBackfill");
});


test("malformed balance is rejected", () => {
  assert.throws(
    () => validatePointsResponse({ ...POINTS, balance: "1" }),
    { code: "POINTS_RESPONSE_INVALID" },
  );
});


test("malformed total is rejected", () => {
  assert.throws(
    () => validatePointsResponse({ ...POINTS, total: -1 }),
    { code: "POINTS_RESPONSE_INVALID" },
  );
});


test("malformed ledger item is rejected", () => {
  assert.throws(
    () => validatePointsResponse({ ...POINTS, items: [{ ...ITEM, id: " " }] }),
    { code: "POINTS_RESPONSE_INVALID" },
  );
});


test("unknown entry type is rejected", () => {
  assert.throws(
    () =>
      validatePointsResponse({
        ...POINTS,
        items: [{ ...ITEM, entryType: "manualAdjustment" }],
      }),
    { code: "POINTS_RESPONSE_INVALID" },
  );
});


test("invalid points delta is rejected", () => {
  assert.throws(
    () =>
      validatePointsResponse({
        ...POINTS,
        items: [{ ...ITEM, pointsDelta: 1.5 }],
      }),
    { code: "POINTS_RESPONSE_INVALID" },
  );
});


test("invalid limit is rejected before fetch", async () => {
  const { api, calls } = fixture();
  await assert.rejects(api.getMyPoints({ limit: 101 }), {
    code: "INVALID_LIMIT",
  });
  assert.equal(calls.length, 0);
});


test("invalid offset is rejected before fetch", async () => {
  const { api, calls } = fixture();
  await assert.rejects(api.getMyPoints({ offset: -1 }), {
    code: "INVALID_OFFSET",
  });
  assert.equal(calls.length, 0);
});


test("missing session fails before fetch", async () => {
  const { api, calls } = fixture({ getAccessToken: () => null });
  await assert.rejects(api.getMyPoints(), {
    code: "AUTHENTICATION_REQUIRED",
    status: 401,
  });
  assert.equal(calls.length, 0);
});


test("missing access token fails before fetch", async () => {
  const { api, calls } = fixture({ getAccessToken: () => "   " });
  await assert.rejects(api.getMyPoints(), {
    code: "AUTHENTICATION_REQUIRED",
    status: 401,
  });
  assert.equal(calls.length, 0);
});


test("backend error message is preserved", async () => {
  const api = new PointsApi({
    apiBaseUrl: "http://127.0.0.1:8000/api",
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async () =>
      response({
        ok: false,
        status: 500,
        body: { message: "Contribution points could not be loaded.", code: "X" },
      }),
  });
  await assert.rejects(api.getMyPoints(), (error) => {
    assert.equal(error.message, "Contribution points could not be loaded.");
    return true;
  });
});


test("backend error code is preserved", async () => {
  const api = new PointsApi({
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async () =>
      response({
        ok: false,
        status: 500,
        body: { message: "Safe error", code: "POINTS_QUERY_FAILED" },
      }),
  });
  await assert.rejects(api.getMyPoints(), {
    code: "POINTS_QUERY_FAILED",
  });
});


test("backend error status is preserved", async () => {
  const api = new PointsApi({
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async () =>
      response({
        ok: false,
        status: 401,
        body: { message: "Authentication is required.", code: "INVALID_ACCESS_TOKEN" },
      }),
  });
  await assert.rejects(api.getMyPoints(), { status: 401 });
});


test("network failures use a safe error", async () => {
  const api = new PointsApi({
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async () => {
      throw new Error(`failed with ${ACCESS_TOKEN}`);
    },
  });
  await assert.rejects(api.getMyPoints(), (error) => {
    assert.equal(error instanceof PointsApiError, true);
    assert.equal(error.code, "NETWORK_ERROR");
    assert.equal(error.status, 0);
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
});


test("token values do not appear in thrown errors", async () => {
  const api = new PointsApi({
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async () =>
      response({
        ok: false,
        status: 500,
        body: {
          message: `server echoed ${ACCESS_TOKEN}`,
          code: `BAD_${ACCESS_TOKEN}`,
        },
      }),
  });
  await assert.rejects(api.getMyPoints(), (error) => {
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    assert.equal(error.code.includes(ACCESS_TOKEN), false);
    assert.equal(JSON.stringify(error).includes(ACCESS_TOKEN), false);
    return true;
  });
});
