import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  AdminPhrasesApi,
  AdminPhrasesApiError,
} from "../../scripts/services/admin-phrases-api.js";

const ADMIN_KEY = randomUUID();
const PHRASE_ID = "11111111-1111-4111-8111-111111111111";
const PASHTO_TEXT = "زه خپل کلي سره مینه لرم";


function phraseResponse(overrides = {}) {
  return {
    id: PHRASE_ID,
    text: PASHTO_TEXT,
    language: "Pashto",
    category: "general",
    dialect: null,
    source: null,
    difficulty: null,
    active: true,
    created_at: "2026-07-19T09:00:00Z",
    updated_at: "2026-07-19T09:00:00Z",
    times_assigned: 3,
    recordings_submitted: 2,
    pending_count: 1,
    approved_count: 1,
    rejected_count: 0,
    ...overrides,
  };
}


function phrasePage(overrides = {}) {
  return {
    items: [phraseResponse()],
    total: 1,
    limit: 20,
    offset: 0,
    order: "newest",
    ...overrides,
  };
}


function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}


function fixture(handler) {
  const calls = [];
  const api = new AdminPhrasesApi({
    apiBaseUrl: "http://127.0.0.1:8000/api",
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return handler(url, options, calls.length);
    },
  });
  return { api, calls };
}


function namedBlob(name, type, contents = PASHTO_TEXT) {
  const file = new Blob([contents], { type });
  Object.defineProperty(file, "name", { value: name });
  return file;
}


test("phrase list preserves Pashto and sends search, language, status, and pagination", async () => {
  const { api, calls } = fixture(() => jsonResponse(phrasePage({ total: 41, offset: 20 })));
  const page = await api.listPhrases({
    adminKey: ADMIN_KEY,
    limit: 20,
    offset: 20,
    search: PASHTO_TEXT,
    language: "Pashto",
    active: false,
  });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("search"), PASHTO_TEXT);
  assert.equal(url.searchParams.get("language"), "Pashto");
  assert.equal(url.searchParams.get("active"), "false");
  assert.equal(url.searchParams.get("offset"), "20");
  assert.equal(page.items[0].text, PASHTO_TEXT);
  assert.equal(calls[0].options.headers["X-Admin-Key"], ADMIN_KEY);
});


for (const [extension, mimeType] of [
  ["csv", "text/csv"],
  ["json", "application/json"],
  ["txt", "text/plain"],
]) {
  test(`phrase import accepts ${extension.toUpperCase()} through protected FormData`, async () => {
    const { api, calls } = fixture(() =>
      jsonResponse({ received: 2, created: 1, duplicates: 1, invalid: 0 }),
    );
    const summary = await api.importPhrases({
      adminKey: ADMIN_KEY,
      file: namedBlob(`phrases.${extension}`, mimeType),
    });
    assert.deepEqual(summary, { received: 2, created: 1, duplicates: 1, invalid: 0 });
    assert.equal(calls[0].options.method, "POST");
    assert.ok(calls[0].options.body instanceof FormData);
    assert.equal(calls[0].options.body.get("file").name, `phrases.${extension}`);
    assert.equal(calls[0].options.headers["Content-Type"], undefined);
  });
}


test("unsupported import extension is rejected before a request", async () => {
  const { api, calls } = fixture(() => jsonResponse({}));
  await assert.rejects(
    () => api.importPhrases({
      adminKey: ADMIN_KEY,
      file: namedBlob("phrases.html", "text/html"),
    }),
    (error) => error instanceof AdminPhrasesApiError && error.code === "INVALID_PHRASE_FILE",
  );
  assert.equal(calls.length, 0);
});


test("phrase update sends only the supported backend fields", async () => {
  const { api, calls } = fixture(() =>
    jsonResponse(phraseResponse({ active: false, category: null })),
  );
  const phrase = await api.updatePhrase({
    adminKey: ADMIN_KEY,
    phraseId: PHRASE_ID,
    updates: { active: false, category: null, unsupported: "ignored" },
  });
  assert.equal(phrase.active, false);
  assert.deepEqual(JSON.parse(calls[0].options.body), { active: false, category: null });
  assert.match(calls[0].url, new RegExp(`/admin/phrases/${PHRASE_ID}$`));
});


for (const [format, activeOnly] of [
  ["csv", true],
  ["csv", false],
  ["json", true],
  ["json", false],
]) {
  test(`${activeOnly ? "active" : "all"} ${format.toUpperCase()} export uses backend response`, async () => {
    const body = format === "csv" ? `text,language\n${PASHTO_TEXT},Pashto\n` : JSON.stringify([{ text: PASHTO_TEXT }]);
    const { api, calls } = fixture(() => new Response(body, {
      status: 200,
      headers: {
        "content-type": format === "csv" ? "text/csv" : "application/json",
        "content-disposition": `attachment; filename="kp_awaz_pashto_phrases_20260719.${format}"`,
      },
    }));
    const exported = await api.exportPhrases({ adminKey: ADMIN_KEY, format, activeOnly });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get("format"), format);
    assert.equal(url.searchParams.get("active_only"), String(activeOnly));
    assert.equal(await exported.blob.text(), body);
    assert.equal(exported.filename, `kp_awaz_pashto_phrases_20260719.${format}`);
  });
}


test("admin API ignores private extra fields returned by a compromised response", async () => {
  const unsafe = phraseResponse({
    ownerEmail: "private@example.invalid",
    storagePath: "/private/audio/recording.webm",
    token: "do-not-render",
    adminSecret: "do-not-render",
  });
  const { api } = fixture(() => jsonResponse(phrasePage({ items: [unsafe] })));
  const page = await api.listPhrases({ adminKey: ADMIN_KEY });
  assert.equal("ownerEmail" in page.items[0], false);
  assert.equal("storagePath" in page.items[0], false);
  assert.equal("token" in page.items[0], false);
  assert.equal("adminSecret" in page.items[0], false);
});


test("wrong-key and parser responses remain safe and do not echo the key", async () => {
  const { api } = fixture(() => jsonResponse({
    code: `INVALID_${ADMIN_KEY}`,
    message: `/server/imports/${ADMIN_KEY}/phrases.csv failed`,
  }, { status: 403 }));
  await assert.rejects(
    () => api.listPhrases({ adminKey: ADMIN_KEY }),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, "INVALID_ADMIN_KEY");
      assert.doesNotMatch(error.message, new RegExp(ADMIN_KEY));
      assert.doesNotMatch(error.message, /server|imports/i);
      return true;
    },
  );
});
