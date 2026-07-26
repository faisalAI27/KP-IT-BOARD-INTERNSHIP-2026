import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  AdminReviewApi,
  validateAdminTextContribution,
  validateAdminTextContributionPage,
} from "../scripts/services/admin-review-api.js";


const API_BASE_URL = "http://127.0.0.1:8000/api";
const ADMIN_KEY = randomUUID();
const TEXT_ID = "11111111-1111-4111-8111-111111111111";
const ITEM = Object.freeze({
  id: TEXT_ID,
  submissionMethod: "manual",
  language: "Pashto",
  textType: "phrase",
  textPreview: "za da pukhtana yam",
  textContent: null,
  contentLength: 18,
  originalFilename: null,
  mimeType: null,
  fileSize: null,
  reviewStatus: "pending",
  reviewedAt: null,
  rejectionReason: null,
  createdAt: "2026-07-26T12:23:03Z",
  hasOwner: true,
  ownerDisplayName: "Safe Contributor",
});


function json(body, status = 200) {
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


function fixture(handler = () => json(page())) {
  const calls = [];
  const api = new AdminReviewApi({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return handler(url, options, calls.length);
    },
  });
  return { api, calls };
}


test("donated-text queue uses the protected route and review filters", async () => {
  const { api, calls } = fixture(() =>
    json(page([], { status: "approved", limit: 12, offset: 24 })),
  );

  await api.listTextContributions({
    adminKey: ADMIN_KEY,
    status: "approved",
    limit: 12,
    offset: 24,
  });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/admin/text-contributions");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["limit", "offset", "status"]);
  assert.equal(url.searchParams.get("status"), "approved");
  assert.equal(calls[0].options.headers["X-Admin-Key"], ADMIN_KEY);
  assert.equal(calls[0].url.includes(ADMIN_KEY), false);
});


test("donated-text detail safely encodes its ID and returns full content", async () => {
  const detail = { ...ITEM, textContent: "line one\nline two" };
  const { api, calls } = fixture(() => json(detail));

  const result = await api.getTextContribution({
    adminKey: ADMIN_KEY,
    contributionId: "folder/value",
  });

  assert.equal(
    calls[0].url,
    `${API_BASE_URL}/admin/text-contributions/folder%2Fvalue`,
  );
  assert.equal(result.textContent, "line one\nline two");
});


test("donated-text rejection sends only the decision and trimmed reason", async () => {
  const rejected = {
    ...ITEM,
    textContent: "za da pukhtana yam",
    reviewStatus: "rejected",
    reviewedAt: "2026-07-26T13:00:00Z",
    rejectionReason: "Duplicate wording.",
  };
  const { api, calls } = fixture(() => json(rejected));

  await api.reviewTextContribution({
    adminKey: ADMIN_KEY,
    contributionId: TEXT_ID,
    status: "rejected",
    rejectionReason: "  Duplicate wording.  ",
  });

  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    status: "rejected",
    rejectionReason: "Duplicate wording.",
  });
  assert.equal(JSON.parse(calls[0].options.body).adminKey, undefined);
});


test("donated-text validator strips private response extras", () => {
  const validated = validateAdminTextContribution({
    ...ITEM,
    userId: "private-user-id",
    email: "private@example.test",
    databasePath: "/private/database.sqlite",
  });

  assert.equal("userId" in validated, false);
  assert.equal("email" in validated, false);
  assert.equal("databasePath" in validated, false);
});


test("donated-text page rejects a mismatched filter response", () => {
  assert.throws(
    () =>
      validateAdminTextContributionPage(
        page([], { status: "approved" }),
        "pending",
      ),
    (error) => error.code === "INVALID_ADMIN_TEXT_QUEUE_RESPONSE",
  );
});
