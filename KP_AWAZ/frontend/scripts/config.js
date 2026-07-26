const FALLBACK_LOCATION = Object.freeze({
  origin: "http://127.0.0.1:4173",
  protocol: "http:",
  hostname: "127.0.0.1",
});


function browserLocation() {
  return typeof globalThis !== "undefined" &&
    globalThis.location &&
    typeof globalThis.location.origin === "string"
    ? globalThis.location
    : null;
}


export function resolveRuntimeUrls(location = browserLocation()) {
  const runtimeLocation = location ?? FALLBACK_LOCATION;
  const frontendBaseUrl =
    typeof runtimeLocation.origin === "string" && runtimeLocation.origin !== "null"
      ? runtimeLocation.origin.replace(/\/+$/, "")
      : FALLBACK_LOCATION.origin;
  const backendProtocol = runtimeLocation.protocol === "https:" ? "https:" : "http:";
  const rawHostname =
    typeof runtimeLocation.hostname === "string" && runtimeLocation.hostname.trim()
      ? runtimeLocation.hostname.trim()
      : FALLBACK_LOCATION.hostname;
  const backendHostname =
    rawHostname.includes(":") && !rawHostname.startsWith("[")
      ? `[${rawHostname}]`
      : rawHostname;

  return Object.freeze({
    frontendBaseUrl,
    apiBaseUrl: `${backendProtocol}//${backendHostname}:8000/api`,
  });
}


const runtimeUrls = resolveRuntimeUrls();

export const appConfig = Object.freeze({
  environment: "development",
  version: "1.0.0-dev",

  frontendBaseUrl: runtimeUrls.frontendBaseUrl,

  api: Object.freeze({
    baseUrl: runtimeUrls.apiBaseUrl,
    requestTimeoutMs: 20_000,
    audioUploadTimeoutMs: 120_000,
  }),

  auth: Object.freeze({
    supabaseUrl: "https://hiaaggzinpancamdjryx.supabase.co",
    supabasePublishableKey:
      "sb_publishable_n1UnKIc041PaXgmZM-hRpw_f60XCkxE",

    redirectUrl: "/dashboard.html",
    passwordResetRedirectUrl: "/reset-password.html",
  }),
});
