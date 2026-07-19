import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  AdminReviewApi,
  AdminReviewApiError,
  validateAdminContribution,
  validateAdminContributionPage,
} from "../../scripts/services/admin-review-api.js";

const API_BASE_URL = "http://127.0.0.1:8000/api";
const RUNTIME_KEY = randomUUID();
const CONTRIBUTION_ID = "11111111-1111-4111-8111-111111111111";

const ITEM = Object.freeze({
  id: CONTRIBUTION_ID,
  contributionType: "guided",
  language: "Pashto",
  sentenceText: "هر غږ ارزښت لري.",
  topic: null,
  originalFilename: "recording.webm",
  mimeType: "audio/webm",
  durationSeconds: 8.4,
  createdAt: "2026-07-16T08:30:00Z",
  reviewStatus: "pending",
  reviewedAt: null,
  rejectionReason: null,
  hasOwner: true,
  ownerDisplayName: "Test contributor",
});


function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}


function page(items = [ITEM], overrides = {}) {
  return {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    status: "pending",
    ...overrides,
  };
}


function createApi(handler = () => jsonResponse(page())) {
  const calls = [];
  const api = new AdminReviewApi({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return handler(url, options, calls.length);
    },
  });
  return { api, calls };
}


async function assertApiError(action, { code, status } = {}) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof AdminReviewApiError);
    if (code !== undefined) assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  });
}


test("list request uses GET", async () => {
  const { api, calls } = createApi();
  await api.listContributions({ adminKey: RUNTIME_KEY, status: "pending" });
  assert.equal(calls[0].options.method, "GET");
});


test("list sends the runtime key only in X-Admin-Key", async () => {
  const { api, calls } = createApi();
  await api.listContributions({ adminKey: RUNTIME_KEY, status: "pending" });
  assert.equal(calls[0].options.headers["X-Admin-Key"], RUNTIME_KEY);
});


test("list never places the admin key in its URL", async () => {
  const { api, calls } = createApi();
  await api.listContributions({ adminKey: RUNTIME_KEY, status: "pending" });
  assert.equal(calls[0].url.includes(RUNTIME_KEY), false);
});


test("list query contains only status, limit and offset", async () => {
  const { api, calls } = createApi(() =>
    jsonResponse(page([], { status: "approved", limit: 12, offset: 24 })),
  );
  await api.listContributions({
    adminKey: RUNTIME_KEY,
    status: "approved",
    limit: 12,
    offset: 24,
  });
  const url = new URL(calls[0].url);
  assert.deepEqual([...url.searchParams.keys()].sort(), ["limit", "offset", "status"]);
  assert.equal(url.searchParams.get("status"), "approved");
  assert.equal(url.searchParams.get("limit"), "12");
  assert.equal(url.searchParams.get("offset"), "24");
});


test("list uses pending, 20 and 0 defaults", async () => {
  const { api, calls } = createApi();
  await api.listContributions({ adminKey: RUNTIME_KEY });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("status"), "pending");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("offset"), "0");
});


test("all four backend review filters are accepted", async () => {
  for (const status of ["pending", "approved", "rejected", "all"]) {
    const { api, calls } = createApi(() => jsonResponse(page([], { status })));
    await api.listContributions({ adminKey: RUNTIME_KEY, status });
    assert.equal(calls.length, 1);
  }
});


test("invalid list status is rejected before fetch", async () => {
  const { api, calls } = createApi();
  await assertApiError(
    () => api.listContributions({ adminKey: RUNTIME_KEY, status: "queued" }),
    { code: "INVALID_REVIEW_FILTER" },
  );
  assert.equal(calls.length, 0);
});


test("invalid pagination is rejected before fetch", async () => {
  const { api, calls } = createApi();
  await assertApiError(
    () => api.listContributions({ adminKey: RUNTIME_KEY, limit: 101 }),
    { code: "INVALID_PAGINATION" },
  );
  assert.equal(calls.length, 0);
});


test("list rejects a malformed contribution item", async () => {
  const { api } = createApi(() => jsonResponse(page([{ ...ITEM, mimeType: null }])));
  await assertApiError(
    () => api.listContributions({ adminKey: RUNTIME_KEY }),
    { code: "INVALID_ADMIN_QUEUE_RESPONSE" },
  );
});


test("validated contributions expose only the documented fields", () => {
  const validated = validateAdminContribution({
    ...ITEM,
    storageKey: "audio/private.webm",
    userId: "private-user-id",
    email: "private@example.com",
  });
  assert.deepEqual(Object.keys(validated).sort(), [
    "contributionType",
    "createdAt",
    "durationSeconds",
    "hasOwner",
    "id",
    "language",
    "mimeType",
    "originalFilename",
    "ownerDisplayName",
    "rejectionReason",
    "reviewStatus",
    "reviewedAt",
    "sentenceText",
    "topic",
  ]);
});


test("list response status must match the requested filter", () => {
  assert.throws(
    () => validateAdminContributionPage(page([], { status: "approved" }), "pending"),
    (error) => error.code === "INVALID_ADMIN_QUEUE_RESPONSE",
  );
});


test("detail route safely encodes the contribution ID", async () => {
  const { api, calls } = createApi(() => jsonResponse(ITEM));
  await api.getContribution({
    adminKey: RUNTIME_KEY,
    contributionId: "folder/value",
  });
  assert.equal(calls[0].url, `${API_BASE_URL}/admin/contributions/folder%2Fvalue`);
  assert.equal(calls[0].options.method, "GET");
});


test("blank contribution ID is rejected before detail fetch", async () => {
  const { api, calls } = createApi();
  await assertApiError(
    () => api.getContribution({ adminKey: RUNTIME_KEY, contributionId: "  " }),
    { code: "INVALID_CONTRIBUTION_ID" },
  );
  assert.equal(calls.length, 0);
});


test("audio uses the protected contribution audio route", async () => {
  const audio = new Blob(["audio"], { type: "audio/webm" });
  const { api, calls } = createApi(
    () => new Response(audio, { headers: { "content-type": "audio/webm" } }),
  );
  await api.getContributionAudio({ adminKey: RUNTIME_KEY, contributionId: CONTRIBUTION_ID });
  assert.equal(
    calls[0].url,
    `${API_BASE_URL}/admin/contributions/${CONTRIBUTION_ID}/audio`,
  );
  assert.equal(calls[0].options.method, "GET");
});


test("audio request sends X-Admin-Key without putting it in src-like URL", async () => {
  const { api, calls } = createApi(
    () => new Response(new Blob(["audio"]), { headers: { "content-type": "audio/ogg" } }),
  );
  await api.getContributionAudio({ adminKey: RUNTIME_KEY, contributionId: CONTRIBUTION_ID });
  assert.equal(calls[0].options.headers["X-Admin-Key"], RUNTIME_KEY);
  assert.equal(calls[0].url.includes(RUNTIME_KEY), false);
});


test("audio response is returned as a Blob", async () => {
  const { api } = createApi(
    () => new Response(new Blob(["audio"]), { headers: { "content-type": "audio/wav" } }),
  );
  const result = await api.getContributionAudio({
    adminKey: RUNTIME_KEY,
    contributionId: CONTRIBUTION_ID,
  });
  assert.ok(result instanceof Blob);
});


test("audio MIME parameters are normalized", async () => {
  const { api } = createApi(
    () =>
      new Response(new Blob(["audio"]), {
        headers: { "content-type": "audio/webm; codecs=opus" },
      }),
  );
  const result = await api.getContributionAudio({
    adminKey: RUNTIME_KEY,
    contributionId: CONTRIBUTION_ID,
  });
  assert.ok(result instanceof Blob);
});


test("AAC and FLAC protected audio responses are accepted", async () => {
  for (const mimeType of ["audio/aac", "audio/flac"]) {
    const { api } = createApi(
      () =>
        new Response(new Blob(["audio"]), {
          headers: { "content-type": mimeType },
        }),
    );
    const result = await api.getContributionAudio({
      adminKey: RUNTIME_KEY,
      contributionId: CONTRIBUTION_ID,
    });
    assert.equal(result.type, mimeType);
  }
});


test("invalid audio MIME type is rejected", async () => {
  const { api } = createApi(
    () => new Response(new Blob(["html"]), { headers: { "content-type": "text/html" } }),
  );
  await assertApiError(
    () =>
      api.getContributionAudio({ adminKey: RUNTIME_KEY, contributionId: CONTRIBUTION_ID }),
    { code: "INVALID_AUDIO_RESPONSE", status: 200 },
  );
});


test("approval uses PATCH and sends only status", async () => {
  const approved = { ...ITEM, reviewStatus: "approved", reviewedAt: "2026-07-16T09:00:00Z" };
  const { api, calls } = createApi(() => jsonResponse(approved));
  await api.reviewContribution({
    adminKey: RUNTIME_KEY,
    contributionId: CONTRIBUTION_ID,
    status: "approved",
    rejectionReason: "must not be sent",
    userId: "must not be sent",
    reviewedAt: "must not be sent",
  });
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), { status: "approved" });
});


test("rejection sends status and a trimmed rejection reason", async () => {
  const rejected = {
    ...ITEM,
    reviewStatus: "rejected",
    reviewedAt: "2026-07-16T09:00:00Z",
    rejectionReason: "Audio is too noisy.",
  };
  const { api, calls } = createApi(() => jsonResponse(rejected));
  await api.reviewContribution({
    adminKey: RUNTIME_KEY,
    contributionId: CONTRIBUTION_ID,
    status: "rejected",
    rejectionReason: "  Audio is too noisy.  ",
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    status: "rejected",
    rejectionReason: "Audio is too noisy.",
  });
});


test("blank rejection reason is rejected before fetch", async () => {
  const { api, calls } = createApi();
  await assertApiError(
    () =>
      api.reviewContribution({
        adminKey: RUNTIME_KEY,
        contributionId: CONTRIBUTION_ID,
        status: "rejected",
        rejectionReason: "   ",
      }),
    { code: "REJECTION_REASON_REQUIRED" },
  );
  assert.equal(calls.length, 0);
});


test("rejection reason over 500 characters is rejected before fetch", async () => {
  const { api, calls } = createApi();
  await assertApiError(
    () =>
      api.reviewContribution({
        adminKey: RUNTIME_KEY,
        contributionId: CONTRIBUTION_ID,
        status: "rejected",
        rejectionReason: "x".repeat(501),
      }),
    { code: "INVALID_REJECTION_REASON" },
  );
  assert.equal(calls.length, 0);
});


test("review JSON cannot include admin key, userId or reviewedAt", async () => {
  const approved = { ...ITEM, reviewStatus: "approved", reviewedAt: "2026-07-16T09:00:00Z" };
  const { api, calls } = createApi(() => jsonResponse(approved));
  await api.reviewContribution({
    adminKey: RUNTIME_KEY,
    contributionId: CONTRIBUTION_ID,
    status: "approved",
    userId: "private-user",
    reviewedAt: "2026-01-01T00:00:00Z",
  });
  const body = calls[0].options.body;
  assert.equal(body.includes(RUNTIME_KEY), false);
  assert.equal(body.includes("userId"), false);
  assert.equal(body.includes("reviewedAt"), false);
});


test("backend message, code and status are preserved", async () => {
  const { api } = createApi(() =>
    jsonResponse(
      { message: "Contribution was not found.", code: "CONTRIBUTION_NOT_FOUND" },
      { status: 404 },
    ),
  );
  await assert.rejects(
    () => api.getContribution({ adminKey: RUNTIME_KEY, contributionId: CONTRIBUTION_ID }),
    (error) => {
      assert.equal(error.message, "Contribution was not found.");
      assert.equal(error.code, "CONTRIBUTION_NOT_FOUND");
      assert.equal(error.status, 404);
      return true;
    },
  );
});


test("FastAPI authentication detail is preserved safely", async () => {
  const { api } = createApi(() =>
    jsonResponse({ detail: "Invalid admin API key." }, { status: 403 }),
  );
  await assert.rejects(
    () => api.listContributions({ adminKey: RUNTIME_KEY }),
    (error) => {
      assert.equal(error.message, "Invalid admin API key.");
      assert.equal(error.code, "INVALID_ADMIN_KEY");
      assert.equal(error.status, 403);
      return true;
    },
  );
});


test("network failures use a safe error", async () => {
  const { api } = createApi(() => {
    throw new Error("socket internals must not escape");
  });
  await assert.rejects(
    () => api.listContributions({ adminKey: RUNTIME_KEY }),
    (error) => {
      assert.equal(error.code, "NETWORK_ERROR");
      assert.equal(error.status, 0);
      assert.equal(error.message.includes("socket internals"), false);
      return true;
    },
  );
});


test("a backend echo cannot place the admin key in an error", async () => {
  const { api } = createApi(() =>
    jsonResponse(
      { message: `Rejected ${RUNTIME_KEY}`, code: `ERROR_${RUNTIME_KEY}` },
      { status: 400 },
    ),
  );
  await assert.rejects(
    () => api.listContributions({ adminKey: RUNTIME_KEY }),
    (error) => {
      assert.equal(error.message.includes(RUNTIME_KEY), false);
      assert.equal(error.code.includes(RUNTIME_KEY), false);
      return true;
    },
  );
});


test("missing admin key is rejected before fetch", async () => {
  const { api, calls } = createApi();
  await assertApiError(() => api.listContributions({ adminKey: "" }), {
    code: "ADMIN_KEY_REQUIRED",
    status: 401,
  });
  assert.equal(calls.length, 0);
});
