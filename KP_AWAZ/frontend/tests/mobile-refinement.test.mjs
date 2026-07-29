import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const frontendRoot = new URL("../", import.meta.url);

const read = (path) => readFile(new URL(path, frontendRoot), "utf8");

const pages = [
  "index.html",
  "about.html",
  "how-it-works.html",
  "leaderboard.html",
  "data-use.html",
  "auth.html",
  "forgot-password.html",
  "reset-password.html",
  "dashboard.html",
  "contribute.html",
  "donate-text.html",
  "my-contributions.html",
  "settings.html",
  "profile.html",
  "admin.html",
];

test("every page loads the mobile refinement layer last", async () => {
  const documents = await Promise.all(pages.map(read));

  documents.forEach((document, index) => {
    const stylesheetLinks = [...document.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(
      ([link]) => link,
    );
    const lastStylesheet = stylesheetLinks.at(-1) ?? "";

    assert.match(
      lastStylesheet,
      /styles\/mobile-refinement\.css\?v=20260730-mobile-first/,
      `${pages[index]} must load the mobile refinement stylesheet last`,
    );
  });
});

test("mobile refinement keeps touch targets and compact page hierarchy explicit", async () => {
  const css = await read("styles/mobile-refinement.css");

  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(max-height: 520px\) and \(orientation: landscape\)/);
  assert.match(css, /\.workspace-nav-link\s*{[\s\S]*?min-height:\s*48px/);
  assert.match(css, /footer li a\s*{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.admin-section-tab,[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.dashboard-stat-card\s*{[\s\S]*?grid-template-columns:\s*44px auto minmax\(0, 1fr\)/);
  assert.match(css, /\.focused-journey\s*{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
});

test("Record Voice presents the reviewed sentence before microphone controls", async () => {
  const contribution = await read("sections/contribution.html");
  const sentenceIndex = contribution.indexOf('id="providedSentenceSource"');
  const recorderIndex = contribution.indexOf('aria-labelledby="guidedRecordingTitle"');

  assert.ok(sentenceIndex >= 0, "provided sentence card must exist");
  assert.ok(recorderIndex >= 0, "guided recorder must exist");
  assert.ok(sentenceIndex < recorderIndex, "sentence card must precede recorder controls");
  assert.match(
    contribution,
    /Keep one piece of<br \/> <em>Pashto alive\.<\/em>/,
    "heading must retain readable whitespace when the line break is hidden",
  );
});
