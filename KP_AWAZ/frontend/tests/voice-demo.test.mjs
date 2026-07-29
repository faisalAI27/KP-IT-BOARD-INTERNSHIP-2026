import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  VOICE_DEMO_DURATION_MS,
  VOICE_DEMO_WAVEFORM,
  VOICE_DEMO_WORD_TIMINGS,
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

  assert.match(demo, /lang="ps" dir="rtl"/);
  assert.deepEqual(words, ["زموږ", "غږ", "زموږ", "راتلونکی", "دی"]);
  assert.match(demo, /Our voice is our future\./);
  assert.match(demo, /Visual sample/);
  assert.match(demo, /does not play audio, record your microphone or use speech recognition/);
  assert.match(demo, /role="progressbar"/);
  assert.match(demo, /aria-valuemin="0"/);
  assert.match(demo, /aria-valuemax="100"/);
  assert.match(demo, /aria-valuenow="0"/);
  assert.match(demo, /class="voice-demo-wave" aria-hidden="true"/);
  assert.match(demo, /<button[\s\S]*type="button"[\s\S]*aria-pressed="false"/);
  assert.match(demo, /Play visual sample/);
  assert.doesNotMatch(demo, /<audio|autoplay|getUserMedia|MediaRecorder/i);
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
  assert.match(source, /Replay visual sample/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /HTMLAudioElement\.currentTime \* 1000/);
  assert.match(app, /import \{ initVoiceDemo \}/);
  assert.match(app, /voiceDemo = initVoiceDemo\(\)/);
  assert.match(app, /voiceDemo\?\.destroy\(\)/);
  assert.match(mainCss, /voice-demo\.css/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.voice-demo-control\s*{[\s\S]*?min-width:\s*190px/s);
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
