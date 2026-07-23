import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { contributionDestination } from "../../scripts/modules/public-routing.js";


const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");


test("public and protected architecture contains every required page", async () => {
  const names = [
    "index.html", "about.html", "data-use.html", "how-it-works.html", "leaderboard.html",
    "auth.html", "forgot-password.html", "reset-password.html",
    "dashboard.html", "contribute.html", "my-contributions.html",
    "profile.html", "settings.html", "admin.html",
  ];
  const pages = await Promise.all(names.map(read));
  assert.equal(pages.every((html) => /<!doctype html>/i.test(html)), true);
  const build = await read("tools/build.mjs");
  for (const name of names) assert.match(build, new RegExp(`"${name.replace(".", "\\.")}"`));
});


test("Start Contributing selects auth or studio from verified state", () => {
  assert.equal(contributionDestination({ status: "signed_out" }), "auth.html?next=contribute.html");
  assert.equal(contributionDestination({ status: "loading" }), "auth.html?next=contribute.html");
  assert.equal(
    contributionDestination({ status: "signed_in", backendUser: { id: "verified-user" } }),
    "contribute.html",
  );
});


test("public homepage has no account modal or private contribution workflow", async () => {
  const html = await read("index.html");
  const header = await read("sections/header.html");
  assert.doesNotMatch(html, /sections\/auth-dialog\.html/);
  assert.doesNotMatch(html, /sections\/contribution\.html/);
  assert.match(header, /href="about\.html"/);
  assert.match(header, /href="how-it-works\.html"/);
  assert.match(header, /href="leaderboard\.html"/);
  assert.match(header, /href="auth\.html\?next=contribute\.html"[^>]*data-start-contributing/);
});


test("public data-use page and unified settings expose the consent explanation safely", async () => {
  const [dataUse, settingsPartial, settingsApp] = await Promise.all([
    read("data-use.html"),
    read("sections/workspace-settings.html"),
    read("scripts/settings-page-app.js"),
  ]);

  for (const heading of [
    "What we collect",
    "Why voice data is collected",
    "How review works",
    "How approved recordings may be used",
    "What remains private",
    "Requesting withdrawal",
  ]) {
    assert.match(dataUse, new RegExp(heading));
  }
  assert.match(dataUse, /Policy 1\.0/);
  assert.match(dataUse, /legacy consent status unknown/);
  assert.match(settingsPartial, /id="settingsConsentVersion"/);
  assert.match(settingsPartial, /id="settingsConsentDate"/);
  assert.match(settingsPartial, /href="data-use\.html"/);
  assert.match(settingsApp, /getMyConsentSummary\(\)/);
  assert.match(settingsApp, /legacy consent status unknown/);
  assert.doesNotMatch(`${dataUse}\n${settingsPartial}`, /accessToken|refreshToken|userId/);
});

test("profile and privacy are merged into one refined Settings workspace", async () => {
  const [profilePage, settingsPage, settings, css, app, sidebar] = await Promise.all([
    read("profile.html"),
    read("settings.html"),
    read("sections/workspace-settings.html"),
    read("styles/settings.css"),
    read("scripts/settings-page-app.js"),
    read("sections/workspace-sidebar.html"),
  ]);

  for (const page of [profilePage, settingsPage]) {
    assert.match(page, /sections\/workspace-settings\.html/);
    assert.match(page, /scripts\/settings-page-app\.js\?v=20260723-unified-settings/);
    assert.doesNotMatch(page, /workspace-profile\.html|profile-page-app\.js/);
  }
  assert.match(settings, /class="settings-template-shell"/);
  assert.match(settings, /id="settingsDisplayName"/);
  assert.match(settings, /id="settingsVerifiedEmail"[\s\S]*?readonly/);
  assert.match(settings, /id="settingsLeaderboardOptIn"/);
  assert.match(settings, /id="settingsApprovedCount"/);
  assert.match(settings, /id="settingsConsentVersion"/);
  assert.match(settings, /id="withdrawalSettingsSection"/);
  assert.doesNotMatch(settings, /id="oldPassword"|Show guided recording first|Show contribution reminders/);
  assert.match(app, /updateMyProfile\(updates\)/);
  assert.match(app, /getMyContributionStatistics\(\)/);
  assert.match(app, /getMyConsentSummary\(\)/);
  assert.match(css, /\.settings-template-shell\s*{[\s\S]*?rgba\(255, 255, 255, 0\.76\)/);
  assert.match(css, /\.settings-template-shell::before\s*{[\s\S]*?repeating-linear-gradient/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.settings-field-grid,[\s\S]*?grid-template-columns:\s*1fr/);
  assert.doesNotMatch(sidebar, /href="profile\.html"/);
  assert.match(sidebar, /href="settings\.html"[\s\S]*?Profile, privacy &amp; security/);
});


test("all contributor pages use the verified workspace route guard", async () => {
  for (const name of ["dashboard.html", "contribute.html", "my-contributions.html", "profile.html", "settings.html"]) {
    const html = await read(name);
    assert.match(html, /data-workspace-state="loading"/);
    assert.match(html, /sections\/workspace-sidebar\.html/);
  }
  const shell = await read("scripts/modules/workspace-shell.js");
  assert.match(shell, /protectedAuthDestination\(filename\)/);
  assert.match(shell, /this\._navigate\("index\.html", \{ replace: true \}\)/);
  assert.match(shell, /Your account is verified, but your profile could not be loaded\. Please try again\./);
  assert.doesNotMatch(shell, /preferredLanguage:\s*"Pashto"/);
});


test("production contribution services contain no mock data path", async () => {
  const [config, contributionApi, contributionModule] = await Promise.all([
    read("scripts/config.js"),
    read("scripts/services/contributions-api.js"),
    read("scripts/modules/contributions.js"),
  ]);
  assert.doesNotMatch(`${config}\n${contributionApi}`, /useMock|mockDelayMs|pashto-sentences/);
  assert.match(contributionModule, /ACCOUNT_POLICY_SUBMISSION_BLOCK_MESSAGE/);
  assert.match(contributionModule, /No recording was uploaded; your recording is still here/);
  assert.doesNotMatch(contributionModule, /submitVoiceDonation\(|submitOpenRecording\(/);
});


test("recovery pages use Supabase-only password controls and generic account messaging", async () => {
  const [forgot, reset, forgotSource, resetSource, recoveryCard, recoverySource] = await Promise.all([
    read("forgot-password.html"), read("reset-password.html"),
    read("scripts/forgot-password-page.js"), read("scripts/reset-password-page.js"),
    read("sections/password-recovery-card.html"),
    read("scripts/modules/password-recovery.js"),
  ]);
  assert.match(forgot, /sections\/password-recovery-card\.html/);
  assert.match(reset, /sections\/password-recovery-card\.html/);
  assert.match(recoveryCard, /Send recovery code/);
  assert.match(recoveryCard, /autocomplete="new-password"/);
  assert.match(recoveryCard, /id="recoveryPasswordConfirm"/);
  assert.match(recoverySource, /verifyRecoveryOtp/);
  assert.match(recoverySource, /updatePassword\(this\._elements\.password\.value\)/);
  assert.doesNotMatch(`${forgotSource}\n${resetSource}\n${recoverySource}`, /localStorage|document\.cookie|console\./);
});


test("focused dashboard routes both recording modes and uses only private contributor services", async () => {
  const [html, source] = await Promise.all([read("dashboard.html"), read("scripts/dashboard-app.js")]);
  assert.match(html, /href="contribute\.html\?mode=guided"/);
  assert.match(html, /href="contribute\.html\?mode=custom"/);
  assert.doesNotMatch(html, /dashboardLeaderboardList|voice-orbit|profile-compass|dashboardRejectedCount/);
  assert.match(html, /id="dashboardRecentList"/);
  assert.match(source, /statistics\.approvedContributions/);
  assert.match(source, /getMyContributions/);
  assert.doesNotMatch(source, /getPublicLeaderboard/);
  assert.doesNotMatch(source, /getMyPoints/);
});
