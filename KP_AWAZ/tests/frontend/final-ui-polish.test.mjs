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
    const expectedMainVersion = ["index.html", "leaderboard.html"].includes(page)
      ? "styles/main.css?v=20260723-refined-surfaces"
      : "styles/main.css?v=20260720-final-polish";
    assert.match(html, new RegExp(expectedMainVersion.replace(/[.?]/g, "\\$&")));
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
    const expectedPolish = page === "contribute.html"
      ? "styles/final-polish.css?v=20260723-rabab-reading"
      : "styles/final-polish.css?v=20260720-final-polish";
    assert.equal(stylesheets.at(-1), expectedPolish);
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


test("dashboard keeps its production identity with the supplied refined surface", async () => {
  const [workspaceCss, dashboardCss, polishCss] = await Promise.all([
    read("styles/workspace.css"),
    read("styles/dashboard.css"),
    read("styles/final-polish.css"),
  ]);

  assert.match(workspaceCss, /\.workspace-sidebar\s*{[\s\S]*?#173e34;[\s\S]*?}/);
  assert.match(dashboardCss, /\.dashboard-colorflow-shell\s*{[\s\S]*?rgba\(255, 255, 255, 0\.76\)[\s\S]*?}/);
  assert.match(dashboardCss, /\.dashboard-colorflow-shell::before\s*{[\s\S]*?repeating-linear-gradient/);
  assert.doesNotMatch(dashboardCss, /dashboard-(?:border-flow|text-flow|corner-drift)/);
  assert.doesNotMatch(dashboardCss, /\.dashboard-colorflow-shell\s*{[^}]*background:\s*#173e34/s);
  assert.doesNotMatch(polishCss, /\.workspace-sidebar\s*{[^}]*background(?:-color|-image)?:/s);
  assert.doesNotMatch(polishCss, /\.dashboard-contribute-hub(?:,|::after)[\s\S]*?background(?:-color|-image)?:/);
  assert.doesNotMatch(polishCss, /\.rec-btn(?:\s*\{|:focus-visible)/);
});


test("dashboard decoration stays static and noninteractive with no sidebar-edge divider", async () => {
  const [workspaceCss, dashboardCss, polishCss] = await Promise.all([
    read("styles/workspace.css"),
    read("styles/dashboard.css"),
    read("styles/final-polish.css"),
  ]);

  assert.match(dashboardCss, /\.dashboard-colorflow-corner\s*{[\s\S]*pointer-events:\s*none/);
  assert.match(dashboardCss, /\.dashboard-colorflow-shell::before\s*{[\s\S]*height:\s*6px[\s\S]*repeating-linear-gradient/);
  assert.match(dashboardCss, /\.dashboard-colorflow-shell::after\s*{[\s\S]*display:\s*none/);
  assert.match(dashboardCss, /body\.workspace-body\.dashboard-body\s*{[\s\S]*background-color:\s*var\(--dashboard-cream\)/);
  assert.doesNotMatch(workspaceCss, /\.workspace-sidebar::after/);
  assert.match(workspaceCss, /\.workspace-sidebar\s*{[\s\S]*box-shadow:\s*none/);
  assert.match(polishCss, /\.workspace-sidebar\s*{[\s\S]*box-shadow:\s*none/);
  assert.doesNotMatch(polishCss, /\.workspace-sidebar\s*{[^}]*border-right/s);
  assert.doesNotMatch(dashboardCss, /@keyframes/);
});
