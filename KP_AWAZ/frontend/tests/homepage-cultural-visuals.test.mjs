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
    /<h1>Let technology hear Khyber Pakhtunkhwa\.<\/h1>/,
  );
  assert.doesNotMatch(hero, /8 languages|supported languages/i);
});


test("cultural hero image is local, accessible, and practical for the web", async () => {
  const hero = await readFile(heroUrl, "utf8");
  const sources = [
    "assets/images/qaqlasht-folk-singers-720.webp",
    "assets/images/qaqlasht-folk-singers-1440.webp",
    "assets/images/qaqlasht-folk-singers-1920.webp",
  ];

  assert.match(hero, /<picture>/);
  assert.match(hero, /srcset="assets\/images\/qaqlasht-folk-singers-720\.webp"/);
  assert.match(hero, /qaqlasht-folk-singers-720\.webp 720w/);
  assert.match(hero, /qaqlasht-folk-singers-1440\.webp 1440w/);
  assert.match(hero, /qaqlasht-folk-singers-1920\.webp 1920w/);
  assert.match(hero, /sizes="\(max-width: 680px\) min\(92vw, 430px\), \(max-width: 900px\) 520px, 510px"/);
  assert.match(hero, /width="1920"\s+height="2400"/);
  assert.match(
    hero,
    /alt="Folk singers gather on a hillside at the Qaqlasht Festival in Upper Chitral\."/,
  );
  assert.match(hero, /decoding="async"/);
  assert.match(hero, /fetchpriority="high"/);

  for (const source of sources) {
    const asset = await stat(new URL(`../${source}`, import.meta.url));
    assert.equal(asset.isFile(), true);
    assert.ok(asset.size > 10_000, "hero asset should not be empty");
    assert.ok(asset.size <= 900 * 1024, "hero asset should stay below 900 KiB");
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
  assert.match(heroCss, /object-position:\s*50% 64%;/);
  assert.match(responsiveCss, /\.hero-cultural-frame\s*{/);
  assert.match(responsiveCss, /object-position:\s*50% 62%;/);
  assert.match(responsiveCss, /object-position:\s*center 65%;/);

  const legacyNames = /art-frame|art-sun|sound-core|mountain-front|wave-line/;
  assert.doesNotMatch(hero, legacyNames);
  assert.doesNotMatch(heroCss, legacyNames);
  assert.doesNotMatch(responsiveCss, legacyNames);
});


test("documented photo provenance matches the local hero asset", async () => {
  const credit = await readFile(
    new URL("../../docs/image-credits.md", import.meta.url),
    "utf8",
  );

  assert.match(credit, /Folk singers gathered on a hillside/);
  assert.match(credit, /aeledroos/);
  assert.match(credit, /Upper Chitral/);
  assert.match(credit, /Wikimedia Commons/);
  assert.match(credit, /CC BY-SA 3\.0/);
  assert.match(credit, /qaqlasht-folk-singers-1920\.webp/);
  assert.doesNotMatch(credit, /Lower Dir|USAID Pakistan/);
});
