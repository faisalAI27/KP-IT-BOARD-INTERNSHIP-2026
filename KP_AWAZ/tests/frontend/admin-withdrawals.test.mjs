import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  AdminReviewApi,
  validateAdminWithdrawalPage,
  validateAdminWithdrawalRequest,
} from "../../scripts/services/admin-review-api.js";
import { AdminWithdrawals } from "../../scripts/modules/admin-withdrawals.js";


const API_BASE_URL = "http://127.0.0.1:8000/api";
const ADMIN_KEY = randomUUID();
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ITEM = Object.freeze({
  id: REQUEST_ID,
  scope: "contribution",
  status: "requested",
  ownerDisplayName: "Safe Contributor",
  contributionSummary: "هر غږ ارزښت لري.",
  affectedContributionCount: 1,
  reason: "Please exclude this recording.",
  requestedAt: "2026-07-19T08:00:00Z",
  resolvedAt: null,
  resolutionReason: null,
});


function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}


function createApi(handler) {
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


class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.className = "";
    this.disabled = false;
    this.hidden = false;
    this.value = "";
    this._text = "";
    this.classList = { toggle() {} };
  }

  get textContent() {
    return `${this._text}${this.children.map((child) => child.textContent).join("")}`;
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  click() {
    for (const listener of this.listeners.get("click") ?? []) listener({ target: this });
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this._text = "";
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}


function adminUiFixture() {
  const ids = [
    "adminWithdrawalPanel",
    "adminRefreshWithdrawalsButton",
    "adminWithdrawalStatus",
    "adminWithdrawalSummary",
    "adminWithdrawalEmpty",
    "adminWithdrawalList",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  const filters = ["requested", "approved", "declined", "all"].map((status) => {
    const button = new FakeElement("button");
    button.setAttribute("data-withdrawal-filter", status);
    return button;
  });
  const root = {
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll() {
      return filters;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
  const calls = { list: [], resolve: [], confirms: 0 };
  const api = {
    async list(input) {
      calls.list.push({ ...input });
      return { items: [ITEM], total: 1, limit: 100, offset: 0, status: input.status };
    },
    async resolve(input) {
      calls.resolve.push({ ...input });
      return { ...ITEM, status: input.status, resolvedAt: "2026-07-19T09:00:00Z" };
    },
  };
  const withdrawals = new AdminWithdrawals({
    root,
    api,
    subscribeConnection(listener) {
      listener({ connected: true, adminKey: ADMIN_KEY });
      return () => {};
    },
    confirmAction() {
      calls.confirms += 1;
      return true;
    },
    locale: "en-US",
  });
  assert.equal(withdrawals.initialize(), true);
  return { withdrawals, elements, calls };
}


async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}


function findByText(element, pattern) {
  if (pattern.test(element._text)) return element;
  for (const child of element.children) {
    const match = findByText(child, pattern);
    if (match) return match;
  }
  return null;
}


test("protected withdrawal list uses the existing admin header and safe query", async () => {
  const page = { items: [ITEM], total: 1, limit: 20, offset: 0, status: "requested" };
  const { api, calls } = createApi(() => json(page));
  await api.listWithdrawalRequests({ adminKey: ADMIN_KEY });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/admin/withdrawals");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["limit", "offset", "status"]);
  assert.equal(calls[0].options.headers["X-Admin-Key"], ADMIN_KEY);
  assert.equal(calls[0].url.includes(ADMIN_KEY), false);
});


test("administrator can approve export exclusion without a decline reason", async () => {
  const approved = {
    ...ITEM,
    status: "approved",
    resolvedAt: "2026-07-19T09:00:00Z",
  };
  const { api, calls } = createApi(() => json(approved));
  const result = await api.resolveWithdrawalRequest({
    adminKey: ADMIN_KEY,
    requestId: REQUEST_ID,
    status: "approved",
  });

  assert.equal(result.status, "approved");
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), { status: "approved" });
  assert.equal(calls[0].url, `${API_BASE_URL}/admin/withdrawals/${REQUEST_ID}`);
});


test("decline requires and sends a safe internal reason", async () => {
  const declined = {
    ...ITEM,
    status: "declined",
    resolvedAt: "2026-07-19T09:00:00Z",
    resolutionReason: "Request could not be matched to the described data.",
  };
  const { api, calls } = createApi(() => json(declined));
  await assert.rejects(
    api.resolveWithdrawalRequest({
      adminKey: ADMIN_KEY,
      requestId: REQUEST_ID,
      status: "declined",
    }),
    { code: "WITHDRAWAL_RESOLUTION_REASON_REQUIRED" },
  );
  assert.equal(calls.length, 0);

  await api.resolveWithdrawalRequest({
    adminKey: ADMIN_KEY,
    requestId: REQUEST_ID,
    status: "declined",
    resolutionReason: declined.resolutionReason,
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    status: "declined",
    resolutionReason: declined.resolutionReason,
  });
});


test("protected response validator strips unexpected secrets", () => {
  const result = validateAdminWithdrawalRequest({
    ...ITEM,
    email: "private@example.com",
    audioStorageKey: "private/audio.webm",
    adminKey: ADMIN_KEY,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes("private/audio.webm"), false);
  assert.equal(serialized.includes(ADMIN_KEY), false);
});


test("withdrawal queue response status must match its protected filter", () => {
  assert.throws(
    () => validateAdminWithdrawalPage(
      { items: [], total: 0, limit: 20, offset: 0, status: "approved" },
      "requested",
    ),
    (error) => error.code === "INVALID_ADMIN_WITHDRAWAL_QUEUE_RESPONSE",
  );
});


test("admin page contains a protected reviewable withdrawal queue", async () => {
  const html = await readFile(new URL("../../admin.html", import.meta.url), "utf8");
  const source = await readFile(
    new URL("../../scripts/modules/admin-withdrawals.js", import.meta.url),
    "utf8",
  );
  assert.match(html, /Withdrawal requests/);
  assert.match(source, /Approve exclusion/);
  assert.match(source, /Source records will remain for audit/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});


test("protected admin UI confirms and resolves a request without rendering its ID", async () => {
  const current = adminUiFixture();
  await settle();
  const list = current.elements.get("adminWithdrawalList");
  assert.equal(list.textContent.includes(REQUEST_ID), false);
  assert.equal(list.textContent.includes(ADMIN_KEY), false);
  const approve = findByText(list, /Approve exclusion/);
  assert.ok(approve);
  approve.click();
  await settle();

  assert.equal(current.calls.confirms, 1);
  assert.equal(current.calls.resolve[0].requestId, REQUEST_ID);
  assert.equal(current.calls.resolve[0].status, "approved");
  current.withdrawals.destroy();
});
