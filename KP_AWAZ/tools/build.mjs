import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSupabaseVendorBundle } from "./build-supabase-vendor.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(projectRoot, "dist");

async function assemblePage() {
  const templatePath = resolve(projectRoot, "index.html");
  let html = await readFile(templatePath, "utf8");
  const partialPattern = /<div data-partial="([^"]+)"><\/div>/g;
  const partials = [...html.matchAll(partialPattern)];

  for (const match of partials) {
    const [placeholder, partialPath] = match;
    const partial = await readFile(resolve(projectRoot, partialPath), "utf8");
    html = html.replace(placeholder, partial.trim());
  }

  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, "index.html"), html, "utf8");
}

async function copyRuntimeAssets() {
  for (const directory of ["assets", "scripts", "styles"]) {
    await cp(resolve(projectRoot, directory), resolve(outputRoot, directory), {
      recursive: true,
      force: true,
    });
  }
}

await rm(outputRoot, { recursive: true, force: true });
await buildSupabaseVendorBundle();
await assemblePage();
await copyRuntimeAssets();
console.log(`Production files created in ${outputRoot}`);
