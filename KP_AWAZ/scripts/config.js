export const appConfig = Object.freeze({
  environment: "development",
  version: "1.0.0-dev",
  frontendBaseUrl: "http://127.0.0.1:4173",
  api: Object.freeze({
    baseUrl: "http://127.0.0.1:8000/api",
    requestTimeoutMs: 20_000,
    audioUploadTimeoutMs: 120_000,
  }),
  auth: Object.freeze({
    supabaseUrl: "https://hiaaggzinpancamdjryx.supabase.co",
    supabasePublishableKey: "sb_publishable_n1UnKIc041PaXgmZM-hRpw_f60XCkxE",
    redirectUrl: "/dashboard.html",
    passwordResetRedirectUrl: "/reset-password.html",
  }),
});
