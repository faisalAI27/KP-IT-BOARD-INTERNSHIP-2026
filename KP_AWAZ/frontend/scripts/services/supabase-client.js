import { appConfig } from "../config.js?v=20260723-auth-config-v2";
import { createClient } from "../vendor/supabase.js?v=20260723-auth-config-v2";


const AUTH_NOT_CONFIGURED_MESSAGE = "Authentication is not configured yet.";
const SUPABASE_AUTH_OPTIONS = Object.freeze({
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
});

let supabaseClient = null;


export class AuthConfigurationError extends Error {
  constructor(message = AUTH_NOT_CONFIGURED_MESSAGE) {
    super(message);
    this.name = "AuthConfigurationError";
    this.code = "AUTH_NOT_CONFIGURED";
    this.status = 0;
  }
}


export function normalizeSupabaseUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}


export function isSupabaseConfigured(config = appConfig.auth) {
  return Boolean(
    normalizeSupabaseUrl(config?.supabaseUrl) &&
      typeof config?.supabasePublishableKey === "string" &&
      config.supabasePublishableKey.trim(),
  );
}


export function resolveAuthRedirectUrl(
  config = appConfig.auth,
  locationOrigin = globalThis.location?.origin,
) {
  const configuredRedirect =
    typeof config?.redirectUrl === "string" ? config.redirectUrl.trim() : "";

  try {
    if (configuredRedirect) {
      return new URL(configuredRedirect, locationOrigin).href;
    }
    return new URL("/", locationOrigin).href;
  } catch {
    throw new AuthConfigurationError();
  }
}


export function getSupabaseClient({
  config = appConfig.auth,
  createClientImpl = createClient,
  locationOrigin = globalThis.location?.origin,
} = {}) {
  if (supabaseClient) return supabaseClient;
  if (!isSupabaseConfigured(config)) throw new AuthConfigurationError();

  const supabaseUrl = normalizeSupabaseUrl(config.supabaseUrl);
  const publishableKey = config.supabasePublishableKey.trim();
  resolveAuthRedirectUrl(config, locationOrigin);

  supabaseClient = createClientImpl(supabaseUrl, publishableKey, {
    auth: { ...SUPABASE_AUTH_OPTIONS },
  });
  return supabaseClient;
}


export function resetSupabaseClientForTests() {
  supabaseClient = null;
}
