import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WithdrawalApiError,
  WithdrawalsApi,
  validateOwnerWithdrawal,
  validateOwnerWithdrawalPage,
} from "../../scripts/services/withdrawals-api.js";


const API_BASE_URL = "http://127.0.0.1:8000/api";
const ACCESS_TOKEN = "private-withdrawal-access-token";
const CONTRIBUTION_ID = "11111111-1111-4111-8111-111111111111";
const ITEM = Object.freeze({
  scope: "contribution",
  status: "requested",
  contributionId: CONTRIBUTION_ID,
  reason: "Please exclude this recording.",
  requestedAt: "2026-07-19T08:00:00Z",
  resolvedAt: null,
});


function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}


function createApi(handler = () => response(ITEM, 201)) {
  const calls = [];
  const api = new WithdrawalsApi({
    apiBaseUrl: API_BASE_URL,
    getAccessToken: () => ACCESS_TOKEN,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return handler(url, options);
    },
  });
  return { api, calls };
}


test("owner list sends the bearer token only in the authorization header", async () => {
  const { api, calls } = createApi(() =>
    response({ items: [ITEM], total: 1, limit: 20, offset: 0 }),
  );
  await api.listMyRequests();

  assert.equal(calls[0].url, `${API_BASE_URL}/withdrawals/me`);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(calls[0].url.includes(ACCESS_TOKEN), false);
  assert.equal(calls[0].options.body, undefined);
});


test("one-recording request sends only scope, target, and optional reason", async () => {
  const { api, calls } = createApi();
  await api.createMyRequest({
    scope: "contribution",
    contributionId: CONTRIBUTION_ID,
    reason: "  Please exclude this recording.  ",
    userId: "another-user-must-not-be-sent",
  });

  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    scope: "contribution",
    contributionId: CONTRIBUTION_ID,
    reason: "Please exclude this recording.",
  });
});


test("all-recordings request cannot send a contribution or user ID", async () => {
  const allItem = {
    ...ITEM,
    scope: "all",
    contributionId: null,
    reason: null,
  };
  const { api, calls } = createApi(() => response(allItem, 201));
  await api.createMyRequest({
    scope: "all",
    contributionId: CONTRIBUTION_ID,
    userId: "another-user",
  });

  assert.deepEqual(JSON.parse(calls[0].options.body), { scope: "all" });
});


test("owner response is reduced to private documented status fields", () => {
  const validated = validateOwnerWithdrawal({
    ...ITEM,
    id: "internal-request-id",
    userId: "private-user-id",
    resolutionReason: "private administrator note",
  });

  assert.deepEqual(validated, ITEM);
  assert.equal(JSON.stringify(validated).includes("internal-request-id"), false);
  assert.equal(JSON.stringify(validated).includes("administrator note"), false);
});


test("malformed owner status responses are rejected", () => {
  for (const item of [
    { ...ITEM, status: "deleted" },
    { ...ITEM, scope: "all" },
    { ...ITEM, requestedAt: "invalid" },
  ]) {
    assert.throws(
      () => validateOwnerWithdrawal(item),
      (error) => error.code === "INVALID_WITHDRAWAL_RESPONSE",
    );
  }
  assert.throws(
    () => validateOwnerWithdrawalPage({ items: [ITEM], total: 0, limit: 20, offset: 0 }),
    (error) => error.code === "INVALID_WITHDRAWAL_RESPONSE",
  );
});


test("a missing access token blocks requests before fetch", async () => {
  let fetchCalls = 0;
  const api = new WithdrawalsApi({
    apiBaseUrl: API_BASE_URL,
    getAccessToken: () => null,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    },
  });

  await assert.rejects(api.listMyRequests(), (error) => {
    assert.ok(error instanceof WithdrawalApiError);
    assert.equal(error.code, "AUTHENTICATION_REQUIRED");
    return true;
  });
  assert.equal(fetchCalls, 0);
});


test("backend errors cannot echo the bearer token", async () => {
  const { api } = createApi(() =>
    response(
      { message: `Rejected ${ACCESS_TOKEN}`, code: `BAD_${ACCESS_TOKEN}` },
      500,
    ),
  );

  await assert.rejects(api.listMyRequests(), (error) => {
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    assert.equal(error.code.includes(ACCESS_TOKEN), false);
    return true;
  });
});
