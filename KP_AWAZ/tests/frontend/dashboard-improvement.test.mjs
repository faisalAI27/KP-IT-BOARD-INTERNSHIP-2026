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
  const choices = html.match(/class="[^"]*\bdashboard-recording-choice\b[^"]*"/g) ?? [];
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
  assert.equal((html.match(/>\s*Submit recording\s*</g) ?? []).length, 1);
  assert.doesNotMatch(html, /checkbox|consent-check|I agree/i);
  assert.match(source, /ACCOUNT_POLICY_SUBMISSION_BLOCK_MESSAGE/);
  assert.doesNotMatch(source, /consentGiven\s*:\s*true/);
  assert.match(source, /profile\.displayName/);
  assert.doesNotMatch(source, /openRecorder|openRecordingDisclosure|recordSoundForm/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /min-height:\s*44px/);
});

test("guided reading uses one enhanced microphone without the long-form disclosure", async () => {
  const [html, css, micCss, contributionSource, recorderSource, visualizerSource] = await Promise.all([
    read("sections/contribution.html"),
    read("styles/contribution.css"),
    read("styles/mic-enhanced-template.css"),
    read("scripts/modules/contributions.js"),
    read("scripts/modules/recorder.js"),
    read("scripts/modules/audio-visualizer.js"),
  ]);
  assert.match(html, /id="providedSentence"[^>]*lang="ps"[^>]*dir="rtl"[^>]*tabindex="0"/);
  assert.equal((html.match(/class="rabab-icon"/g) ?? []).length, 0);
  assert.equal((html.match(/class="icon-mic"/g) ?? []).length, 1);
  assert.equal((html.match(/class="icon-stop"/g) ?? []).length, 1);
  assert.equal((html.match(/class="icon-play"/g) ?? []).length, 1);
  assert.match(html, /id="donateRecCallout">Tap once to record/);
  assert.doesNotMatch(html, /openRecCallout|open-recording-disclosure|longer story/);
  assert.doesNotMatch(contributionSource, /openRecorder|openRecordingDisclosure|recordSoundForm/);
  assert.match(contributionSource, /className = "pashto-word"/);
  assert.match(contributionSource, /document\.createTextNode\(token\.text\)/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?scale\(1\.08\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pashto-word:hover[\s\S]*?transform:\s*none/);
  assert.match(micCss, /@keyframes mic-cultural-thread-flow/);
  assert.match(micCss, /\.mic-enhanced-card \.cultural-threads\s*{[\s\S]*?animation:\s*mic-cultural-thread-flow 7s linear infinite/);
  assert.match(micCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.mic-enhanced-card \.cultural-threads\s*{[\s\S]*?animation:\s*none !important/);
  assert.match(recorderSource, /previewOnReady/);
  assert.match(visualizerSource, /createMediaStreamSource\(stream\)/);
  assert.match(visualizerSource, /onLevel/);
});

test("record voice implements the supplied enhanced microphone template and motion", async () => {
  const [page, html, css, source, presenterSource, recorderSource] = await Promise.all([
    read("contribute.html"),
    read("sections/contribution.html"),
    read("styles/mic-enhanced-template.css"),
    read("scripts/modules/contributions.js"),
    read("scripts/modules/mic-enhanced-template.js"),
    read("scripts/modules/recorder.js"),
  ]);
  assert.match(page, /styles\/mic-enhanced-template\.css\?v=20260723-record-weave/);
  assert.match(page, /scripts\/contribute-page-app\.js\?v=20260723-record-weave/);
  assert.doesNotMatch(page, /contribute-page-header|Your contributor journey|Record your voice\.|My recordings/);
  assert.match(html, /class="voice-card glass-card mic-enhanced-card reveal tilt"/);
  assert.match(html, /Today’s voice mission/);
  assert.match(html, /Keep one piece of<br \/><em>Pashto alive\.<\/em>/);
  assert.match(html, /class="record-stage" id="donateRecordStage"/);
  assert.match(html, /class="mic-console"/);
  assert.match(html, /class="mic-orbit"/);
  assert.match(html, /class="mic-orbit-inner"/);
  assert.equal((html.match(/class="pulse-ring (?:one|two|three)"/g) ?? []).length, 3);
  assert.match(html, /<ol class="journey"[^>]*aria-label="Recording progress"/);
  assert.equal((html.match(/data-recording-step="[123]"/g) ?? []).length, 3);
  assert.match(html, /Submit &amp; earn XP/);
  assert.match(html, /id="donateXpFloat"[^>]*>\+20 XP</);
  assert.match(html, /id="donateSignalVisualizer"/);
  assert.match(html, /id="donateWaveform"/);
  assert.match(html, /id="donateRecBtn"/);
  assert.match(html, /id="submitDonation"/);
  assert.doesNotMatch(html, /Want to share a longer story instead\?|open-recording-disclosure|openRecBtn/);
  assert.doesNotMatch(html, /community voices|themeToggle|sidebarRecord/i);
  assert.match(source, /initMicEnhancedTemplate/);
  assert.match(source, /previewOnReady:\s*true/);
  assert.match(source, /onLevel:\s*micEnhancedPresenter\.setSignalLevel/);
  assert.doesNotMatch(source, /openRecorder|openRecordingDisclosure|recordSoundForm/);
  assert.match(presenterSource, /SIGNAL_BAR_COUNT = 44/);
  assert.match(presenterSource, /contains\("ready"\)/);
  assert.match(presenterSource, /contains\("recording"\)/);
  assert.match(presenterSource, /--spot-x/);
  assert.match(presenterSource, /perspective\(900px\)/);
  assert.match(presenterSource, /for \(let index = 0; index < 26; index \+= 1\)/);
  assert.match(recorderSource, /previewOnReady && audioBlob/);
  assert.match(recorderSource, /playback\.play\?\.\(\)/);
  assert.match(recorderSource, /classList\.add\("playing"\)/);
  assert.match(css, /@keyframes mic-breathe/);
  assert.match(css, /@keyframes mic-orbit-rotate/);
  assert.match(css, /@keyframes mic-ripple-out/);
  assert.match(css, /@keyframes mic-record-glow/);
  assert.match(css, /@keyframes mic-play-glow/);
  assert.match(css, /@keyframes mic-level-wave/);
  assert.match(css, /\.mic-enhanced-card\.recording \.pulse-ring/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?grid-template-columns:\s*118px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:\s*0\.01ms\s*!important/);
});

test("dashboard implements the supplied refined contribution surface", async () => {
  const [html, css] = await Promise.all([
    read("dashboard.html"),
    read("styles/dashboard.css"),
  ]);
  assert.match(html, /class="workspace-body dashboard-body"/);
  assert.match(html, /Choose how you want to [\s\S]*share your voice/);
  assert.match(html, /Read a provided Pashto sentence or contribute the words you naturally use\./);
  assert.match(html, /dashboard-colorflow-shell dashboard-contribute-hub/);
  assert.match(css, /\.dashboard-colorflow-shell\s*{[\s\S]*?background:\s*rgba\(255, 255, 255, 0\.76\)/);
  assert.match(css, /\.dashboard-colorflow-shell::before\s*{[\s\S]*?height:\s*6px[\s\S]*?repeating-linear-gradient/);
  assert.match(css, /\.dashboard-colorflow-shell::after\s*{[\s\S]*?display:\s*none/);
  assert.match(css, /\.dashboard-recording-choice\s*{[\s\S]*?min-height:\s*116px/);
  assert.match(css, /\.dashboard-recording-choices\s*{[^}]*grid-auto-rows:\s*1fr/s);
  assert.match(css, /\.dashboard-flow-text\s*{[\s\S]*?color:\s*inherit/);
  assert.doesNotMatch(css, /dashboard-(?:border-flow|text-flow|corner-drift)/);
});

test("dashboard hierarchy and restrained interactions keep recording first", async () => {
  const [html, css, source, presenter] = await Promise.all([
    read("dashboard.html"),
    read("styles/dashboard.css"),
    read("scripts/dashboard-app.js"),
    read("scripts/modules/dashboard-colorflow.js"),
  ]);
  assert.ok(html.indexOf("dashboard-contribute-hub") < html.indexOf("recent-voices"));
  assert.ok(html.indexOf("recent-voices") < html.indexOf("dashboard-summary-section"));
  assert.doesNotMatch(html, /Your contributor dashboard/);
  assert.doesNotMatch(html, /Help Pashto speech technology understand voices like yours/);
  assert.match(html, /class="dashboard-greeting-salutation">Salaam,/);
  assert.match(html, /class="dashboard-greeting-person"><span id="workspaceGreetingName">contributor<\/span>\.<\/span>/);
  assert.match(css, /\.dashboard-greeting-person\s*{[\s\S]*?color:\s*var\(--dashboard-terracotta\)/);
  assert.match(css, /\.dashboard-recording-choice:hover,[\s\S]*?translateY\(-3px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dashboard-recording-choice:hover[\s\S]*?transform:\s*none/);
  assert.match(source, /animateDashboardCounter/);
  assert.match(source, /initDashboardColorflow/);
  assert.match(presenter, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /@keyframes|perspective\(900px\)/);
  assert.doesNotMatch(presenter, /--dashboard-(?:tilt|glow)-/);
});

test("dashboard carries the supplied grid and static woven corner", async () => {
  const css = await read("styles/dashboard.css");
  const bodyBlock = css.match(/body\.workspace-body\.dashboard-body\s*{([\s\S]*?)\n}/)?.[1] ?? "";
  assert.match(bodyBlock, /background-image:\s*[\s\S]*?linear-gradient[\s\S]*?radial-gradient/);
  assert.match(bodyBlock, /background-size:\s*48px 48px, 48px 48px, auto/);
  assert.match(css, /\.dashboard-colorflow-corner\s*{[\s\S]*?pointer-events:\s*none/);
  assert.doesNotMatch(css, /\.dashboard-colorflow-corner\s*{[^}]*animation:/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.dashboard-colorflow-corner\s*{[\s\S]*?opacity:\s*0\.08/);
});

test("experimental dashboard directories are absent from production", async () => {
  for (const path of ["dashboard-v2", "dashboard-v3-cultural", "dashboard-v4-awaz-inspired"]) {
    await assert.rejects(access(new URL(path, root), constants.F_OK));
  }
});
