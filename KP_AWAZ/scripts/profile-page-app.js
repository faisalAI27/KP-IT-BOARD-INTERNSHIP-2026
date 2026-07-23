import { ProfileUI } from "./modules/profile-ui.js?v=20260717-member-workspace";
import {
  getMyConsentSummary,
  getMyContributionStatistics,
} from "./services/profile-api.js?v=20260718-consent";
import { getCurrentAuthState } from "./services/auth-service.js?v=20260723-auth-config-v2";
import {
  destroyWorkspace,
  initialsForIdentity,
  initializeWorkspace,
  updateWorkspaceIdentity,
} from "./modules/workspace-shell.js?v=20260723-auth-config-v2";


let profileUI = null;
let verifiedEmail = "";
let impactLoading = false;
let consentLoading = false;
let profileUserId = "";


function updateProfilePortrait(displayName) {
  const safeName = typeof displayName === "string" && displayName.trim()
    ? displayName.trim()
    : "Contributor";
  const name = document.getElementById("profileHeroName");
  const avatar = document.getElementById("profileHeroAvatar");
  if (name) name.textContent = safeName;
  if (avatar) avatar.textContent = initialsForIdentity(safeName, verifiedEmail);
  updateWorkspaceIdentity({ displayName: safeName, email: verifiedEmail });
}


function formatMemberSince(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(new Date(value));
}


function formatConsentDate(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return "None recorded";
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}


async function loadProfileImpact() {
  if (impactLoading) return;
  impactLoading = true;
  const expectedUserId = profileUserId;
  const section = document.getElementById("accountScoreSection");
  const score = document.getElementById("accountScoreValue");
  const rank = document.getElementById("profileSummaryRank");
  const refresh = document.getElementById("refreshAccountScoreButton");
  const error = document.getElementById("accountScoreError");
  const status = document.getElementById("accountScoreStatus");
  section.hidden = false;
  refresh.disabled = true;
  error.hidden = true;
  status.hidden = false;
  status.textContent = "Loading contribution score…";
  try {
    const statistics = await getMyContributionStatistics();
    if (
      !expectedUserId ||
      getCurrentAuthState().backendUser?.id !== expectedUserId
    ) {
      return;
    }
    score.textContent = `${statistics.approvedContributions} approved`;
    rank.textContent = statistics.publicRank ? `#${statistics.publicRank}` : "Not currently ranked";
    status.hidden = true;
  } catch {
    score.textContent = "Unavailable";
    rank.textContent = "Unavailable";
    error.hidden = false;
    status.hidden = true;
  } finally {
    impactLoading = false;
    refresh.disabled = false;
  }
}


async function loadProfileConsent() {
  if (consentLoading) return;
  consentLoading = true;
  const expectedUserId = profileUserId;
  const section = document.getElementById("profileConsentSection");
  const version = document.getElementById("profileConsentVersion");
  const date = document.getElementById("profileConsentDate");
  const note = document.getElementById("profileConsentNote");
  const status = document.getElementById("profileConsentStatus");
  const error = document.getElementById("profileConsentError");
  const retry = document.getElementById("retryProfileConsentButton");
  section.hidden = false;
  retry.disabled = true;
  error.hidden = true;
  status.hidden = false;
  status.textContent = "Loading consent record…";
  try {
    const consent = await getMyConsentSummary();
    if (!expectedUserId || getCurrentAuthState().backendUser?.id !== expectedUserId) return;
    version.textContent = `Version ${consent.currentPolicyVersion}`;
    date.textContent = formatConsentDate(consent.mostRecentConsentAt);
    note.textContent = consent.mostRecentConsentAt
      ? "This is your latest structured consent for a submitted recording."
      : "No structured consent is recorded yet. Older contributions have legacy consent status unknown.";
    status.hidden = true;
  } catch {
    version.textContent = "Unavailable";
    date.textContent = "Unavailable";
    error.hidden = false;
    status.hidden = true;
  } finally {
    consentLoading = false;
    retry.disabled = false;
  }
}


function initializeProfilePage({ state, profile }) {
  profileUserId = state.backendUser.id;
  verifiedEmail = profile?.email ?? state.backendUser?.email ?? "";
  const email = document.getElementById("profileHeroEmail");
  if (email) email.textContent = verifiedEmail || "Verified email unavailable";
  updateProfilePortrait(profile?.displayName);
  document.getElementById("profileAuthMethod").textContent =
    String(profile?.authProvider ?? state.backendUser?.provider ?? "email").toLowerCase() === "google"
      ? "Google"
      : "Email & password";
  document.getElementById("profileSummaryLanguage").textContent = profile?.preferredLanguage ?? "Pashto";
  document.getElementById("profileContributorSince").textContent = formatMemberSince(profile?.createdAt);

  profileUI = new ProfileUI({
    setHeaderProfile(_userId, displayName) {
      if (displayName) updateProfilePortrait(displayName);
    },
  });
  profileUI.initProfileUI();
  document.getElementById("refreshAccountScoreButton").addEventListener("click", loadProfileImpact);
  document.getElementById("retryAccountScoreButton").addEventListener("click", loadProfileImpact);
  document
    .getElementById("retryProfileConsentButton")
    .addEventListener("click", loadProfileConsent);
  void loadProfileImpact();
  void loadProfileConsent();
}


window.addEventListener(
  "beforeunload",
  () => {
    profileUI?.destroyProfileUI();
    profileUserId = "";
    destroyWorkspace();
  },
  { once: true },
);


void initializeWorkspace({ page: "profile", onReady: initializeProfilePage }).catch(() => {
  document.body.dataset.workspaceState = "error";
});
