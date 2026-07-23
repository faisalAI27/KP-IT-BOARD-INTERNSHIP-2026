import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const logoAssets = [
  "assets/images/logo.svg",
  "assets/images/logo-primary.svg",
  "assets/images/logo-horizontal.svg",
  "assets/images/logo-stacked.svg",
  "assets/images/logo-monochrome-dark.svg",
  "assets/images/logo-monochrome-light.svg",
];

test("brand system provides every scalable KP AWAZ logo variation", async () => {
  for (const path of logoAssets) {
    const [asset, metadata] = await Promise.all([
      read(path),
      stat(new URL(path, root)),
    ]);

    assert.equal(metadata.isFile(), true);
    assert.match(asset, /^<svg[^>]+viewBox=/);
    assert.match(asset, /<title[^>]*>KP AWAZ/i);
    assert.doesNotMatch(asset, /<linearGradient|<radialGradient|filter=/);
  }
});

test("full-color identity uses the approved earthy palette and integrated symbol", async () => {
  const [mark, primary] = await Promise.all([
    read("assets/images/logo.svg"),
    read("assets/images/logo-primary.svg"),
  ]);

  for (const color of ["#153f32", "#b65d3a", "#c89943", "#f7f1e6"]) {
    assert.match(mark, new RegExp(color, "i"));
  }

  assert.match(mark, /gateway.*mountain.*voice wave/i);
  assert.match(mark, /stroke-linecap="round"/);
  assert.match(primary, /id="letter-k"/);
  assert.match(primary, /id="letter-a"/);
  assert.doesNotMatch(primary, /<text/);
});

test("the supplied Khyber Voice artwork is preserved as scalable production assets", async () => {
  const [primary, light, mark] = await Promise.all([
    read("assets/images/khyber-voice-logo.svg"),
    read("assets/images/khyber-voice-logo-light.svg"),
    read("assets/images/khyber-voice-mark.svg"),
  ]);

  for (const asset of [primary, light, mark]) {
    assert.match(asset, /^<svg[^>]+viewBox=/);
    assert.match(asset, /<title[^>]*>Khyber Voice/i);
    assert.doesNotMatch(asset, /<text|<rect|filter=|href=/);
  }
  for (const color of ["#123F3A", "#B85C3D", "#D59C52", "#FFF7E8"]) {
    assert.match(primary, new RegExp(color, "i"));
  }
  assert.match(light, /#FFF7E8/i);
  assert.match(mark, /microphone with radiating voice waves/i);
});

test("the Khyber Voice logo is clickable on every branded surface", async () => {
  const [header, footer, auth, workspace, forgot, reset, recoveryCard, admin, navigationCss] = await Promise.all([
    read("sections/header.html"),
    read("sections/footer.html"),
    read("auth.html"),
    read("sections/workspace-sidebar.html"),
    read("forgot-password.html"),
    read("reset-password.html"),
    read("sections/password-recovery-card.html"),
    read("admin.html"),
    read("styles/navigation.css"),
  ]);

  assert.match(header, /<a[^>]+href="index\.html"[^>]+aria-label="Khyber Voice home"[\s\S]*?khyber-voice-logo\.svg/);
  assert.match(footer, /<a[^>]+href="index\.html"[^>]+aria-label="Khyber Voice home"[\s\S]*?khyber-voice-logo-light\.svg/);
  assert.match(auth, /<a[^>]+href="index\.html"[^>]+aria-label="Khyber Voice home"[\s\S]*?khyber-voice-logo\.svg/);
  assert.match(workspace, /<a[^>]+href="index\.html"[^>]+aria-label="Khyber Voice public home"[\s\S]*?khyber-voice-logo-light\.svg/);
  assert.match(forgot, /sections\/password-recovery-card\.html/);
  assert.match(reset, /sections\/password-recovery-card\.html/);
  assert.match(recoveryCard, /<a[^>]+href="index\.html"[^>]+aria-label="Khyber Voice home"[\s\S]*?khyber-voice-logo\.svg/);
  assert.match(admin, /<a[^>]+href="index\.html"[^>]+aria-label="Khyber Voice home"[\s\S]*?khyber-voice-mark\.svg/);
  assert.match(navigationCss, /\.logo\s*\{[^}]*min-height:\s*44px/s);
});

test("every production page uses the Khyber Voice emblem as its favicon", async () => {
  const pages = [
    "index.html",
    "about.html",
    "how-it-works.html",
    "leaderboard.html",
    "data-use.html",
    "auth.html",
    "forgot-password.html",
    "reset-password.html",
    "dashboard.html",
    "contribute.html",
    "my-contributions.html",
    "profile.html",
    "settings.html",
    "admin.html",
  ];

  for (const page of pages) {
    const html = await read(page);
    assert.match(
      html,
      /<link rel="icon" href="assets\/images\/khyber-voice-mark\.svg" type="image\/svg\+xml" \/>/,
    );
  }
});

test("brand guidance records meaning, usage, minimum size, and accessibility", async () => {
  const guide = await read("docs/brand-identity.md");

  assert.match(guide, /The Voice Gateway/);
  assert.match(guide, /hujra/i);
  assert.match(guide, /minimum displayed width/i);
  assert.match(guide, /aria-label="KP AWAZ home"/);
  assert.match(guide, /Do not/);
});
