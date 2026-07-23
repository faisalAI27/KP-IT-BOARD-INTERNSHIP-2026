export const PUBLIC_PAGES = Object.freeze([
  "index.html",
  "about.html",
  "data-use.html",
  "how-it-works.html",
  "leaderboard.html",
]);

export const AUTH_ONLY_PAGES = Object.freeze(["auth.html"]);

export const PROTECTED_PAGES = Object.freeze([
  "dashboard.html",
  "contribute.html",
  "donate-text.html",
  "my-contributions.html",
  "profile.html",
  "settings.html",
]);

const PUBLIC_PAGE_SET = new Set(PUBLIC_PAGES);
const AUTH_ONLY_PAGE_SET = new Set(AUTH_ONLY_PAGES);
const PROTECTED_PAGE_SET = new Set(PROTECTED_PAGES);


export function normalizePageName(pathname = globalThis.location?.pathname) {
  const value = typeof pathname === "string" ? pathname.trim() : "";
  if (!value || value === "/") return "index.html";
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const page = withoutQuery.split("/").filter(Boolean).pop() ?? "";
  return page || "index.html";
}


export function pageCategory(pathname) {
  const page = normalizePageName(pathname);
  if (PUBLIC_PAGE_SET.has(page)) return "public";
  if (AUTH_ONLY_PAGE_SET.has(page)) return "auth-only";
  if (PROTECTED_PAGE_SET.has(page)) return "protected";
  if (page === "admin.html") return "admin";
  return "other";
}


export function isVerifiedAuthState(state) {
  return Boolean(state?.status === "signed_in" && state.backendUser?.id);
}


export function isSafeProtectedDestination(value) {
  return typeof value === "string" && PROTECTED_PAGE_SET.has(value.trim());
}


export function safeProtectedDestination(value, fallback = "dashboard.html") {
  return isSafeProtectedDestination(value) ? value.trim() : fallback;
}


export function protectedAuthDestination(pathname) {
  const page = safeProtectedDestination(normalizePageName(pathname));
  return `auth.html?next=${encodeURIComponent(page)}`;
}


export function routeDecision({ pathname, state } = {}) {
  const page = normalizePageName(pathname);
  const category = pageCategory(page);
  if (state?.status === "loading") {
    return Object.freeze({ action: "wait", category, destination: null, page });
  }

  if (category === "public" || category === "admin" || category === "other") {
    return Object.freeze({ action: "allow", category, destination: null, page });
  }

  if (category === "auth-only") {
    return Object.freeze({
      action: isVerifiedAuthState(state) ? "redirect" : "allow",
      category,
      destination: isVerifiedAuthState(state) ? "dashboard.html" : null,
      page,
    });
  }

  if (isVerifiedAuthState(state)) {
    return Object.freeze({ action: "allow", category, destination: null, page });
  }
  if (state?.status === "signed_out" || !state?.session) {
    return Object.freeze({
      action: "redirect",
      category,
      destination: protectedAuthDestination(page),
      page,
    });
  }
  return Object.freeze({ action: "verification-error", category, destination: null, page });
}


export function navigateOnce(location, destination, { replace = false } = {}) {
  if (!location || typeof destination !== "string" || !destination.trim()) return false;
  const current = normalizePageName(location.pathname);
  const target = normalizePageName(destination);
  if (current === target && !destination.includes("?")) return false;
  if (replace && typeof location.replace === "function") location.replace(destination);
  else if (typeof location.assign === "function") location.assign(destination);
  else location.href = destination;
  return true;
}
