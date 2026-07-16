import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";


const heroUrl = new URL("../../sections/hero.html", import.meta.url);
const heroCssUrl = new URL("../../styles/hero.css", import.meta.url);
const responsiveCssUrl = new URL("../../styles/responsive.css", import.meta.url);


test("homepage uses the approved KP Awaz tagline exactly", async () => {
  const hero = await readFile(heroUrl, "utf8");

  assert.match(
    hero,
    /<h1>Our voices, our language, our Khyber Pakhtunkhwa\.<\/h1>/,
  );
  assert.doesNotMatch(hero, /Every voice|mountain(?:&rsquo;|')s memory/i);
});


test("cultural hero image is local, accessible, and practical for the web", async () => {
  const hero = await readFile(heroUrl, "utf8");
  const source = hero.match(/src="(assets\/images\/[^"]+)"/)?.[1];

  assert.equal(source, "assets/images/kp-community-voice-hero.jpg");
  assert.match(hero, /width="864"\s+height="1821"/);
  assert.match(
    hero,
    /alt="Three community members in Khyber Pakhtunkhwa record a voice together on a mountain veranda\."/,
  );
  assert.match(hero, /decoding="async"/);
  assert.match(hero, /fetchpriority="high"/);

  const asset = await stat(new URL(`../../${source}`, import.meta.url));
  assert.equal(asset.isFile(), true);
  assert.ok(asset.size > 10_000, "hero asset should not be empty");
  assert.ok(asset.size <= 750 * 1024, "hero asset should stay below 750 KiB");
});


test("hero artwork has explicit responsive crop behavior without legacy art", async () => {
  const [hero, heroCss, responsiveCss] = await Promise.all([
    readFile(heroUrl, "utf8"),
    readFile(heroCssUrl, "utf8"),
    readFile(responsiveCssUrl, "utf8"),
  ]);

  assert.match(hero, /<figure class="hero-art">/);
  assert.match(heroCss, /\.hero-cultural-frame img\s*{[^}]*object-fit:\s*cover;/s);
  assert.match(heroCss, /object-position:\s*center 54%;/);
  assert.match(responsiveCss, /\.hero-cultural-frame\s*{/);
  assert.match(responsiveCss, /object-position:\s*center 55%;/);

  const legacyNames = /art-frame|art-sun|sound-core|mountain-front|wave-line/;
  assert.doesNotMatch(hero, legacyNames);
  assert.doesNotMatch(heroCss, legacyNames);
  assert.doesNotMatch(responsiveCss, legacyNames);
});
