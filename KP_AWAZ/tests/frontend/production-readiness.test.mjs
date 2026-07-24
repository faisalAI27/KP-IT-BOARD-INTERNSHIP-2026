import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { appConfig } from "../../scripts/config.js";
import {
  API_REQUEST_TIMEOUT_MS,
  AUDIO_UPLOAD_REQUEST_TIMEOUT_MS,
} from "../../scripts/services/request-timeout.js";


const projectRoot = new URL("../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, projectRoot), "utf8");
}


test("production build validates public configuration before replacing dist", async () => {
  const build = await read("tools/build.mjs");
  const validationIndex = build.indexOf("const runtimeConfig = productionAppConfig()");
  const removalIndex = build.indexOf("await rm(outputRoot");

  assert.ok(validationIndex >= 0);
  assert.ok(removalIndex > validationIndex);
  for (const name of [
    "KP_AWAZ_API_BASE_URL",
    "KP_AWAZ_FRONTEND_BASE_URL",
    "KP_AWAZ_SUPABASE_URL",
    "KP_AWAZ_SUPABASE_PUBLISHABLE_KEY",
    "KP_AWAZ_APP_VERSION",
  ]) {
    assert.match(build, new RegExp(name));
  }
});


test("all required production pages are assembled", async () => {
  const build = await read("tools/build.mjs");
  for (const page of [
    "index.html",
    "about.html",
    "how-it-works.html",
    "leaderboard.html",
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
  ]) {
    assert.match(build, new RegExp(`"${page}"`));
  }
});

test("Sites build includes its static worker and persisted project metadata", async () => {
  const [build, hosting] = await Promise.all([
    read("tools/build.mjs"),
    read(".openai/hosting.json"),
  ]);

  assert.match(build, /resolve\(outputRoot, "client"\)/);
  assert.match(build, /resolve\(clientRoot, pageName\)/);
  assert.match(build, /resolve\(outputRoot, "server"\)/);
  assert.match(build, /const sitesPages = \{\}/);
  assert.match(build, /"Content-Type": "text\/html; charset=utf-8"/);
  assert.match(build, /environment\?\.ASSETS/);
  assert.match(build, /headers\.set\("Cache-Control", "no-cache"\)/);
  assert.match(build, /resolve\(outputRoot, "\.openai"\)/);
  assert.match(build, /await writeSitesArtifacts\(\)/);
  assert.deepEqual(
    JSON.parse(hosting),
    { project_id: "appgprj_6a61ac09fe288191ada1f1745e60d782" },
  );
});

test("every build fingerprints runtime assets to prevent stale auth configuration", async () => {
  const build = await read("tools/build.mjs");
  const stampIndex = build.indexOf("await stampRuntimeAssetVersions()");
  const sitesIndex = build.indexOf("await writeSitesArtifacts()");

  assert.match(build, /createHash\("sha256"\)/);
  assert.match(build, /\/\(\[\?&\]v=\)\[A-Za-z0-9\._-\]\+\/g/);
  assert.ok(stampIndex >= 0);
  assert.ok(sitesIndex > stampIndex);
});

test("production assets exclude regenerated Finder duplicate copies", async () => {
  const build = await read("tools/build.mjs");

  assert.match(build, /filter: shouldCopy/);
  assert.match(build, /!\/ 2\(\?:\\\.\|\$\)\/\.test\(name\)/);
  assert.match(build, /name !== "\.DS_Store"/);
});


test("audio uploads have a longer bounded timeout than JSON requests", () => {
  assert.equal(API_REQUEST_TIMEOUT_MS, appConfig.api.requestTimeoutMs);
  assert.equal(
    AUDIO_UPLOAD_REQUEST_TIMEOUT_MS,
    appConfig.api.audioUploadTimeoutMs,
  );
  assert.ok(AUDIO_UPLOAD_REQUEST_TIMEOUT_MS > API_REQUEST_TIMEOUT_MS);
});


test("server-only configuration is absent from browser runtime config", async () => {
  const config = await read("scripts/config.js");
  for (const serverOnlyName of [
    "ADMIN_API_KEY",
    "SUPABASE_SECRET_KEY",
    "SMTP_PASSWORD",
    "GOOGLE_CLIENT_SECRET",
  ]) {
    assert.doesNotMatch(config, new RegExp(serverOnlyName));
  }
});
