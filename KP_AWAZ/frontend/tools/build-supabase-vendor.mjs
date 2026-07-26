import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";


const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = resolve(projectRoot, "scripts/vendor/supabase.js");


export async function buildSupabaseVendorBundle() {
  await mkdir(dirname(outputFile), { recursive: true });
  await build({
    bundle: true,
    format: "esm",
    legalComments: "none",
    logLevel: "silent",
    minify: true,
    outfile: outputFile,
    platform: "browser",
    stdin: {
      contents: 'export { createClient } from "@supabase/supabase-js";',
      loader: "js",
      resolveDir: projectRoot,
      sourcefile: "supabase-browser-entry.js",
    },
    target: ["es2020"],
  });
}


const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await buildSupabaseVendorBundle();
  console.log("Supabase browser vendor bundle created.");
}
