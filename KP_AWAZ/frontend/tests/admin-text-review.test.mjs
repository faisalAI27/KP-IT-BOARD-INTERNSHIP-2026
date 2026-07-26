import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { AdminTextReview } from "../scripts/modules/admin-text-review.js";


const ADMIN_KEY = randomUUID();
const TEXT_ID = "11111111-1111-4111-8111-111111111111";
const SUMMARY = Object.freeze({
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
const DETAIL = Object.freeze({
  ...SUMMARY,
  textContent: "za da pukhtana yam",
});


class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
}


class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.className = "";
    this.classList = new FakeClassList();
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.value = "";
    this._text = "";
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

  focus() {}
}


const IDS = [
  "adminTextReviewPanel",
  "adminTextReviewSummary",
  "adminRefreshTextButton",
  "adminTextPendingCount",
  "adminTextReviewStatus",
  "adminTextReviewError",
  "adminTextReviewErrorMessage",
  "adminRetryTextButton",
  "adminTextReviewEmpty",
  "adminTextContributionList",
  "adminPreviousTextPageButton",
  "adminNextTextPageButton",
  "adminTextPaginationStatus",
];


function fixture() {
  const elements = new Map(IDS.map((id) => [id, new FakeElement()]));
  const filters = ["pending", "approved", "rejected", "all"].map((status) => {
    const button = new FakeElement("button");
    button.setAttribute("data-admin-text-filter", status);
    return button;
  });
  const root = {
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll(selector) {
      return selector === "[data-admin-text-filter]" ? filters : [];
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
  const calls = { list: [], get: [], review: [] };
  const api = {
    async list(input) {
      calls.list.push({ ...input });
      return {
        items: [SUMMARY],
        total: 1,
        limit: 20,
        offset: 0,
        status: input.status,
      };
    },
    async get(input) {
      calls.get.push({ ...input });
      return { ...DETAIL };
    },
    async review(input) {
      calls.review.push({ ...input });
      return {
        ...DETAIL,
        reviewStatus: input.status,
        reviewedAt: "2026-07-26T13:00:00Z",
        rejectionReason:
          input.status === "rejected" ? input.rejectionReason : null,
      };
    },
  };
  let connectionListener = null;
  const review = new AdminTextReview({
    root,
    api,
    subscribeConnection(listener) {
      connectionListener = listener;
      listener({ connected: true, adminKey: ADMIN_KEY });
      return () => {
        connectionListener = null;
      };
    },
    locale: "en-US",
  });
  assert.equal(review.initialize(), true);
  return {
    review,
    elements,
    calls,
    disconnect() {
      connectionListener?.({ connected: false, adminKey: null });
    },
  };
}


async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}


test("admin page contains a protected typed and file contribution queue", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../admin.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/admin-app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="adminTextReviewPanel"/);
  assert.match(html, /id="adminTextContributionList"/);
  assert.match(html, /data-admin-text-filter="pending"/);
  assert.match(html, /typed sentences, and uploaded text files/);
  assert.match(app, /initializeAdminTextReview/);
});


test("admin connection loads and renders pending donated text", async () => {
  const view = fixture();
  await settle();

  assert.deepEqual(view.calls.list, [
    {
      adminKey: ADMIN_KEY,
      status: "pending",
      limit: 20,
      offset: 0,
    },
  ]);
  assert.match(
    view.elements.get("adminTextContributionList").textContent,
    /za da pukhtana yam/,
  );
  assert.match(view.elements.get("adminTextPendingCount").textContent, /1/);
});


test("selecting donated text loads full content without rendering private extras", async () => {
  const view = fixture();
  await settle();

  await view.review.select(TEXT_ID);

  assert.deepEqual(view.calls.get, [
    { adminKey: ADMIN_KEY, contributionId: TEXT_ID },
  ]);
  assert.match(
    view.elements.get("adminTextContributionList").textContent,
    /za da pukhtana yam/,
  );
  assert.equal(
    view.elements.get("adminTextContributionList").textContent.includes(ADMIN_KEY),
    false,
  );
});


test("approving donated text removes it from the pending queue with feedback", async () => {
  const view = fixture();
  await settle();
  await view.review.select(TEXT_ID);

  assert.equal(await view.review.review(TEXT_ID, "approved"), true);

  assert.deepEqual(view.calls.review, [
    {
      adminKey: ADMIN_KEY,
      contributionId: TEXT_ID,
      status: "approved",
      rejectionReason: "",
    },
  ]);
  assert.equal(view.review.getState().items.length, 0);
  assert.equal(view.review.getState().pendingTotal, 0);
  assert.match(view.elements.get("adminTextReviewStatus").textContent, /approved/i);
});


test("disconnect clears donated text and the memory-only admin key", async () => {
  const view = fixture();
  await settle();

  view.disconnect();

  assert.equal(view.review.getState().connected, false);
  assert.equal(view.review.getState().items.length, 0);
  assert.equal(
    view.elements.get("adminTextContributionList").textContent.includes(ADMIN_KEY),
    false,
  );
});
