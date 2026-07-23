import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { validateDonateTextFile } from "../../scripts/modules/donate-text.js";
import {
  TextContributionsApi,
  validateTextContributionResponse,
} from "../../scripts/services/text-contributions-api.js";


const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");


test("Donate Text is placed after the guided Record Voice section", async () => {
  const [page, recording, donateText] = await Promise.all([
    read("contribute.html"),
    read("sections/contribution.html"),
    read("sections/donate-text.html"),
  ]);

  assert.ok(
    page.indexOf("sections/donate-text.html") >
      page.indexOf("sections/contribution.html"),
  );
  assert.match(donateText, /id="donate-text"/);
  assert.match(donateText, /id="donateTextSentence"/);
  assert.match(donateText, /id="donateTextFileInput"/);
  assert.match(donateText, /accept="\.csv,\.txt,\.tsv,\.json/);
  assert.doesNotMatch(recording, /custom-sentence|switchSentenceMode/);
  assert.equal(
    (recording.match(/name="sentence-source"/g) ?? []).length,
    1,
  );
});


test("Donate Text file validation accepts bounded supported files", () => {
  assert.equal(
    validateDonateTextFile({ name: "phrases.txt", size: 128 }),
    "",
  );
  assert.match(
    validateDonateTextFile({ name: "phrases.pdf", size: 128 }),
    /CSV, TXT, TSV, or JSON/,
  );
  assert.match(
    validateDonateTextFile({ name: "phrases.txt", size: 2 * 1024 * 1024 + 1 }),
    /larger than 2 MB/,
  );
});


test("text contribution response is reduced to its safe receipt", () => {
  const response = validateTextContributionResponse({
    ids: ["11111111-1111-4111-8111-111111111111"],
    itemCount: 1,
    status: "queued",
    createdAt: "2026-07-23T12:00:00Z",
    userId: "must-not-escape",
  });

  assert.deepEqual(Object.keys(response), [
    "ids",
    "itemCount",
    "status",
    "createdAt",
  ]);
  assert.equal("userId" in response, false);
});


test("authenticated text submission sends manual text and selected files", async () => {
  let captured;
  const file = new Blob(["هر غږ ارزښت لري."], { type: "text/plain" });
  Object.defineProperty(file, "name", { value: "phrases.txt" });
  const api = new TextContributionsApi({
    apiBaseUrl: "http://127.0.0.1:8000/api",
    getAccessToken: () => "private-access-token",
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return new Response(
        JSON.stringify({
          ids: ["11111111-1111-4111-8111-111111111111"],
          itemCount: 1,
          status: "queued",
          createdAt: "2026-07-23T12:00:00Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
  });

  await api.submit({
    contributorName: "Faisal Imran",
    textType: "sentence",
    text: "پښتو زموږ ګډ کور دی.",
    files: [file],
  });

  assert.equal(captured.url, "http://127.0.0.1:8000/api/contributions/text");
  assert.equal(captured.options.headers.Authorization, "Bearer private-access-token");
  assert.equal(captured.options.body.get("language"), "Pashto");
  assert.equal(captured.options.body.get("textType"), "sentence");
  assert.equal(captured.options.body.get("text"), "پښتو زموږ ګډ کور دی.");
  assert.equal(captured.options.body.get("files").name, "phrases.txt");
});
