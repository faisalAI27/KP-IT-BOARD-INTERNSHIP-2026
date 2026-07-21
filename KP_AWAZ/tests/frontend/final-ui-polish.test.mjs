import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";


const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");


test("shared design foundation exposes the final KP AWAZ token system", async () => {
  const css = await read("styles/foundation.css");

  for (const token of [
    "--forest-deep",
    "--forest",
    "--ivory",
    "--cream",
    "--clay",
    "--gold",
    "--space-1",
    "--space-10",
    "--font-display",
    "--shadow-lg",
    "--radius-pill",
    "--ease-standard",
  ]) {
    assert.match(css, new RegExp(`${token}:`));
  }
  assert.match(css, /--paper:\s*var\(--ivory\)/);
  assert.match(css, /--terracotta:\s*var\(--clay\)/);
  assert.match(css, /--honey:\s*var\(--gold\)/);
});


test("public, contributor, and admin pages load the final polish with cache-safe URLs", async () => {
  const mainCss = await read("styles/main.css");
  assert.match(mainCss, /final-polish\.css\?v=20260720-final-polish/);
  assert.ok(
    mainCss.indexOf("final-polish.css") > mainCss.indexOf("responsive.css"),
    "public polish must load after responsive component styles",
  );

  for (const page of ["index.html", "about.html", "data-use.html", "how-it-works.html", "leaderboard.html"]) {
    const html = await read(page);
    assert.match(html, /styles\/main\.css\?v=20260720-final-polish/);
  }

  for (const page of [
    "dashboard.html",
    "contribute.html",
    "my-contributions.html",
    "profile.html",
    "settings.html",
    "admin.html",
  ]) {
    const html = await read(page);
    const stylesheets = [...html.matchAll(/href="(styles\/[^"]+\.css[^\"]*)"/g)].map((match) => match[1]);
    assert.equal(stylesheets.at(-1), "styles/final-polish.css?v=20260720-final-polish");
  }
});


test("approved authentication and recovery interfaces remain outside the polish layer", async () => {
  for (const page of ["auth.html", "forgot-password.html", "reset-password.html"]) {
    assert.doesNotMatch(await read(page), /final-polish\.css/);
  }

  const auth = await read("auth.html");
  assert.match(auth, /assets\/auth\/kp-awaz-auth-background-mobile\.webp/);
  assert.match(auth, /assets\/auth\/kp-awaz-auth-background\.webp/);
  assert.match(auth, /assets\/auth\/kp-awaz-auth-background-fallback\.jpg/);
});


test("final polish preserves approved artwork treatment and adds accessible motion safeguards", async () => {
  const [css, hero] = await Promise.all([
    read("styles/final-polish.css"),
    read("sections/hero.html"),
  ]);

  assert.match(hero, /src="assets\/images\/kp-community-voice-hero\.jpg"/);
  assert.doesNotMatch(css, /url\s*\(/i);
  assert.doesNotMatch(css, /\.hero-cultural-frame\s+img|\.cultural-hero\s+img|\.access-page\s+img/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(hover: hover\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-duration:\s*0\.01ms\s*!important/);
});


test("dashboard keeps its original deep-green surfaces without a polish override", async () => {
  const [workspaceCss, dashboardCss, polishCss] = await Promise.all([
    read("styles/workspace.css"),
    read("styles/dashboard.css"),
    read("styles/final-polish.css"),
  ]);

  assert.match(workspaceCss, /\.workspace-sidebar\s*{[\s\S]*?#173e34;[\s\S]*?}/);
  assert.match(
    dashboardCss,
    /\.voice-trail-card\s*{[\s\S]*?rgba\(22, 62, 52, 0\.98\)[\s\S]*?rgba\(31, 77, 65, 0\.94\)[\s\S]*?}/,
  );
  assert.doesNotMatch(polishCss, /\.workspace-sidebar\s*{[^}]*background(?:-color|-image)?:/s);
  assert.doesNotMatch(polishCss, /\.voice-trail-card(?:,|::after)[\s\S]*?background(?:-color|-image)?:/);
});
