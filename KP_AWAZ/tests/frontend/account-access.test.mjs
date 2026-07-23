import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  isCompleteSignupOtp,
  normalizeSignupOtp,
  resolveWorkspaceDestination,
} from "../../scripts/modules/account-access.js";
import { initialsForIdentity } from "../../scripts/modules/workspace-shell.js";


const projectRoot = new URL("../../", import.meta.url);


test("signup OTP accepts pasted digits and stays exactly six digits", () => {
  assert.equal(normalizeSignupOtp(" 12 34-56 "), "123456");
  assert.equal(normalizeSignupOtp("12a34b56789"), "12a34b");
  assert.equal(isCompleteSignupOtp("12 34 56"), true);
  assert.equal(isCompleteSignupOtp("12345"), false);
  assert.equal(isCompleteSignupOtp("12a456"), false);
});


test("workspace destination accepts only local member pages", () => {
  assert.equal(resolveWorkspaceDestination("?next=profile.html"), "profile.html");
  assert.equal(
    resolveWorkspaceDestination("?next=https://outside.example"),
    "dashboard.html",
  );
  assert.equal(resolveWorkspaceDestination("?next=admin.html"), "dashboard.html");
});


test("workspace initials use a display name without exposing an email", () => {
  assert.equal(initialsForIdentity("Faisal Imran", "private@example.com"), "FI");
  assert.equal(initialsForIdentity("", "voice@example.com"), "VE");
});


test("account page contains password setup, signup OTP, and returning sign-in", async () => {
  const html = await readFile(new URL("auth.html", projectRoot), "utf8");
  assert.match(html, /id="createPassword"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /id="signupOtpInput"/);
  assert.match(html, /inputmode="numeric"/);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.match(html, /maxlength="6"/);
  assert.match(html, /id="passwordSignInForm"/);
  assert.match(html, /Continue with Google/);
});


test("password and OTP values are not persisted or logged by account access", async () => {
  const source = await readFile(
    new URL("scripts/modules/account-access.js", projectRoot),
    "utf8",
  );
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(source, /URLSearchParams\([^)]*(?:otp|password)/i);
});


test("member workspace is split into real pages with shared navigation", async () => {
  const pages = await Promise.all(
    ["dashboard.html", "contribute.html", "donate-text.html", "my-contributions.html", "profile.html", "settings.html"].map((name) =>
      readFile(new URL(name, projectRoot), "utf8"),
    ),
  );
  for (const html of pages) {
    assert.match(html, /sections\/workspace-sidebar\.html/);
    assert.match(html, /data-workspace-state="loading"/);
  }

  const sidebar = await readFile(
    new URL("sections/workspace-sidebar.html", projectRoot),
    "utf8",
  );
  assert.match(sidebar, /href="dashboard\.html"/);
  assert.match(sidebar, /href="my-contributions\.html"/);
  assert.doesNotMatch(sidebar, /href="profile\.html"/);
  assert.match(sidebar, /href="contribute\.html\?mode=guided"/);
  assert.match(sidebar, /href="donate-text\.html" data-workspace-link="donate-text"/);
  assert.match(sidebar, /href="settings\.html"[\s\S]*?Profile, privacy &amp; security/);
});


test("workspace navigation reserves the gold treatment for the active page", async () => {
  const [workspaceCss, finalPolishCss] = await Promise.all([
    readFile(new URL("styles/workspace.css", projectRoot), "utf8"),
    readFile(new URL("styles/final-polish.css", projectRoot), "utf8"),
  ]);
  const recordLinkRule = workspaceCss.match(
    /\.workspace-navigation \.workspace-record-link\s*\{([^}]*)\}/,
  );

  assert.ok(recordLinkRule, "record link should keep its taller layout rule");
  assert.doesNotMatch(recordLinkRule[1], /\b(?:background|border-color|color|box-shadow)\s*:/);
  assert.doesNotMatch(
    finalPolishCss,
    /\.workspace-navigation \.workspace-record-link\s*\{/,
  );
  assert.match(
    workspaceCss,
    /\.workspace-navigation a\.is-active\s*\{[^}]*border-color:[^}]*background:[^}]*color:/s,
  );
  assert.match(
    workspaceCss,
    /\.workspace-navigation a\.is-active::before\s*\{[^}]*opacity:\s*1[^}]*transform:\s*scaleY\(1\)/s,
  );
});
