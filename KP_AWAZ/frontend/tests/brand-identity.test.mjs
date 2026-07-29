import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const readBinary = (path) => readFile(new URL(path, root));

const approvedLogos = [
  {
    path: "assets/images/brand/kp-awaz-lockup-horizontal-on-light.png",
    width: 3403,
    height: 536,
    sha256: "9171b9e535eb9c0ff0b97e85229fc33c6f8f4a205dfe2470e5086f4a21635d44",
  },
  {
    path: "assets/images/brand/kp-awaz-lockup-horizontal-on-dark.png",
    width: 3403,
    height: 536,
    sha256: "8d6103d090388cf72bb6d3fbd0dd26b77a2040c6613e70f8d01668dd8b1591af",
  },
  {
    path: "assets/images/brand/kp-awaz-lockup-stacked-on-light.png",
    width: 3562,
    height: 2084,
    sha256: "24a78067d2ce36d70772a9ce903d01253793d0e8fc0f5a7cd6cc641fcc060386",
  },
];

test("designer-approved PNG masters are preserved byte-for-byte with transparency", async () => {
  for (const logo of approvedLogos) {
    const [asset, metadata] = await Promise.all([
      readBinary(logo.path),
      stat(new URL(logo.path, root)),
    ]);

    assert.equal(metadata.isFile(), true);
    assert.equal(asset.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(asset.readUInt32BE(16), logo.width);
    assert.equal(asset.readUInt32BE(20), logo.height);
    assert.equal(asset[25], 6, `${logo.path} must remain an RGBA PNG`);
    assert.equal(createHash("sha256").update(asset).digest("hex"), logo.sha256);
  }
});

test("every visible branded surface uses the correct approved lockup and accessible home label", async () => {
  const [header, footer, auth, workspace, recoveryCard, admin, navigationCss, closingCss, workspaceCss, authCss, adminCss] =
    await Promise.all([
      read("sections/header.html"),
      read("sections/footer.html"),
      read("auth.html"),
      read("sections/workspace-sidebar.html"),
      read("sections/password-recovery-card.html"),
      read("admin.html"),
      read("styles/navigation.css"),
      read("styles/closing.css"),
      read("styles/workspace.css"),
      read("styles/auth-page.css"),
      read("styles/admin.css"),
    ]);

  const horizontalLight = "assets/images/brand/kp-awaz-lockup-horizontal-on-light.png";
  const horizontalDark = "assets/images/brand/kp-awaz-lockup-horizontal-on-dark.png";
  const stackedLight = "assets/images/brand/kp-awaz-lockup-stacked-on-light.png";

  assert.match(header, new RegExp(`aria-label="KP AWAZ home"[\\s\\S]*?${horizontalLight}`));
  assert.match(footer, new RegExp(`aria-label="KP AWAZ home"[\\s\\S]*?${horizontalDark}`));
  assert.match(auth, new RegExp(`aria-label="KP AWAZ home"[\\s\\S]*?${stackedLight}`));
  assert.match(workspace, new RegExp(`aria-label="KP AWAZ public home"[\\s\\S]*?${horizontalDark}`));
  assert.match(recoveryCard, new RegExp(`aria-label="KP AWAZ home"[\\s\\S]*?${stackedLight}`));
  assert.match(admin, new RegExp(`aria-label="KP AWAZ home"[\\s\\S]*?${horizontalLight}`));

  for (const html of [header, footer, auth, workspace, recoveryCard, admin]) {
    assert.doesNotMatch(html, /<img[^>]+src="[^"]*khyber-voice-(?:logo|mark)/i);
  }

  assert.match(header, /width="3403"[\s\S]*?height="536"[\s\S]*?alt=""/);
  assert.match(auth, /width="3562"[\s\S]*?height="2084"[\s\S]*?alt=""/);
  assert.match(navigationCss, /\.logo\s*\{[^}]*min-height:\s*44px/s);
  assert.match(navigationCss, /width:\s*clamp\(220px,\s*18vw,\s*244px\)/);
  assert.match(closingCss, /width:\s*clamp\(230px,\s*24vw,\s*270px\)/);
  assert.match(workspaceCss, /width:\s*min\(100%,\s*224px\)/);
  assert.match(authCss, /\.access-brand img\s*\{[^}]*width:\s*176px[^}]*height:\s*auto/s);
  assert.match(adminCss, /width:\s*clamp\(205px,\s*20vw,\s*242px\)/);
});

test("the live KPITB palette and typography are the shared frontend source of truth", async () => {
  const [foundation, auth, dashboard, leaderboard, settings, recorder] = await Promise.all([
    read("styles/foundation.css"),
    read("styles/auth-page.css"),
    read("styles/dashboard.css"),
    read("styles/leaderboard.css"),
    read("styles/settings.css"),
    read("styles/rabab-recorder.css"),
  ]);

  for (const declaration of [
    "--brand-navy: #001a33",
    "--brand-green: #3bc3b2",
    "--brand-blue: #33679a",
    "--brand-grey: #9d9d9d",
    "--brand-white: #ffffff",
    "--brand-gradient: linear-gradient(205deg, #3bc3b2 0%, #001a33 90.26%)",
    '--font-body: "unineue"',
    '--font-display: "unineue"',
    '--font-ui: "inter"',
  ]) {
    assert.match(foundation.toLowerCase(), new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const stylesheet of [auth, dashboard, leaderboard, settings, recorder]) {
    assert.match(stylesheet, /var\(--brand-(?:navy|green|blue|surface|text|white)/);
  }
  assert.match(foundation, /--brand-danger:/);
  assert.match(foundation, /--brand-success:/);
});

test("the exact live KPITB webfont files are self-hosted with swap behavior", async () => {
  const fontFiles = [
    ["assets/fonts/kpitb/Inter-Latin-Variable.woff2", "dd8a4575be9806105ac3decd02805cd2782fe7c05abb02c582316bc436ce03ae"],
    ["assets/fonts/kpitb/Inter-Latin-Variable-Italic.woff2", "124b693f9bb5663329a23e21e3b702ed9ae20a8298a1a7213cd56fc187a16800"],
    ["assets/fonts/kpitb/UniNeue-Trial-Bold.ttf", "5be0472894007f42d8eadc6d0916d5c85837d93089e18151c6cee4ce04c6265c"],
    ["assets/fonts/kpitb/UniNeue-Trial-Heavy.ttf", "a687aff84fa94c32ee0f22360a8813500a48082d86286c86f4c6093eb0feeaa1"],
    ["assets/fonts/kpitb/UniNeue-Trial-Regular.ttf", "4a84d0b08b7a3aaf72db17719fee17176c822d286fbfd41be7c7d9cbaa5a7cd1"],
    ["assets/fonts/kpitb/UniNeue-Trial-Light.ttf", "a9f89995807250cfeddb9307d25afedf7ac301b0e6ee29ff91e8a55cbaf3c0b5"],
  ];
  const foundation = await read("styles/foundation.css");

  for (const [path, checksum] of fontFiles) {
    const asset = await readBinary(path);
    assert.equal(createHash("sha256").update(asset).digest("hex"), checksum);
  }

  assert.match(foundation, /font-family:\s*"UniNeue"/);
  assert.match(foundation, /font-family:\s*"Inter"/);
  assert.equal((foundation.match(/font-display:\s*swap/g) ?? []).length, 6);
});

test("the legacy favicon remains temporary until an approved square mark is supplied", async () => {
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
    "donate-text.html",
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

test("brand guidance records usage, intrinsic sizing, accessibility, and favicon limitation", async () => {
  const guide = await readFile(
    new URL("../../docs/brand-identity.md", import.meta.url),
    "utf8",
  );

  assert.match(guide, /source of truth/i);
  assert.match(guide, /Preserving Languages\. Empowering AI/);
  assert.match(guide, /3403 × 536/);
  assert.match(guide, /3562 × 2084/);
  assert.match(guide, /aria-label="KP AWAZ home"/);
  assert.match(guide, /UniNeue/);
  assert.match(guide, /Inter/);
  assert.match(guide, /#001A33/);
  assert.match(guide, /#3BC3B2/);
  assert.match(guide, /square\/icon-only KP AWAZ mark is still required/i);
  assert.match(guide, /Do not/);
});
