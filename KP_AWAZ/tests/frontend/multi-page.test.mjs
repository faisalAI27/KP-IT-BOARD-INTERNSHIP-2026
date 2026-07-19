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


test("public data-use page and private profile expose the consent explanation safely", async () => {
  const [dataUse, profilePartial, profileApp] = await Promise.all([
    read("data-use.html"),
    read("sections/workspace-profile.html"),
    read("scripts/profile-page-app.js"),
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
  assert.match(profilePartial, /id="profileConsentVersion"/);
  assert.match(profilePartial, /id="profileConsentDate"/);
  assert.match(profilePartial, /href="data-use\.html"/);
  assert.match(profileApp, /getMyConsentSummary\(\)/);
  assert.match(profileApp, /legacy consent status unknown/);
  assert.doesNotMatch(`${dataUse}\n${profilePartial}`, /accessToken|refreshToken|userId/);
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
  assert.match(shell, /We could not load your dashboard\. Please try again\./);
  assert.doesNotMatch(shell, /preferredLanguage:\s*"Pashto"/);
});


test("production contribution services contain no mock data path", async () => {
  const [config, contributionApi, contributionModule] = await Promise.all([
    read("scripts/config.js"),
    read("scripts/services/contributions-api.js"),
    read("scripts/modules/contributions.js"),
  ]);
  assert.doesNotMatch(`${config}\n${contributionApi}`, /useMock|mockDelayMs|pashto-sentences/);
  assert.match(
    contributionModule,
    /We could not submit your recording\. Your recording has not been counted\./,
  );
});


test("recovery pages use Supabase-only password controls and generic account messaging", async () => {
  const [forgot, reset, forgotSource, resetSource] = await Promise.all([
    read("forgot-password.html"), read("reset-password.html"),
    read("scripts/forgot-password-page.js"), read("scripts/reset-password-page.js"),
  ]);
  assert.match(forgot, /Send reset instructions/);
  assert.match(forgotSource, /If an account is associated with that email/);
  assert.match(reset, /autocomplete="new-password"/);
  assert.match(reset, /id="resetPasswordConfirm"/);
  assert.match(resetSource, /isPasswordRecoverySession/);
  assert.match(resetSource, /updatePassword\(password\.value\)/);
  assert.doesNotMatch(`${forgotSource}\n${resetSource}`, /localStorage|sessionStorage|document\.cookie|console\./);
});


test("dashboard uses approved contribution count and real private services", async () => {
  const [html, source] = await Promise.all([read("dashboard.html"), read("scripts/dashboard-app.js")]);
  assert.match(html, /href="contribute\.html"/);
  assert.match(html, /id="dashboardLeaderboardList"/);
  assert.match(source, /statistics\.approvedContributions/);
  assert.match(source, /getMyContributions/);
  assert.match(source, /getPublicLeaderboard/);
  assert.doesNotMatch(source, /getMyPoints/);
});
