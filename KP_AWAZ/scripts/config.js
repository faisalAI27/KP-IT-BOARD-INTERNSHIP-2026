const frontendBaseUrl = window.location.origin;
const backendHostname = window.location.hostname;

export const appConfig = Object.freeze({
  environment: "development",
  version: "1.0.0-dev",

  // Automatically uses localhost or your LAN IP.
  frontendBaseUrl,

  api: Object.freeze({
    // localhost:4173     → localhost:8000
    // 172.20.10.6:4173  → 172.20.10.6:8000
    baseUrl: `http://${backendHostname}:8000`,
    requestTimeoutMs: 20_000,
    audioUploadTimeoutMs: 120_000,
  }),

  auth: Object.freeze({
    supabaseUrl: "https://hiaaggzinpancamdjryx.supabase.co",
    supabasePublishableKey:
      "sb_publishable_n1UnKIc041PaXgmZM-hRpw_f60XCkxE",

    // Relative URLs automatically use the current frontend address.
    redirectUrl: "/dashboard.html",
    passwordResetRedirectUrl: "/reset-password.html",
  }),
});