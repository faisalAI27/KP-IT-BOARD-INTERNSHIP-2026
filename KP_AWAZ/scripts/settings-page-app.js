import {
  getCurrentAuthState,
  updatePassword,
} from "./services/auth-service.js?v=20260717-auth-routing";
import {
  getMyConsentSummary,
  getMyContributionStatistics,
  updateMyProfile,
} from "./services/profile-api.js?v=20260723-unified-settings";
import {
  destroyWorkspace,
  initializeWorkspace,
  updateWorkspaceIdentity,
} from "./modules/workspace-shell.js?v=20260717-auth-routing";
import { WithdrawalSettings } from "./modules/withdrawal-settings.js?v=20260719-withdrawals";


let generation = 0;
let withdrawalSettings = null;
let currentProfile = null;
let impactLoading = false;
let consentLoading = false;


function message(id, value, tone = "info") {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = value;
  element.dataset.tone = tone;
  element.hidden = !value;
}


function isCurrent(pageGeneration, expectedUserId) {
  return (
    pageGeneration === generation &&
    getCurrentAuthState().backendUser?.id === expectedUserId
  );
}


function ensureLanguageOption(select, value) {
  if (!value || Array.from(select.options).some((option) => option.value === value)) return;
  const option = document.createElement("option");
  option.value = value;
  option.textContent = value;
  select.append(option);
}


function formatMemberSince(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
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


function populateProfileForm(profile) {
  const displayName = document.getElementById("settingsDisplayName");
  const email = document.getElementById("settingsVerifiedEmail");
  const language = document.getElementById("settingsLanguage");
  const optIn = document.getElementById("settingsLeaderboardOptIn");
  ensureLanguageOption(language, profile.preferredLanguage);
  displayName.value = profile.displayName;
  email.value = profile.email ?? "";
  language.value = profile.preferredLanguage;
  optIn.checked = profile.leaderboardOptIn;
}


function profileUpdates() {
  const displayName = document.getElementById("settingsDisplayName").value.trim();
  const preferredLanguage = document.getElementById("settingsLanguage").value.trim();
  const leaderboardOptIn = document.getElementById("settingsLeaderboardOptIn").checked;
  const updates = {};
  if (displayName !== currentProfile.displayName) updates.displayName = displayName;
  if (preferredLanguage !== currentProfile.preferredLanguage) {
    updates.preferredLanguage = preferredLanguage;
  }
  if (leaderboardOptIn !== currentProfile.leaderboardOptIn) {
    updates.leaderboardOptIn = leaderboardOptIn;
  }
  return updates;
}


function bindPasswordToggle(buttonId, inputId) {
  const button = document.getElementById(buttonId);
  const input = document.getElementById(inputId);
  button.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Hide" : "Show";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
}


function clearPasswords() {
  for (const [inputId, buttonId, label] of [
    ["settingsNewPassword", "toggleSettingsPassword", "Show new password"],
    ["settingsConfirmPassword", "toggleSettingsConfirmPassword", "Show confirmed password"],
  ]) {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    if (input) {
      input.value = "";
      input.type = "password";
    }
    if (button) {
      button.textContent = "Show";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", label);
    }
  }
}


async function loadImpact({ pageGeneration, expectedUserId }) {
  if (impactLoading) return;
  impactLoading = true;
  const refresh = document.getElementById("refreshSettingsImpactButton");
  const retry = document.getElementById("retrySettingsImpactButton");
  const error = document.getElementById("settingsImpactError");
  const status = document.getElementById("settingsImpactStatus");
  refresh.disabled = true;
  retry.disabled = true;
  error.hidden = true;
  status.hidden = false;
  status.textContent = "Loading contribution impact…";
  try {
    const statistics = await getMyContributionStatistics();
    if (!isCurrent(pageGeneration, expectedUserId)) return;
    document.getElementById("settingsApprovedCount").textContent =
      String(statistics.approvedContributions);
    document.getElementById("settingsPublicRank").textContent =
      statistics.publicRank ? `#${statistics.publicRank}` : "Not ranked";
    status.hidden = true;
  } catch {
    if (!isCurrent(pageGeneration, expectedUserId)) return;
    document.getElementById("settingsApprovedCount").textContent = "Unavailable";
    document.getElementById("settingsPublicRank").textContent = "Unavailable";
    error.dataset.tone = "error";
    error.hidden = false;
    status.hidden = true;
  } finally {
    impactLoading = false;
    refresh.disabled = false;
    retry.disabled = false;
  }
}


async function loadConsent({ pageGeneration, expectedUserId }) {
  if (consentLoading) return;
  consentLoading = true;
  const retry = document.getElementById("retrySettingsConsentButton");
  const error = document.getElementById("settingsConsentError");
  const status = document.getElementById("settingsConsentStatus");
  retry.disabled = true;
  error.hidden = true;
  status.hidden = false;
  status.textContent = "Loading consent record…";
  try {
    const consent = await getMyConsentSummary();
    if (!isCurrent(pageGeneration, expectedUserId)) return;
    document.getElementById("settingsConsentVersion").textContent =
      `Version ${consent.currentPolicyVersion}`;
    document.getElementById("settingsConsentDate").textContent =
      formatConsentDate(consent.mostRecentConsentAt);
    document.getElementById("settingsConsentNote").textContent =
      consent.mostRecentConsentAt
        ? "This is your latest structured consent for a submitted recording."
        : "No structured consent is recorded yet. Older contributions have legacy consent status unknown.";
    status.hidden = true;
  } catch {
    if (!isCurrent(pageGeneration, expectedUserId)) return;
    document.getElementById("settingsConsentVersion").textContent = "Unavailable";
    document.getElementById("settingsConsentDate").textContent = "Unavailable";
    error.dataset.tone = "error";
    error.hidden = false;
    status.hidden = true;
  } finally {
    consentLoading = false;
    retry.disabled = false;
  }
}


function initializeSettings({ profile, state }) {
  const pageGeneration = ++generation;
  const expectedUserId = state.backendUser.id;
  currentProfile = { ...profile };
  populateProfileForm(currentProfile);
  const impactOptions = { pageGeneration, expectedUserId };

  document.getElementById("settingsAuthMethod").textContent =
    String(profile.authProvider ?? state.backendUser.provider ?? "email").toLowerCase() === "google"
      ? "Google"
      : "Email & password";
  document.getElementById("settingsMemberSince").textContent =
    formatMemberSince(profile.createdAt);

  withdrawalSettings = new WithdrawalSettings();
  withdrawalSettings.initialize({ expectedUserId });

  const preferenceForm = document.getElementById("settingsPreferenceForm");
  const preferenceSubmit = document.getElementById("settingsPreferenceSubmit");
  const preferenceLabel = document.getElementById("settingsPreferenceSubmitLabel");
  const displayName = document.getElementById("settingsDisplayName");

  preferenceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    displayName.value = displayName.value.trim();
    if (preferenceSubmit.disabled || !preferenceForm.reportValidity()) return;
    const updates = profileUpdates();
    if (Object.keys(updates).length === 0) {
      message("settingsPreferenceMessage", "No account changes to save.", "info");
      return;
    }
    preferenceSubmit.disabled = true;
    preferenceLabel.textContent = "Saving…";
    try {
      const updated = await updateMyProfile(updates);
      if (!isCurrent(pageGeneration, expectedUserId)) return;
      currentProfile = { ...updated };
      populateProfileForm(currentProfile);
      updateWorkspaceIdentity(updated);
      message("settingsPreferenceMessage", "Settings saved successfully.", "success");
      void loadImpact(impactOptions);
    } catch {
      if (isCurrent(pageGeneration, expectedUserId)) {
        message(
          "settingsPreferenceMessage",
          "Settings could not be saved. Please try again.",
          "error",
        );
      }
    } finally {
      preferenceSubmit.disabled = false;
      preferenceLabel.textContent = "Save changes";
    }
  });

  document.getElementById("settingsPreferenceCancel").addEventListener("click", () => {
    populateProfileForm(currentProfile);
    message("settingsPreferenceMessage", "Unsaved account changes were discarded.", "info");
  });

  const passwordForm = document.getElementById("settingsPasswordForm");
  const provider = String(
    profile.authProvider ?? state.backendUser.provider ?? "",
  ).toLowerCase();
  if (provider === "google") {
    passwordForm.hidden = true;
    document.getElementById("passwordSettingsIntro").hidden = true;
    document.getElementById("googlePasswordNotice").hidden = false;
  } else {
    bindPasswordToggle("toggleSettingsPassword", "settingsNewPassword");
    bindPasswordToggle("toggleSettingsConfirmPassword", "settingsConfirmPassword");
    passwordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const first = document.getElementById("settingsNewPassword");
      const second = document.getElementById("settingsConfirmPassword");
      if (first.value.length < 8) {
        message("settingsPasswordMessage", "Password must contain at least 8 characters.", "error");
        clearPasswords();
        return;
      }
      if (first.value !== second.value) {
        message("settingsPasswordMessage", "Passwords do not match.", "error");
        clearPasswords();
        return;
      }
      const submit = document.getElementById("settingsPasswordSubmit");
      const label = document.getElementById("settingsPasswordSubmitLabel");
      submit.disabled = true;
      label.textContent = "Updating securely…";
      try {
        await updatePassword(first.value);
        if (!isCurrent(pageGeneration, expectedUserId)) return;
        message("settingsPasswordMessage", "Password updated successfully.", "success");
      } catch {
        if (isCurrent(pageGeneration, expectedUserId)) {
          message(
            "settingsPasswordMessage",
            "We could not update the password. Please try again.",
            "error",
          );
        }
      } finally {
        clearPasswords();
        submit.disabled = false;
        label.textContent = "Update password";
      }
    });
  }

  document.getElementById("refreshSettingsImpactButton")
    .addEventListener("click", () => void loadImpact(impactOptions));
  document.getElementById("retrySettingsImpactButton")
    .addEventListener("click", () => void loadImpact(impactOptions));
  document.getElementById("retrySettingsConsentButton")
    .addEventListener("click", () => void loadConsent(impactOptions));
  void loadImpact(impactOptions);
  void loadConsent(impactOptions);
}


window.addEventListener(
  "beforeunload",
  () => {
    generation += 1;
    currentProfile = null;
    clearPasswords();
    withdrawalSettings?.destroy();
    withdrawalSettings = null;
    destroyWorkspace();
  },
  { once: true },
);


void initializeWorkspace({ page: "settings", onReady: initializeSettings }).catch(() => {
  document.body.dataset.workspaceState = "error";
});
