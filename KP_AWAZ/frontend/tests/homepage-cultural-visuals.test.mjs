import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";


const heroUrl = new URL("../sections/hero.html", import.meta.url);
const heroCssUrl = new URL("../styles/hero.css", import.meta.url);
const responsiveCssUrl = new URL("../styles/responsive.css", import.meta.url);


test("homepage uses the final public mission heading exactly", async () => {
  const hero = await readFile(heroUrl, "utf8");

  assert.match(
    hero,
    /<h1>preserving languages, empowering AI\.<\/h1>/,
  );
  assert.doesNotMatch(hero, /Let technology hear Khyber Pakhtunkhwa\./);
  assert.doesNotMatch(
    hero,
    /Community-powered voice data|Community-led|Human-reviewed|hero-principles|hero-kicker/,
  );
  assert.doesNotMatch(hero, /8 languages|supported languages/i);
});


test("cultural hero image is local, accessible, and practical for the web", async () => {
  const hero = await readFile(heroUrl, "utf8");
  const sources = [
    "assets/images/kp-awaz-cultural-gathering-720.webp",
    "assets/images/kp-awaz-cultural-gathering-1440.webp",
  ];

  assert.match(hero, /<picture>/);
  assert.match(hero, /srcset="assets\/images\/kp-awaz-cultural-gathering-720\.webp"/);
  assert.match(hero, /kp-awaz-cultural-gathering-720\.webp 720w/);
  assert.match(hero, /kp-awaz-cultural-gathering-1440\.webp 1440w/);
  assert.match(
    hero,
    /sizes="\(max-width: 680px\) min\(calc\(100vw - 32px\), 430px\), \(max-width: 900px\) 520px, 520px"/,
  );
  assert.match(hero, /width="1440"\s+height="1152"/);
  assert.match(
    hero,
    /alt="An illustrative Pashtun community gathering in a traditional courtyard, with an elder sharing a story as others listen\."/,
  );
  assert.match(hero, /decoding="async"/);
  assert.match(hero, /fetchpriority="high"/);
  assert.doesNotMatch(hero, /qaqlasht-folk-singers/);

  for (const [index, source] of sources.entries()) {
    const asset = await stat(new URL(`../${source}`, import.meta.url));
    assert.equal(asset.isFile(), true);
    assert.ok(asset.size > 10_000, "hero asset should not be empty");
    const limit = index === 0 ? 250 : 650;
    assert.ok(
      asset.size <= limit * 1024,
      `${source} should stay below ${limit} KiB`,
    );
  }
});


test("hero artwork has explicit responsive crop behavior without legacy art", async () => {
  const [hero, heroCss, responsiveCss] = await Promise.all([
    readFile(heroUrl, "utf8"),
    readFile(heroCssUrl, "utf8"),
    readFile(responsiveCssUrl, "utf8"),
  ]);

  assert.match(hero, /<figure class="hero-art">/);
  assert.match(heroCss, /\.hero-cultural-frame img\s*{[^}]*object-fit:\s*cover;/s);
  assert.match(heroCss, /object-position:\s*50% 50%;/);
  assert.match(responsiveCss, /\.hero-cultural-frame\s*{/);
  assert.match(responsiveCss, /object-position:\s*50% 49%;/);
  assert.match(responsiveCss, /object-position:\s*51% 50%;/);
  assert.match(responsiveCss, /object-position:\s*52% 50%;/);

  const legacyNames = /art-frame|art-sun|sound-core|mountain-front|wave-line/;
  assert.doesNotMatch(hero, legacyNames);
  assert.doesNotMatch(heroCss, legacyNames);
  assert.doesNotMatch(responsiveCss, legacyNames);
});


test("documented AI provenance matches the local hero asset", async () => {
  const credit = await readFile(
    new URL("../../docs/image-credits.md", import.meta.url),
    "utf8",
  );

  assert.match(credit, /AI-generated illustrative hero image/);
  assert.match(credit, /OpenAI image generation tool/);
  assert.match(credit, /29 July 2026/);
  assert.match(credit, /all depicted people are fictional/i);
  assert.match(credit, /kp-awaz-cultural-gathering-720\.webp/);
  assert.match(credit, /kp-awaz-cultural-gathering-1440\.webp/);
  assert.doesNotMatch(credit, /photographer|actual event|Wikimedia Commons/i);
});


test("hero CTA routing and contribution hook remain unchanged", async () => {
  const hero = await readFile(heroUrl, "utf8");

  assert.match(
    hero,
    /href="auth\.html\?next=contribute\.html"\s+data-start-contributing/,
  );
  assert.match(hero, /href="#why-it-matters"/);
});
