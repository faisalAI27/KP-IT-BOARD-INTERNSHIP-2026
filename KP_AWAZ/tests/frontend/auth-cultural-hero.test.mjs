import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";

import { AuthCulturalPanel } from "../../scripts/modules/auth-cultural-panel.js";


const projectRoot = new URL("../../", import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, projectRoot), "utf8");
const assetUrl = (name) => new URL(`assets/auth/${name}`, projectRoot);


class FakeTarget {
  constructor() {
    this.complete = false;
    this.dataset = {};
    this.listeners = new Map();
    this.naturalWidth = 0;
    this.textContent = "";
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener({ target: this });
  }
}


class FakeDocument extends FakeTarget {
  constructor() {
    super();
    this.hidden = false;
    this.elements = new Map([
      ["authCulturalMessage", new FakeTarget()],
      ["authCulturalHero", new FakeTarget()],
      ["authCulturalHeroImage", new FakeTarget()],
    ]);
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }
}


test("cultural hero uses local responsive sources and a local JPEG fallback", async () => {
  const html = await readProjectFile("auth.html");
  const figure = html.match(/<figure[\s\S]*?id="authCulturalHero"[\s\S]*?<\/figure>/)?.[0] ?? "";
  assert.match(figure, /<picture>/);
  assert.match(figure, /media="\(max-width: 900px\)"/);
  assert.match(figure, /srcset="assets\/auth\/kp-awaz-cultural-hero-mobile\.webp"/);
  assert.match(figure, /srcset="assets\/auth\/kp-awaz-cultural-hero\.webp"/);
  assert.match(figure, /src="assets\/auth\/kp-awaz-cultural-hero-fallback\.jpg"/);
  assert.doesNotMatch(figure, /https?:\/\/|data:image/);
});


test("cultural hero declares dimensions, eager decoding intent, and meaningful alternative text", async () => {
  const html = await readProjectFile("auth.html");
  assert.match(html, /id="authCulturalHeroImage"[\s\S]*?width="1600"[\s\S]*?height="2000"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /fetchpriority="high"/);
  assert.match(
    html,
    /alt="Illustration of a KP community sharing their voices as a sound wave flows from a traditional gathering toward mountain landscapes and a digital language network\."/,
  );
});


test("production hero assets are present and remain within performance budgets", async () => {
  const limits = new Map([
    ["kp-awaz-cultural-hero.webp", 500_000],
    ["kp-awaz-cultural-hero-mobile.webp", 220_000],
    ["kp-awaz-cultural-hero-fallback.jpg", 500_000],
  ]);
  for (const [name, maximumBytes] of limits) {
    const details = await stat(assetUrl(name));
    assert.equal(details.isFile(), true, name);
    assert.ok(details.size > 20_000, `${name} should contain real illustration data`);
    assert.ok(details.size < maximumBytes, `${name} exceeds its performance budget`);
  }
});


test("generated image files contain no external URL or embedded generation text", async () => {
  for (const name of [
    "kp-awaz-cultural-hero.webp",
    "kp-awaz-cultural-hero-mobile.webp",
    "kp-awaz-cultural-hero-fallback.jpg",
  ]) {
    const buffer = await readFile(assetUrl(name));
    const printable = buffer.toString("latin1");
    assert.doesNotMatch(printable, /https?:\/\/|www\.|openai|prompt|password|access[_-]?token/i);
  }
});


test("generated illustration contains no controls and cannot enter keyboard order", async () => {
  const html = await readProjectFile("auth.html");
  const figure = html.match(/<figure[\s\S]*?id="authCulturalHero"[\s\S]*?<\/figure>/)?.[0] ?? "";
  assert.doesNotMatch(figure, /<(?:button|input|select|textarea|a)\b/i);
  assert.doesNotMatch(figure, /tabindex=/i);
  assert.ok(html.indexOf("authCulturalHero") < html.indexOf("accountInteractiveContent"));
});


test("decorative fallback and ambient layers are hidden from screen readers", async () => {
  const html = await readProjectFile("auth.html");
  assert.match(html, /class="cultural-hero-fallback" aria-hidden="true"/);
  assert.match(html, /class="cultural-hero-glow" aria-hidden="true"/);
  assert.match(html, /src="assets\/images\/kp-auth-mountain-voice\.svg" alt=""/);
});


test("cultural copy explains voice, mission, journey, and review accurately", async () => {
  const html = await readProjectFile("auth.html");
  assert.match(html, /Our voices belong in the digital future\./);
  assert.match(html, /Help preserve the languages, expressions and stories of Khyber\s+Pakhtunkhwa by contributing your voice\./);
  assert.match(html, /Every language carries a community/);
  assert.match(html, /<strong>Speak<\/strong>[\s\S]*?<strong>Review<\/strong>[\s\S]*?<strong>Preserve<\/strong>/);
  assert.match(html, /Recordings remain pending until review before joining the community dataset\./);
});


test("image failure changes only the hero to its CSS fallback state", () => {
  const root = new FakeDocument();
  const hero = root.getElementById("authCulturalHero");
  const image = root.getElementById("authCulturalHeroImage");
  const panel = new AuthCulturalPanel({
    root,
    matchMediaImpl: () => ({ matches: false }),
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
  });
  assert.equal(panel.initialize(), true);
  assert.equal(hero.dataset.heroState, "loading");
  assert.equal(hero.dataset.ambientState, "running");
  image.dispatch("error");
  assert.equal(hero.dataset.heroState, "fallback");
  assert.equal(root.getElementById("authCulturalMessage").textContent.length > 0, true);
  panel.destroy();
});


test("successful hero load replaces fallback without changing authentication layout", () => {
  const root = new FakeDocument();
  const hero = root.getElementById("authCulturalHero");
  const image = root.getElementById("authCulturalHeroImage");
  const panel = new AuthCulturalPanel({
    root,
    matchMediaImpl: () => ({ matches: false }),
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
  });
  panel.initialize();
  image.naturalWidth = 1600;
  image.dispatch("load");
  assert.equal(hero.dataset.heroState, "loaded");
  panel.destroy();
});


test("ambient hero movement pauses when hidden and stops when destroyed", () => {
  const root = new FakeDocument();
  let cleared = 0;
  const panel = new AuthCulturalPanel({
    root,
    matchMediaImpl: () => ({ matches: false }),
    setIntervalImpl: () => 7,
    clearIntervalImpl() {
      cleared += 1;
    },
  });
  panel.initialize();
  const hero = root.getElementById("authCulturalHero");
  root.hidden = true;
  root.dispatch("visibilitychange");
  assert.equal(hero.dataset.ambientState, "paused");
  root.hidden = false;
  root.dispatch("visibilitychange");
  assert.equal(hero.dataset.ambientState, "running");
  panel.destroy();
  assert.equal(hero.dataset.ambientState, "paused");
  assert.ok(cleared >= 1);
  assert.equal(root.getElementById("authCulturalHeroImage").listeners.get("error")?.size ?? 0, 0);
});


test("reduced motion keeps the hero static and CSS preserves the mobile crop", async () => {
  const root = new FakeDocument();
  let intervalCalls = 0;
  const panel = new AuthCulturalPanel({
    root,
    matchMediaImpl: () => ({ matches: true }),
    setIntervalImpl() {
      intervalCalls += 1;
      return 1;
    },
  });
  panel.initialize();
  assert.equal(intervalCalls, 0);
  assert.equal(root.getElementById("authCulturalHero").dataset.ambientState, "paused");

  const css = await readProjectFile("styles/auth-page.css");
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.cultural-hero\s*\{[\s\S]*?aspect-ratio: 14 \/ 9;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.cultural-hero-glow::before\s*\{[\s\S]*?animation: none/);
  assert.match(css, /overflow-x: hidden/);
  panel.destroy();
});


test("hero dimensions are independent from sign-in, create, and OTP state selectors", async () => {
  const css = await readProjectFile("styles/auth-page.css");
  const heroRules = [...css.matchAll(/\.cultural-hero[^\{]*\{([^}]*)\}/g)].map((match) => match[1]).join("\n");
  assert.match(heroRules, /height: var\(--auth-hero-height\)|aspect-ratio: 14 \/ 9/);
  assert.doesNotMatch(heroRules, /data-auth-view|passwordSignInPanel|createAccountPanel|accountOtpStep/);
});
