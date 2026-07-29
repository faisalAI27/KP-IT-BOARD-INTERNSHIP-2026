import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  VOICE_DEMO_DURATION_MS,
  VOICE_DEMO_STATE_COPY,
  VOICE_DEMO_WAVEFORM,
  VOICE_DEMO_WORD_TIMINGS,
  VoiceDemo,
  voiceWordState,
} from "../scripts/modules/voice-demo.js";


const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");


test("voice sample is inserted directly between the hero and Why it matters", async () => {
  const index = await read("index.html");
  const heroIndex = index.indexOf('data-partial="sections/hero.html"');
  const demoIndex = index.indexOf('data-partial="sections/voice-demo.html"');
  const whyIndex = index.indexOf('data-partial="sections/why-it-matters.html"');

  assert.ok(heroIndex >= 0);
  assert.ok(demoIndex > heroIndex);
  assert.ok(whyIndex > demoIndex);
});


test("voice sample has accurate Pashto, honest copy, and accessible controls", async () => {
  const demo = await read("sections/voice-demo.html");
  const words = [...demo.matchAll(/<span data-voice-word>([^<]+)<\/span>/g)]
    .map((match) => match[1]);

  assert.match(demo, /lang="ps"\s+dir="rtl"/);
  assert.deepEqual(words, ["زموږ", "غږ", "زموږ", "راتلونکی", "دی"]);
  assert.match(demo, /Zamung ghag zamung ratlonkay dey\./);
  assert.match(demo, /Our voice is our future\./);
  assert.match(demo, /Visual sample/);
  assert.match(demo, /does not play audio, record your microphone or use speech recognition/);
  assert.match(demo, /role="progressbar"/);
  assert.match(demo, /aria-valuemin="0"/);
  assert.match(demo, /aria-valuemax="100"/);
  assert.match(demo, /aria-valuenow="0"/);
  assert.match(
    demo,
    /<button[\s\S]*class="voice-demo-wave-control"[\s\S]*type="button"[\s\S]*aria-label="Play visual sentence sample"[\s\S]*aria-pressed="false"/,
  );
  assert.match(
    demo,
    /class="voice-demo-language-toggle"[\s\S]*aria-label="Show Roman Pashto"[\s\S]*aria-pressed="false"[\s\S]*data-voice-language-toggle/,
  );
  assert.match(
    demo,
    /data-voice-script-face[\s\S]*aria-hidden="true"[\s\S]*data-voice-roman-face/,
  );
  assert.match(
    demo,
    /<button[\s\S]*class="voice-demo-wave" aria-hidden="true" data-voice-wave[\s\S]*<\/button>/,
  );
  assert.match(demo, /Tap the wave to see the sentence flow/);
  assert.doesNotMatch(demo, /class="btn voice-demo-control"|Play visual sample/);
  assert.doesNotMatch(demo, /<audio|autoplay|getUserMedia|MediaRecorder/i);
});


test("language toggle swaps accessible faces without changing waveform state", () => {
  const attributes = () => {
    const values = new Map();
    return {
      textContent: "",
      setAttribute(name, value) {
        values.set(name, value);
      },
      getAttribute(name) {
        return values.get(name);
      },
    };
  };
  const toggle = attributes();
  const scriptFace = attributes();
  const romanFace = attributes();
  const languageHint = attributes();
  const words = Array.from({ length: 5 }, attributes);
  const elements = new Map([
    ["[data-voice-language-toggle]", toggle],
    ["[data-voice-script-face]", scriptFace],
    ["[data-voice-roman-face]", romanFace],
    ["[data-voice-language-hint]", languageHint],
  ]);
  const rootElement = {
    dataset: { voiceLanguage: "script", voiceState: "playing" },
    querySelectorAll(selector) {
      return selector === "[data-voice-script-face] [data-voice-word]" ? words : [];
    },
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },
  };
  const voiceDemo = new VoiceDemo(rootElement, {
    motionQuery: { matches: false },
  });

  assert.equal(voiceDemo.words.length, 5);
  voiceDemo.setLanguage("script");
  voiceDemo.handleLanguageToggle();

  assert.equal(rootElement.dataset.voiceLanguage, "roman");
  assert.equal(rootElement.dataset.voiceState, "playing");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(toggle.getAttribute("aria-label"), "Show Pashto script");
  assert.equal(scriptFace.getAttribute("aria-hidden"), "true");
  assert.equal(romanFace.getAttribute("aria-hidden"), "false");
  assert.equal(languageHint.textContent, "Tap to show Pashto script");

  voiceDemo.handleLanguageToggle();
  assert.equal(rootElement.dataset.voiceLanguage, "script");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.getAttribute("aria-label"), "Show Roman Pashto");
});


test("word alignment data produces one current word and preserves completed words", () => {
  assert.equal(VOICE_DEMO_WORD_TIMINGS.length, 5);
  assert.equal(VOICE_DEMO_WORD_TIMINGS[0].start, 0);
  assert.ok(VOICE_DEMO_WORD_TIMINGS.at(-1).end < VOICE_DEMO_DURATION_MS);

  const midpoint = 1600;
  const states = VOICE_DEMO_WORD_TIMINGS.map((timing) => voiceWordState(midpoint, timing));
  assert.deepEqual(states, ["completed", "completed", "current", "upcoming", "upcoming"]);
  assert.equal(states.filter((state) => state === "current").length, 1);
});


test("animation is deterministic, resumable, reduced-motion aware, and initialized by the app", async () => {
  const [source, app, css, mainCss] = await Promise.all([
    read("scripts/modules/voice-demo.js"),
    read("scripts/app.js"),
    read("styles/voice-demo.css"),
    read("styles/main.css"),
  ]);

  assert.equal(VOICE_DEMO_WAVEFORM.length, 24);
  assert.ok(new Set(VOICE_DEMO_WAVEFORM).size > 12);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /this\.startedAt = this\.now\(\) - this\.elapsedMs/);
  assert.match(source, /this\.state === "complete"/);
  assert.equal(VOICE_DEMO_STATE_COPY.idle.accessibleName, "Play visual sentence sample");
  assert.equal(VOICE_DEMO_STATE_COPY.playing.accessibleName, "Pause visual sentence sample");
  assert.equal(VOICE_DEMO_STATE_COPY.paused.accessibleName, "Resume visual sentence sample");
  assert.equal(VOICE_DEMO_STATE_COPY.complete.accessibleName, "Replay visual sentence sample");
  assert.equal(VOICE_DEMO_STATE_COPY.playing.label, "Voice in motion");
  assert.equal(VOICE_DEMO_STATE_COPY.paused.prompt, "Tap the wave to continue");
  assert.equal(VOICE_DEMO_STATE_COPY.complete.prompt, "Tap the wave to replay");
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /\[data-voice-script-face\] \[data-voice-word\]/);
  assert.match(source, /handleLanguageToggle/);
  assert.match(source, /HTMLAudioElement\.currentTime \* 1000/);
  assert.match(app, /import \{ initVoiceDemo \}/);
  assert.match(app, /voiceDemo = initVoiceDemo\(\)/);
  assert.match(app, /voiceDemo\?\.destroy\(\)/);
  assert.match(mainCss, /voice-demo\.css/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.voice-demo-wave-control\s*{[\s\S]*?min-height:\s*148px/s);
  assert.match(css, /\.voice-demo-wave-control:focus-visible/);
  assert.match(css, /\.voice-demo-language-toggle:focus-visible/);
  assert.match(css, /rotateY\(180deg\)/);
  assert.match(css, /data-voice-language="roman"/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.doesNotMatch(css, /\.voice-demo-control/);
});


test("scroll reveal is one-time, reduced-motion safe, and never autoplays", async () => {
  const [source, css] = await Promise.all([
    read("scripts/modules/voice-demo.js"),
    read("styles/voice-demo.css"),
  ]);
  const revealHandler = source.match(/handleReveal\(entries\)\s*{([\s\S]*?)\n  }/)?.[1] ?? "";
  const revealSetup = source.match(/initializeReveal\(\)\s*{([\s\S]*?)\n  }/)?.[1] ?? "";

  assert.match(source, /IntersectionObserver/);
  assert.match(source, /this\.root\.dataset\.revealReady = "true"/);
  assert.match(source, /this\.revealObserver\.observe\(this\.root\)/);
  assert.match(source, /this\.root\.classList\.add\("is-visible"\)/);
  assert.match(source, /this\.revealObserver\?\.disconnect\(\)/);
  assert.doesNotMatch(revealHandler, /\.play\(/);
  assert.doesNotMatch(revealSetup, /\.play\(/);
  assert.match(css, /\[data-reveal-ready="true"\]:not\(\.is-visible\)/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});


test("production assembler will inline the voice sample partial", async () => {
  const [index, build, demo] = await Promise.all([
    read("index.html"),
    read("tools/build.mjs"),
    read("sections/voice-demo.html"),
  ]);

  assert.match(index, /data-partial="sections\/voice-demo\.html"/);
  assert.match(build, /const partialPattern = \/<div data-partial=/);
  assert.match(build, /readFile\(resolve\(projectRoot, partialPath\)/);
  assert.match(demo, /data-voice-demo/);
});
