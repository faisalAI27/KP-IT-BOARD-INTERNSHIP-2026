import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  appConfig,
  resolveRuntimeUrls,
} from "../../scripts/config.js";


const projectRoot = new URL("../../", import.meta.url);


test("configuration imports safely in Node and uses the complete fallback API route", () => {
  assert.equal(appConfig.frontendBaseUrl, "http://127.0.0.1:4173");
  assert.equal(appConfig.api.baseUrl, "http://127.0.0.1:8000/api");
});


test("localhost, loopback, and private-LAN pages use the same host on backend port 8000", () => {
  for (const hostname of ["localhost", "127.0.0.1", "172.20.10.6"]) {
    const result = resolveRuntimeUrls({
      origin: `http://${hostname}:4173`,
      protocol: "http:",
      hostname,
    });

    assert.equal(result.frontendBaseUrl, `http://${hostname}:4173`);
    assert.equal(result.apiBaseUrl, `http://${hostname}:8000/api`);
    assert.equal(new URL(result.apiBaseUrl).port, "8000");
    assert.equal(new URL(result.apiBaseUrl).pathname, "/api");
  }
});


test("development build preserves browser-derived runtime configuration", async () => {
  const build = await readFile(new URL("tools/build.mjs", projectRoot), "utf8");

  assert.match(
    build,
    /if \(buildEnvironment === "production"\) \{\s*await writeRuntimeConfiguration\(runtimeConfig\);\s*\}/,
  );
  assert.doesNotMatch(build, /production \? "" : "\/api"/);
});


test("every FastAPI service defaults to the centralized API base URL", async () => {
  const serviceNames = [
    "admin-phrases-api.js",
    "admin-review-api.js",
    "auth-service.js",
    "contributions-api.js",
    "leaderboard-api.js",
    "points-api.js",
    "profile-api.js",
    "withdrawals-api.js",
  ];

  for (const name of serviceNames) {
    const source = await readFile(
      new URL(`scripts/services/${name}`, projectRoot),
      "utf8",
    );
    assert.match(source, /apiBaseUrl = appConfig\.api\.baseUrl/);
    assert.doesNotMatch(source, /apiBaseUrl\s*=\s*["'`]\/api/);
  }
});
