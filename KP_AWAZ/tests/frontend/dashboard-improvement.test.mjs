import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { test } from "node:test";

import {
  normalizeContributionMode,
  tokenizeSentenceWords,
} from "../../scripts/modules/contributions.js";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("dashboard presents exactly two direct recording choices", async () => {
  const html = await read("dashboard.html");
  const choices = html.match(/class="dashboard-recording-choice(?: is-recommended)?"/g) ?? [];
  assert.equal(choices.length, 2);
  assert.match(html, /contribute\.html\?mode=guided/);
  assert.match(html, /contribute\.html\?mode=custom/);
  assert.doesNotMatch(html, /leaderboard preview|voice-orbit|profile-compass|rejected count/i);
});

test("recording route mode is predictable and safe", () => {
  assert.equal(normalizeContributionMode("?mode=guided"), "guided");
  assert.equal(normalizeContributionMode("?mode=custom"), "custom");
  assert.equal(normalizeContributionMode("mode=custom"), "custom");
  assert.equal(normalizeContributionMode("?mode=open"), "guided");
  assert.equal(normalizeContributionMode("?next=https://example.com"), "guided");
});

test("Pashto sentence tokens preserve exact RTL text and punctuation", () => {
  const sentence = "زما ژبه، زما غږ دی.  هو!";
  const tokens = tokenizeSentenceWords(sentence);
  assert.equal(tokens.map(({ text }) => text).join(""), sentence);
  assert.deepEqual(
    tokens.filter(({ isWord }) => isWord).map(({ text }) => text),
    ["زما", "ژبه،", "زما", "غږ", "دی.", "هو!"],
  );
});

test("focused contribution flow keeps profile fields hidden and account consent honest", async () => {
  const [html, source, css] = await Promise.all([
    read("sections/contribution.html"),
    read("scripts/modules/contributions.js"),
    read("styles/contribution.css"),
  ]);
  assert.match(html, /id="donor-name"[\s\S]*type="hidden"/);
  assert.match(html, /id="donor-language"[\s\S]*type="hidden"/);
  assert.doesNotMatch(html, /Step [123] of 3|Continue to recording|Continue to review/);
  assert.equal((html.match(/>\s*Submit recording\s*</g) ?? []).length, 2);
  assert.doesNotMatch(html, /checkbox|consent-check|I agree/i);
  assert.match(source, /ACCOUNT_POLICY_SUBMISSION_BLOCK_MESSAGE/);
  assert.doesNotMatch(source, /consentGiven\s*:\s*true/);
  assert.match(source, /profile\.displayName/);
  assert.match(source, /profile\.preferredLanguage/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /min-height:\s*44px/);
});

test("guided reading and Rabab controls are accessible and responsive to live audio", async () => {
  const [html, css, contributionSource, recorderSource, visualizerSource] = await Promise.all([
    read("sections/contribution.html"),
    read("styles/contribution.css"),
    read("scripts/modules/contributions.js"),
    read("scripts/modules/recorder.js"),
    read("scripts/modules/audio-visualizer.js"),
  ]);
  assert.match(html, /id="providedSentence"[^>]*lang="ps"[^>]*dir="rtl"[^>]*tabindex="0"/);
  assert.equal((html.match(/class="rabab-icon"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /class="(?:mic|stop)-icon"/);
  assert.match(html, /Press the Rabab to record/);
  assert.match(contributionSource, /className = "pashto-word"/);
  assert.match(contributionSource, /document\.createTextNode\(token\.text\)/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?scale\(1\.08\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pashto-word:hover[\s\S]*?transform:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.rabab-instrument,[\s\S]*?\.rabab-string\s*{[\s\S]*?transform:\s*none/);
  assert.match(recorderSource, /--rabab-string-one/);
  assert.match(visualizerSource, /createMediaStreamSource\(stream\)/);
  assert.match(visualizerSource, /onLevel/);
});

test("record voice adapts the supplied voice mission template around the production recorder", async () => {
  const [html, css, source] = await Promise.all([
    read("sections/contribution.html"),
    read("styles/contribution.css"),
    read("scripts/modules/contributions.js"),
  ]);
  assert.match(html, /class="contribution-studio voice-mission-card"/);
  assert.match(html, /Today’s voice mission/);
  assert.match(html, /Keep one piece of <em>Pashto alive\.<\/em>/);
  assert.match(html, /class="recorder-surface voice-record-stage"/);
  assert.match(html, /<ol class="recording-journey"[^>]*aria-label="Recording progress"/);
  assert.equal((html.match(/data-recording-step="[123]"/g) ?? []).length, 3);
  assert.match(html, /id="donateWaveform"/);
  assert.match(html, /id="donateRecBtn"/);
  assert.match(html, /id="submitDonation"/);
  assert.doesNotMatch(html, /\bXP\b|streak|community voices|dark mode|confetti/i);
  assert.match(source, /MutationObserver/);
  assert.match(source, /contains\("ready"\)[\s\S]*setRecordingJourney\(3\)/);
  assert.match(source, /contains\("recording"\)[\s\S]*setRecordingJourney\(2\)/);
  assert.match(source, /donateRecordStateLabel\.textContent = "Ready to submit"/);
  assert.match(css, /#donateForm \.voice-record-stage\s*{[\s\S]*linear-gradient/);
  assert.match(css, /\.rec-btn\.recording ~ \.voice-pulse-ring/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.recording-journey\s*{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?#donateForm \.rec-btn\.recording ~ \.voice-pulse-ring[\s\S]*?animation:\s*none/);
});

test("dashboard contribution panel is compact and softly surfaced", async () => {
  const [html, css] = await Promise.all([
    read("dashboard.html"),
    read("styles/dashboard.css"),
  ]);
  assert.match(html, /class="workspace-body dashboard-body"/);
  assert.match(html, /Choose how you want to share your voice/);
  assert.match(html, /Read a provided Pashto sentence or contribute words you naturally use\./);
  assert.doesNotMatch(css, /\.dashboard-contribute-hub\s*{[^}]*background:\s*#173e34/s);
  assert.match(css, /\.dashboard-contribute-hub\s*{[^}]*padding:\s*clamp\(18px, 2\.1vw, 24px\)/s);
  assert.match(css, /\.dashboard-contribute-hub\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /\.dashboard-recording-choice\s*{[^}]*min-height:\s*92px/s);
  assert.match(css, /\.dashboard-recording-choices\s*{[^}]*grid-auto-rows:\s*1fr/s);
  assert.match(css, /\.dashboard-recording-choice\.is-recommended\s*{[^}]*rgba\(255, 255, 255, 0\.78\)/s);
});

test("dashboard hierarchy and motion keep recording first", async () => {
  const [html, css] = await Promise.all([
    read("dashboard.html"),
    read("styles/dashboard.css"),
  ]);
  assert.ok(html.indexOf("dashboard-contribute-hub") < html.indexOf("recent-voices"));
  assert.ok(html.indexOf("recent-voices") < html.indexOf("dashboard-stat-strip"));
  assert.doesNotMatch(html, /Your contributor dashboard/);
  assert.doesNotMatch(html, /Help Pashto speech technology understand voices like yours/);
  assert.match(html, /class="dashboard-greeting-salutation">Salaam,/);
  assert.match(html, /class="dashboard-greeting-person"><span id="workspaceGreetingName">contributor<\/span>\.<\/span>/);
  assert.match(css, /dashboard-greeting-salutation[\s\S]*280ms/);
  assert.match(css, /dashboard-greeting-person[\s\S]*300ms 90ms/);
  assert.match(css, /dashboard-greeting-line[\s\S]*scaleX\(0\)/);
  assert.match(css, /dashboard-contribute-hub[\s\S]*380ms[\s\S]*cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/);
  assert.match(css, /\.dashboard-recording-choice\s*{[\s\S]*?transform 220ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?translateY\(-3px\)/);
  assert.match(css, /\.dashboard-recording-choice:focus-visible[\s\S]*?translateY\(-3px\)/);
  assert.match(css, /\.dashboard-recording-choice:focus-visible \.dashboard-choice-arrow[\s\S]*?translateX\(4px\)/);
  assert.match(css, /dashboard-stat-value-in/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?dashboard-greeting-person::after[\s\S]*?animation:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dashboard-recording-choice:hover[\s\S]*?transform:\s*none/);
});

test("dashboard replaces graph paper with scoped original embroidery", async () => {
  const css = await read("styles/dashboard.css");
  const bodyBlock = css.match(/body\.workspace-body\.dashboard-body\s*{([\s\S]*?)\n}/)?.[1] ?? "";
  assert.match(bodyBlock, /data:image\/svg\+xml/);
  assert.match(bodyBlock, /background-image:\s*[\s\S]*?radial-gradient/);
  assert.doesNotMatch(bodyBlock, /linear-gradient/);
  assert.match(css, /\.dashboard-body \.workspace-main::before,\s*\.dashboard-body \.workspace-main::after\s*{[\s\S]*?opacity:\s*0\.075/);
  assert.doesNotMatch(css, /--dashboard-border-pattern|\.dashboard-contribute-hub::after/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /@media \(max-width: 650px\)[\s\S]*?\.dashboard-body \.workspace-main::after\s*{[\s\S]*?display:\s*none/);
});

test("experimental dashboard directories are absent from production", async () => {
  for (const path of ["dashboard-v2", "dashboard-v3-cultural", "dashboard-v4-awaz-inspired"]) {
    await assert.rejects(access(new URL(path, root), constants.F_OK));
  }
});
