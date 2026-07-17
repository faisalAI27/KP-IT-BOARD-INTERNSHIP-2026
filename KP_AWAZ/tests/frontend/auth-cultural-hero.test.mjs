import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";

import { AuthCulturalPanel } from "../../scripts/modules/auth-cultural-panel.js";


const projectRoot = new URL("../../", import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, projectRoot), "utf8");
const assetUrl = (name) => new URL(`assets/auth/${name}`, projectRoot);
const brandAssetUrl = (name) => new URL(`assets/brands/${name}`, projectRoot);


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


test("full-page cultural background uses local desktop, mobile, and JPEG sources", async () => {
  const html = await readProjectFile("auth.html");
  const figure = html.match(/<figure[\s\S]*?id="authCulturalHero"[\s\S]*?<\/figure>/)?.[0] ?? "";
  assert.match(figure, /<picture>/);
  assert.match(figure, /media="\(max-width: 620px\)"/);
  assert.match(figure, /srcset="assets\/auth\/kp-awaz-auth-background-mobile\.webp"/);
  assert.match(figure, /srcset="assets\/auth\/kp-awaz-auth-background\.webp"/);
  assert.match(figure, /src="assets\/auth\/kp-awaz-auth-background-fallback\.jpg"/);
  assert.doesNotMatch(figure, /https?:\/\/|data:image/);
});


test("Google button uses the local official multicolor mark instead of styled text", async () => {
  const [html, css, details] = await Promise.all([
    readProjectFile("auth.html"),
    readProjectFile("styles/auth-page.css"),
    stat(brandAssetUrl("google-g-logo.png")),
  ]);
  assert.match(
    html,
    /class="google-mark"[\s\S]*?src="assets\/brands\/google-g-logo\.png"[\s\S]*?width="20"[\s\S]*?height="20"[\s\S]*?alt=""/,
  );
  assert.equal(details.isFile(), true);
  assert.ok(details.size > 1_000);
  assert.doesNotMatch(html, /class="google-mark"[^>]*>\s*G\s*</);
  assert.doesNotMatch(css, /\.google-mark\s*\{[^}]*conic-gradient/);
});


test("decorative background declares dimensions and never duplicates screen-reader content", async () => {
  const html = await readProjectFile("auth.html");
  assert.match(html, /id="authCulturalHero"[\s\S]*?aria-hidden="true"/);
  assert.match(html, /id="authCulturalHeroImage"[\s\S]*?width="1672"[\s\S]*?height="941"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /fetchpriority="high"/);
  assert.match(html, /id="authCulturalHeroImage"[\s\S]*?alt=""/);
});


test("production hero assets are present and remain within performance budgets", async () => {
  const limits = new Map([
    ["kp-awaz-auth-background.webp", 300_000],
    ["kp-awaz-auth-background-mobile.webp", 240_000],
    ["kp-awaz-auth-background-fallback.jpg", 350_000],
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
    "kp-awaz-auth-background.webp",
    "kp-awaz-auth-background-mobile.webp",
    "kp-awaz-auth-background-fallback.jpg",
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


test("CSS fallback and full background stay outside the accessibility tree", async () => {
  const html = await readProjectFile("auth.html");
  assert.match(html, /class="cultural-hero-fallback" aria-hidden="true"/);
  assert.match(html, /class="access-background-overlay" aria-hidden="true"/);
  assert.doesNotMatch(html, /cultural-hero-glow/);
});


test("centered page keeps the cultural mission in concise real HTML", async () => {
  const html = await readProjectFile("auth.html");
  assert.match(html, /Our voices belong in the digital future\./);
  assert.match(html, /Our voices, our language, our Khyber Pakhtunkhwa\./);
  assert.match(html, /Every voice carries a story\. Every language carries a community\./);
  assert.doesNotMatch(html, /class="access-story"|class="story-impact"/);
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


test("reduced motion keeps the background static and CSS preserves the mobile source", async () => {
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
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /cultural-voice-glow|parallax|pointermove/);
  assert.match(css, /overflow-x: hidden/);
  panel.destroy();
});


test("background dimensions are independent from sign-in, create, and OTP state selectors", async () => {
  const css = await readProjectFile("styles/auth-page.css");
  const heroRules = [...css.matchAll(/\.cultural-hero[^\{]*\{([^}]*)\}/g)].map((match) => match[1]).join("\n");
  assert.match(heroRules, /position: fixed|inset: 0|height: 100%/);
  assert.doesNotMatch(heroRules, /data-auth-view|passwordSignInPanel|createAccountPanel|accountOtpStep/);
});
