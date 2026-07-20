import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";


const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scannerPath = resolve(projectRoot, "tools", "secret-scan.mjs");
const distRoot = resolve(projectRoot, "dist");
const localEnvironmentPath = resolve(projectRoot, "backend", ".env");
const findings = [];

function trackedFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
    { cwd: projectRoot, encoding: "utf8" },
  );
  return output
    .split("\0")
    .filter(Boolean)
    .map((name) => resolve(projectRoot, name))
    .filter((path) => path !== scannerPath);
}

function filesBelow(root) {
  if (!existsSync(root)) return [];
  const results = [];
  for (const name of readdirSync(root)) {
    const path = resolve(root, name);
    const metadata = statSync(path);
    if (metadata.isDirectory()) results.push(...filesBelow(path));
    else if (metadata.isFile()) results.push(path);
  }
  return results;
}

function readableText(path) {
  try {
    const content = readFileSync(path);
    if (content.includes(0)) return null;
    return content.toString("utf8");
  } catch {
    return null;
  }
}

function report(path, label) {
  findings.push({ file: relative(projectRoot, path), label });
}

function containsServiceRoleJwt(content) {
  const candidates =
    content.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [];
  return candidates.some((candidate) => {
    try {
      const payload = JSON.parse(
        Buffer.from(candidate.split(".")[1], "base64url"),
      );
      return payload?.role === "service_role";
    } catch {
      return false;
    }
  });
}

const sourceFiles = trackedFiles();
const buildFiles = filesBelow(distRoot);
const genericPatterns = [
  ["Supabase secret-key literal", /sb_secret_[A-Za-z0-9_-]{16,}/],
  ["Google client-secret literal", /GOCSPX-[A-Za-z0-9_-]{12,}/],
  [
    "Server-secret assignment",
    /\b(?:ADMIN_API_KEY|SUPABASE_SECRET_KEY|SMTP_PASSWORD|GOOGLE_CLIENT_SECRET)\s*=\s*(?!\s*(?:$|replace|your-|<|\{))[A-Za-z0-9_./+-]{16,}/m,
  ],
];

for (const path of [...sourceFiles, ...buildFiles]) {
  const vendorRoot = resolve(projectRoot, "dist", "scripts", "vendor");
  if (path === vendorRoot || path.startsWith(`${vendorRoot}/`)) continue;
  const content = readableText(path);
  if (content === null) continue;
  for (const [label, pattern] of genericPatterns) {
    if (pattern.test(content)) report(path, label);
  }
  if (containsServiceRoleJwt(content)) {
    report(path, "Supabase service-role JWT");
  }
}

if (sourceFiles.includes(localEnvironmentPath)) {
  report(localEnvironmentPath, "Tracked local environment file");
}

if (existsSync(localEnvironmentPath)) {
  const environment = readFileSync(localEnvironmentPath, "utf8");
  const secretNames = new Set([
    "ADMIN_API_KEY",
    "SUPABASE_SECRET_KEY",
    "SMTP_PASSWORD",
    "GOOGLE_CLIENT_SECRET",
  ]);
  const configuredSecrets = environment
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
    .filter((match) => match && secretNames.has(match[1]))
    .map((match) => ({ name: match[1], value: match[2].trim() }))
    .filter(
      ({ value }) =>
        value.length >= 8 && !/replace|your-|placeholder/i.test(value),
    );
  for (const path of [...sourceFiles, ...buildFiles]) {
    const content = readableText(path);
    if (content === null) continue;
    for (const { name, value } of configuredSecrets) {
      if (content.includes(value)) report(path, `Configured ${name} value`);
    }
  }
}

const uniqueFindings = [
  ...new Map(
    findings.map((finding) => [`${finding.file}:${finding.label}`, finding]),
  ).values(),
];

if (uniqueFindings.length) {
  console.error("Secret scan failed. Rotate any real tracked secret and review:");
  for (const finding of uniqueFindings) {
    console.error(`- ${finding.file}: ${finding.label}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Secret scan passed (${sourceFiles.length} source files, ${buildFiles.length} build files).`,
  );
}
