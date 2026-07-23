import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSupabaseVendorBundle } from "./build-supabase-vendor.mjs";
import { appConfig as developmentConfig } from "../scripts/config.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(projectRoot, "dist");
const productionPages = [
  "index.html",
  "about.html",
  "data-use.html",
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
];
const buildEnvironment = (process.env.KP_AWAZ_BUILD_ENV ?? "development")
  .trim()
  .toLowerCase();

function publicEnvironment(name, fallback = "") {
  const configured = process.env[name];
  return typeof configured === "string" && configured.trim()
    ? configured.trim()
    : fallback;
}

function positiveIntegerEnvironment(name, fallback) {
  const rawValue = publicEnvironment(name, String(fallback));
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid public build configuration: ${name}`);
  }
  return value;
}

function validatePublicBuildConfiguration(config) {
  if (!["development", "production"].includes(buildEnvironment)) {
    throw new Error("KP_AWAZ_BUILD_ENV must be development or production");
  }
  if (buildEnvironment !== "production") return;

  for (const [name, value] of [
    ["KP_AWAZ_API_BASE_URL", config.api.baseUrl],
    ["KP_AWAZ_FRONTEND_BASE_URL", config.frontendBaseUrl],
    ["KP_AWAZ_SUPABASE_URL", config.auth.supabaseUrl],
    ["KP_AWAZ_SUPABASE_PUBLISHABLE_KEY", config.auth.supabasePublishableKey],
    ["KP_AWAZ_APP_VERSION", config.version],
  ]) {
    if (!value) throw new Error(`Missing public build configuration: ${name}`);
  }
  for (const [name, value] of [
    ["KP_AWAZ_API_BASE_URL", config.api.baseUrl],
    ["KP_AWAZ_FRONTEND_BASE_URL", config.frontendBaseUrl],
    ["KP_AWAZ_SUPABASE_URL", config.auth.supabaseUrl],
  ]) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`Invalid public build configuration: ${name}`);
    }
    if (parsed.protocol !== "https:") {
      throw new Error(`Production public URL must use HTTPS: ${name}`);
    }
    if (
      ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(`Production public URL must not be local: ${name}`);
    }
  }
}

function productionAppConfig() {
  const production = buildEnvironment === "production";
  if (!production) {
    validatePublicBuildConfiguration(developmentConfig);
    return developmentConfig;
  }
  const frontendBaseUrl = publicEnvironment("KP_AWAZ_FRONTEND_BASE_URL", "")
    .replace(/\/+$/, "");
  const config = {
    environment: buildEnvironment,
    version: publicEnvironment("KP_AWAZ_APP_VERSION", production ? "" : "1.0.0"),
    frontendBaseUrl,
    api: {
      baseUrl: publicEnvironment(
        "KP_AWAZ_API_BASE_URL",
        "",
      ).replace(/\/+$/, ""),
      requestTimeoutMs: positiveIntegerEnvironment(
        "KP_AWAZ_API_TIMEOUT_MS",
        developmentConfig.api.requestTimeoutMs,
      ),
      audioUploadTimeoutMs: positiveIntegerEnvironment(
        "KP_AWAZ_AUDIO_UPLOAD_TIMEOUT_MS",
        developmentConfig.api.audioUploadTimeoutMs,
      ),
    },
    auth: {
      supabaseUrl: publicEnvironment(
        "KP_AWAZ_SUPABASE_URL",
        "",
      ).replace(/\/+$/, ""),
      supabasePublishableKey: publicEnvironment(
        "KP_AWAZ_SUPABASE_PUBLISHABLE_KEY",
        "",
      ),
      redirectUrl: frontendBaseUrl
        ? `${frontendBaseUrl}/dashboard.html`
        : "/dashboard.html",
      passwordResetRedirectUrl: frontendBaseUrl
        ? `${frontendBaseUrl}/reset-password.html`
        : "/reset-password.html",
    },
  };
  validatePublicBuildConfiguration(config);
  return config;
}

async function writeRuntimeConfiguration(config) {
  const serialized = `Object.freeze({
  environment: ${JSON.stringify(config.environment)},
  version: ${JSON.stringify(config.version)},
  frontendBaseUrl: ${JSON.stringify(config.frontendBaseUrl)},
  api: Object.freeze(${JSON.stringify(config.api, null, 2)}),
  auth: Object.freeze(${JSON.stringify(config.auth, null, 2)}),
})`;
  await writeFile(
    resolve(outputRoot, "scripts", "config.js"),
    `export const appConfig = ${serialized};\n`,
    "utf8",
  );
}

async function assemblePage(pageName) {
  const templatePath = resolve(projectRoot, pageName);
  let html = await readFile(templatePath, "utf8");
  const partialPattern = /<div data-partial="([^"]+)"><\/div>/g;
  const partials = [...html.matchAll(partialPattern)];

  for (const match of partials) {
    const [placeholder, partialPath] = match;
    const partial = await readFile(resolve(projectRoot, partialPath), "utf8");
    html = html.replace(placeholder, partial.trim());
  }

  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, pageName), html, "utf8");
}

async function copyRuntimeAssets() {
  for (const directory of ["assets", "scripts", "styles"]) {
    await cp(resolve(projectRoot, directory), resolve(outputRoot, directory), {
      recursive: true,
      force: true,
    });
  }
}

async function writeSitesArtifacts() {
  const clientRoot = resolve(outputRoot, "client");
  const serverRoot = resolve(outputRoot, "server");
  const hostingRoot = resolve(outputRoot, ".openai");
  const sitesPages = {};
  await mkdir(clientRoot, { recursive: true });
  await mkdir(serverRoot, { recursive: true });
  await mkdir(hostingRoot, { recursive: true });
  for (const pageName of productionPages) {
    const html = await readFile(resolve(outputRoot, pageName), "utf8");
    sitesPages[`/${pageName}`] = html;
    sitesPages[`/${pageName.replace(/\.html$/, "")}`] = html;
    await cp(
      resolve(outputRoot, pageName),
      resolve(clientRoot, pageName),
      { force: true },
    );
  }
  for (const directory of ["assets", "scripts", "styles"]) {
    await cp(resolve(outputRoot, directory), resolve(clientRoot, directory), {
      recursive: true,
      force: true,
    });
  }
  await cp(
    resolve(projectRoot, ".openai", "hosting.json"),
    resolve(hostingRoot, "hosting.json"),
    { force: true },
  );
  await writeFile(
    resolve(serverRoot, "index.js"),
    `const HTML_PAGES = Object.freeze(${JSON.stringify({
      ...sitesPages,
      "/": sitesPages["/index.html"],
    })});

export default {
  async fetch(request, environment) {
    const pathname = new URL(request.url).pathname.replace(/\\/$/, "") || "/";
    const html = HTML_PAGES[pathname];
    if (typeof html === "string") {
      return new Response(html, {
        headers: {
          "Cache-Control": "no-cache",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }
    if (!environment?.ASSETS || typeof environment.ASSETS.fetch !== "function") {
      return new Response("Static assets are unavailable.", { status: 503 });
    }
    const response = await environment.ASSETS.fetch(request);
    if (pathname !== "/scripts/config.js") {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-cache");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
`,
    "utf8",
  );
}

const runtimeConfig = productionAppConfig();

await rm(outputRoot, { recursive: true, force: true });
await buildSupabaseVendorBundle();
for (const pageName of productionPages) {
  await assemblePage(pageName);
}
await copyRuntimeAssets();
if (buildEnvironment === "production") {
  await writeRuntimeConfiguration(runtimeConfig);
}
await writeSitesArtifacts();
console.log(`Frontend files created in ${outputRoot}`);
