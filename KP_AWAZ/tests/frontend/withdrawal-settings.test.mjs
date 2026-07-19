import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  WithdrawalSettings,
  formatWithdrawalContributionChoice,
  formatWithdrawalRequestStatus,
} from "../../scripts/modules/withdrawal-settings.js";


const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONTRIBUTION_ID = "22222222-2222-4222-8222-222222222222";
const CONTRIBUTION = Object.freeze({
  id: CONTRIBUTION_ID,
  contributionType: "guided",
  sentenceText: "هر غږ ارزښت لري.",
  topic: null,
  originalFilename: "recording.webm",
  createdAt: "2026-07-19T08:00:00Z",
});
const REQUEST = Object.freeze({
  scope: "contribution",
  status: "requested",
  contributionId: CONTRIBUTION_ID,
  reason: null,
  requestedAt: "2026-07-19T09:00:00Z",
  resolvedAt: null,
});


class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
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
}


const IDS = [
  "withdrawalSettingsSection",
  "withdrawalContributionSelect",
  "withdrawalReason",
  "requestOneWithdrawalButton",
  "requestAllWithdrawalButton",
  "refreshWithdrawalStatusButton",
  "withdrawalSettingsStatus",
  "withdrawalRequestList",
  "withdrawalRequestEmpty",
];


function fixture({ requests = [], confirm = true } = {}) {
  const elements = new Map(IDS.map((id) => [id, new FakeElement()]));
  const root = {
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
  const calls = { create: [], list: 0, history: 0, confirm: [] };
  let storedRequests = [...requests];
  const api = {
    async getContributions() {
      calls.history += 1;
      return { items: [CONTRIBUTION], total: 1, limit: 100, offset: 0 };
    },
    async listRequests() {
      calls.list += 1;
      return { items: [...storedRequests], total: storedRequests.length, limit: 20, offset: 0 };
    },
    async createRequest(input) {
      calls.create.push({ ...input });
      const created = {
        ...REQUEST,
        scope: input.scope,
        contributionId: input.scope === "all" ? null : input.contributionId,
        reason: input.reason || null,
      };
      storedRequests = [created, ...storedRequests];
      return created;
    },
  };
  const settings = new WithdrawalSettings({
    root,
    api,
    locale: "en-US",
    authApi: {
      getCurrentAuthState: () => ({ backendUser: { id: USER_ID } }),
    },
    confirmAction(message) {
      calls.confirm.push(message);
      return confirm;
    },
  });
  assert.equal(settings.initialize({ expectedUserId: USER_ID }), true);
  return { settings, elements, calls };
}


async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}


test("Settings contains a clear non-destructive Data and Privacy workflow", async () => {
  const html = await readFile(
    new URL("../../sections/workspace-settings.html", import.meta.url),
    "utf8",
  );
  const source = await readFile(
    new URL("../../scripts/modules/withdrawal-settings.js", import.meta.url),
    "utf8",
  );
  assert.match(html, /Data and Privacy/);
  assert.match(html, /Request withdrawal for one recording/);
  assert.match(html, /Request withdrawal for all recordings/);
  assert.match(html, /administrator review/i);
  assert.match(html, /does not immediately delete/i);
  assert.match(html, /data-use\.html/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.(?:log|warn|error)/);
});


test("one-recording request requires confirmation and uses the owned selection", async () => {
  const current = fixture();
  await settle();
  const select = current.elements.get("withdrawalContributionSelect");
  select.value = CONTRIBUTION_ID;
  current.elements.get("withdrawalReason").value = "Please exclude this clip.";
  current.elements.get("requestOneWithdrawalButton").click();
  await settle();

  assert.equal(current.calls.confirm.length, 1);
  assert.deepEqual(current.calls.create[0], {
    scope: "contribution",
    contributionId: CONTRIBUTION_ID,
    reason: "Please exclude this clip.",
  });
  assert.match(
    current.elements.get("withdrawalSettingsStatus").textContent,
    /waiting for administrator review/i,
  );
});


test("cancelling confirmation creates no request", async () => {
  const current = fixture({ confirm: false });
  await settle();
  current.elements.get("withdrawalContributionSelect").value = CONTRIBUTION_ID;
  current.elements.get("requestOneWithdrawalButton").click();
  await settle();
  assert.equal(current.calls.confirm.length, 1);
  assert.equal(current.calls.create.length, 0);
});


test("all-recordings request has no contribution target", async () => {
  const current = fixture();
  await settle();
  current.elements.get("requestAllWithdrawalButton").click();
  await settle();
  assert.deepEqual(current.calls.create[0], {
    scope: "all",
    contributionId: undefined,
    reason: "",
  });
});


test("request history shows status without rendering internal IDs", async () => {
  const current = fixture({ requests: [REQUEST] });
  await settle();
  const rendered = current.elements.get("withdrawalRequestList").textContent;
  assert.match(rendered, /Administrator review required/);
  assert.equal(rendered.includes(CONTRIBUTION_ID), false);
  assert.equal(formatWithdrawalRequestStatus("approved"), "Approved for exclusion");
  assert.match(formatWithdrawalContributionChoice(CONTRIBUTION, "en-US"), /Guided recording/);
});


test("destroy clears private request UI state", async () => {
  const current = fixture({ requests: [REQUEST] });
  await settle();
  current.elements.get("withdrawalReason").value = "private reason";
  current.settings.destroy();
  assert.equal(current.elements.get("withdrawalReason").value, "");
  assert.equal(current.elements.get("withdrawalRequestList").children.length, 0);
});
