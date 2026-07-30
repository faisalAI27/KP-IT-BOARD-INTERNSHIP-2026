import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { test } from "node:test";

import {
  createSentenceLanguageToggle,
  DEMO_PASHTO_SENTENCE,
  getSentenceLanguageView,
  normalizeContributionMode,
  tokenizeSentenceWords,
} from "../scripts/modules/contributions.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("dashboard presents exactly two direct recording choices", async () => {
  const html = await read("dashboard.html");
  const choices = html.match(/class="[^"]*\bdashboard-recording-choice\b[^"]*"/g) ?? [];
  assert.equal(choices.length, 2);
  assert.match(html, /contribute\.html\?mode=guided/);
  assert.match(html, /donate-text\.html/);
  assert.doesNotMatch(html, /leaderboard preview|voice-orbit|profile-compass|rejected count/i);
});

test("dashboard controls use font-independent icons instead of text glyphs", async () => {
  const [html, sidebar, source, dashboardCss, workspaceCss] = await Promise.all([
    read("dashboard.html"),
    read("sections/workspace-sidebar.html"),
    read("scripts/dashboard-app.js"),
    read("styles/dashboard.css"),
    read("styles/workspace.css"),
  ]);

  assert.doesNotMatch(html, />\s*(?:→|✓|···)\s*</);
  assert.doesNotMatch(sidebar, />\s*→\s*</);
  assert.doesNotMatch(source, /mark\.textContent\s*=\s*safeStatus/);
  assert.match(source, /document\.createElementNS\(namespace, "svg"\)/);
  assert.match(html, /class="dashboard-text-link-icon"[\s\S]*?<svg/);
  assert.match(html, /class="dashboard-stat-mark"[\s\S]*?<svg/);
  assert.match(sidebar, /class="workspace-nav-arrow"[\s\S]*?<svg/);
  assert.match(sidebar, /class="workspace-sign-out-icon"[\s\S]*?<svg/);
  assert.match(dashboardCss, /\.dashboard-mini-icon svg,[\s\S]*?stroke:\s*currentColor/);
  assert.match(dashboardCss, /\.dashboard-stat-card strong\s*{[\s\S]*?font-family:\s*var\(--font-ui\)/);
  assert.match(workspaceCss, /\.workspace-nav-arrow svg,[\s\S]*?stroke:\s*currentColor/);
});

test("recording route mode is predictable and safe", () => {
  assert.equal(normalizeContributionMode("?mode=guided"), "guided");
  assert.equal(normalizeContributionMode("?mode=custom"), "guided");
  assert.equal(normalizeContributionMode("mode=custom"), "guided");
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

test("recording sentence language view exposes predictable accessible flip state", () => {
  assert.deepEqual(getSentenceLanguageView("script"), {
    language: "script",
    showRoman: false,
    accessibleName: "Show Roman Pashto",
    hint: "Tap to show Roman Pashto",
  });
  assert.deepEqual(getSentenceLanguageView("roman"), {
    language: "roman",
    showRoman: true,
    accessibleName: "Show Pashto script",
    hint: "Tap to show Pashto script",
  });
  assert.deepEqual(getSentenceLanguageView("unexpected"), getSentenceLanguageView("script"));
});

test("recording sentence flip synchronizes visible and accessible language state", () => {
  const element = () => {
    const attributes = new Map();
    const listeners = new Map();
    return {
      dataset: {},
      textContent: "",
      setAttribute(name, value) {
        attributes.set(name, value);
      },
      getAttribute(name) {
        return attributes.get(name);
      },
      addEventListener(name, listener) {
        listeners.set(name, listener);
      },
      removeEventListener(name, listener) {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
      dispatch(name) {
        listeners.get(name)?.();
      },
    };
  };
  const source = element();
  source.dataset.sentenceLanguage = "script";
  const toggle = element();
  const scriptFace = element();
  const romanFace = element();
  const hint = element();
  const controller = createSentenceLanguageToggle({
    source,
    toggle,
    scriptFace,
    romanFace,
    hint,
  });

  toggle.dispatch("click");
  assert.equal(source.dataset.sentenceLanguage, "roman");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(toggle.getAttribute("aria-label"), "Show Pashto script");
  assert.equal(toggle.getAttribute("aria-describedby"), "providedRoman");
  assert.equal(scriptFace.getAttribute("aria-hidden"), "true");
  assert.equal(romanFace.getAttribute("aria-hidden"), "false");
  assert.equal(hint.textContent, "Tap to show Pashto script");

  controller.destroy();
  toggle.dispatch("click");
  assert.equal(source.dataset.sentenceLanguage, "roman");
});

test("guided recording keeps a Pashto preview visible when live prompts are unavailable", async () => {
  const source = await read("scripts/modules/contributions.js");
  assert.equal(
    DEMO_PASHTO_SENTENCE,
    "زما ژبه زما پېژندنه ده، او زما غږ د هغې راتلونکی جوړوي.",
  );
  assert.match(source, /replaceProvidedSentenceText\(DEMO_PASHTO_SENTENCE\)/);
  assert.match(source, /sentenceNumber\.textContent = "Preview sentence"/);
  assert.match(source, /sentencePromptsReady = false/);
});

test("focused contribution flow keeps profile fields hidden and uses account consent", async () => {
  const [html, source, css] = await Promise.all([
    read("sections/contribution.html"),
    read("scripts/modules/contributions.js"),
    read("styles/rabab-recorder.css"),
  ]);
  assert.match(html, /id="donor-name"[\s\S]*type="hidden"/);
  assert.match(html, /id="donor-language"[\s\S]*type="hidden"/);
  assert.doesNotMatch(html, /Step [123] of 3|Continue to recording|Continue to review/);
  assert.equal((html.match(/>\s*Submit recording\s*</g) ?? []).length, 1);
  assert.match(html, /id="accountConsentCheckbox"/);
  assert.match(source, /acceptMyCurrentPolicy\(CONSENT_POLICY_VERSION\)/);
  assert.match(source, /consentGiven:\s*true/);
  assert.match(source, /profile\.displayName/);
  assert.doesNotMatch(source, /openRecorder|openRecordingDisclosure|recordSoundForm/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /min-height:\s*44px/);
});

test("guided reading uses one focused microphone without the long-form disclosure", async () => {
  const [html, css, micCss, contributionSource, recorderSource, visualizerSource] = await Promise.all([
    read("sections/contribution.html"),
    read("styles/rabab-recorder.css"),
    read("styles/rabab-recorder.css"),
    read("scripts/modules/contributions.js"),
    read("scripts/modules/recorder.js"),
    read("scripts/modules/audio-visualizer.js"),
  ]);
  assert.match(html, /lang="ps"\s+dir="rtl"[^>]*data-provided-script-face/);
  assert.match(html, /lang="ps-Latn"\s+dir="ltr"[^>]*data-provided-roman-face/);
  assert.match(contributionSource, /sentence\?\.romanText \?\? DEMO_ROMAN_PASHTO/);
  assert.match(html, /class="focused-record-orb rabab-record-button"/);
  assert.match(html, /<rect x="9" y="3" width="6" height="11" rx="3"><\/rect>/);
  assert.match(html, /id="donateRecCallout">Tap once to record<\/h2>/);
  assert.doesNotMatch(html, /<textarea|Your Pashto sentence|خپله جمله دلته ولیکئ/);
  assert.match(html, /Read this reviewed sentence aloud/);
  assert.doesNotMatch(html, /openRecCallout|open-recording-disclosure|longer story/);
  assert.doesNotMatch(contributionSource, /openRecorder|openRecordingDisclosure|recordSoundForm/);
  assert.match(contributionSource, /className = "pashto-word"/);
  assert.match(contributionSource, /document\.createTextNode\(token\.text\)/);
  assert.match(css, /\.focused-pashto-sentence \.pashto-word:hover\s*{[\s\S]*?scale\(1\.08\)/);
  assert.match(html, /id="providedSentenceToggle"[\s\S]*aria-label="Show Roman Pashto"[\s\S]*aria-describedby="providedSentence"[\s\S]*aria-pressed="false"/);
  assert.match(contributionSource, /setProvidedSentenceLanguage/);
  assert.match(contributionSource, /toggle\.addEventListener\("click", handleToggle\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(html, /focused-cultural-thread/);
  assert.doesNotMatch(micCss, /focused-cultural-thread|focused-thread-flow/);
  assert.match(micCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:\s*0\.01ms\s*!important/);
  assert.match(recorderSource, /previewOnReady/);
  assert.match(visualizerSource, /createMediaStreamSource\(stream\)/);
  assert.match(visualizerSource, /onLevel/);
});

test("record voice implements the supplied focused recorder template and motion", async () => {
  const [page, html, css, source, presenterSource, recorderSource] = await Promise.all([
    read("contribute.html"),
    read("sections/contribution.html"),
    read("styles/rabab-recorder.css"),
    read("scripts/modules/contributions.js"),
    read("scripts/modules/rabab-recorder-template.js"),
    read("scripts/modules/recorder.js"),
  ]);
  assert.match(page, /styles\/rabab-recorder\.css\?v=20260729-soft-system/);
  assert.match(page, /scripts\/contribute-page-app\.js\?v=20260726-focused-recorder/);
  assert.doesNotMatch(page, /styles\/mic-enhanced-template\.css|styles\/contribution\.css/);
  assert.doesNotMatch(page, /donate-text/);
  assert.doesNotMatch(page, /contribute-page-header|Your contributor journey|Record your voice\.|My recordings/);
  assert.match(html, /class="focused-voice-card rabab-recorder-page" id="contribution-panel"/);
  assert.match(html, /Today’s voice mission/);
  assert.match(html, /Keep one piece of<br \/> <em>Pashto alive\.<\/em>/);
  assert.match(html, /class="focused-record-stage rabab-recorder-stage" id="donateRecordStage"/);
  assert.match(html, /class="focused-record-orb-wrap"/);
  assert.match(html, /class="focused-record-orb rabab-record-button" id="donateRecBtn"/);
  assert.equal((html.match(/class="focused-pulse-ring (?:one|two)"/g) ?? []).length, 2);
  assert.match(html, /viewBox="0 0 24 24"/);
  assert.match(html, /lang="ps"\s+dir="rtl"[^>]*data-provided-script-face/);
  assert.ok(html.indexOf("providedSentenceSource") < html.indexOf("donateRecordStage"));
  assert.match(html, /<ol class="focused-journey rabab-steps"[^>]*aria-label="Recording progress"/);
  assert.equal((html.match(/data-recording-step="[123]"/g) ?? []).length, 3);
  assert.match(html, /Review &amp; submit/);
  assert.match(html, /id="donateXpFloat"[^>]*>\+20 XP</);
  assert.match(html, /id="donateWaveform"/);
  assert.match(html, /id="donateRecBtn"/);
  assert.match(html, /id="submitDonation"/);
  assert.doesNotMatch(html, /Want to share a longer story instead\?|open-recording-disclosure|openRecBtn/);
  assert.doesNotMatch(html, /community voices|themeToggle|sidebarRecord/i);
  assert.match(source, /initRababRecorderTemplate/);
  assert.match(source, /previewOnReady:\s*true/);
  assert.match(source, /onLevel:\s*rababRecorderPresenter\.setSignalLevel/);
  assert.doesNotMatch(source, /openRecorder|openRecordingDisclosure|recordSoundForm/);
  assert.match(presenterSource, /initRababRecorderTemplate/);
  assert.match(presenterSource, /contains\("ready"\)/);
  assert.match(presenterSource, /contains\("recording"\)/);
  assert.match(presenterSource, /--spot-x/);
  assert.match(presenterSource, /for \(let index = 0; index < 22; index \+= 1\)/);
  assert.match(recorderSource, /previewOnReady && audioBlob/);
  assert.match(recorderSource, /playback\.play\?\.\(\)/);
  assert.match(recorderSource, /classList\.add\("playing"\)/);
  assert.match(css, /@keyframes focused-ring-pulse/);
  assert.match(css, /@keyframes focused-orb-pulse/);
  assert.match(css, /\.focused-record-orb:hover:not\(:disabled\)\s*{/);
  assert.match(css, /\.focused-sentence-language-toggle:hover \.focused-pashto-sentence,[\s\S]*?scale\(1\.018\)/);
  assert.match(css, /data-sentence-language="roman"[\s\S]*?rotateY\(180deg\)/);
  assert.match(css, /\.focused-sentence-language-toggle:focus-visible/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.focused-sentence-language-inner/);
  assert.match(css, /@keyframes focused-shimmer/);
  assert.doesNotMatch(css, /focused-cultural-thread|focused-thread-flow/);
  assert.match(css, /\.focused-record-stage\.is-recording/);
  assert.match(css, /@media \(max-width: 460px\)[\s\S]*?\.focused-record-stage\s*{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition-duration:\s*0\.01ms\s*!important/);
});

test("dashboard implements the supplied refined contribution surface", async () => {
  const [html, css] = await Promise.all([
    read("dashboard.html"),
    read("styles/dashboard.css"),
  ]);
  assert.match(html, /class="workspace-body dashboard-body"/);
  assert.match(html, /Choose how you want to [\s\S]*share your voice/);
  assert.match(html, /Record a reviewed Pashto prompt, or open the dedicated Donate Text workspace/);
  assert.match(html, /dashboard-colorflow-shell dashboard-contribute-hub/);
  assert.match(css, /\.dashboard-colorflow-shell\s*{[\s\S]*?background:\s*var\(--surface-card\)/);
  assert.match(css, /\.dashboard-colorflow-shell::before\s*{[\s\S]*?height:\s*3px[\s\S]*?linear-gradient/);
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
  const choiceHover = css.match(/\.dashboard-recording-choice:hover,[^{]+\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(choiceHover, /transform:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dashboard-recording-choice:hover[\s\S]*?transform:\s*none/);
  assert.match(source, /animateDashboardCounter/);
  assert.match(source, /initDashboardColorflow/);
  assert.match(presenter, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /@keyframes|perspective\(900px\)/);
  assert.doesNotMatch(presenter, /--dashboard-(?:tilt|glow)-/);
});

test("dashboard carries a soft ambient wash and static woven corner", async () => {
  const css = await read("styles/dashboard.css");
  const bodyBlock = css.match(/body\.workspace-body\.dashboard-body\s*{([\s\S]*?)\n}/)?.[1] ?? "";
  assert.match(bodyBlock, /background-image:\s*[\s\S]*?radial-gradient[\s\S]*?radial-gradient/);
  assert.doesNotMatch(bodyBlock, /background-size:\s*48px 48px/);
  assert.match(css, /\.dashboard-colorflow-corner\s*{[\s\S]*?pointer-events:\s*none/);
  assert.doesNotMatch(css, /\.dashboard-colorflow-corner\s*{[^}]*animation:/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.dashboard-colorflow-corner\s*{[\s\S]*?opacity:\s*0\.08/);
});

test("experimental dashboard directories are absent from production", async () => {
  for (const path of ["dashboard-v2", "dashboard-v3-cultural", "dashboard-v4-awaz-inspired"]) {
    await assert.rejects(access(new URL(path, root), constants.F_OK));
  }
});
