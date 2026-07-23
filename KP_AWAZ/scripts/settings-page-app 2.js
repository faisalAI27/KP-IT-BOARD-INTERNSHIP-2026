import { getCurrentAuthState, updatePassword } from "./services/auth-service.js?v=20260717-auth-routing";
import { updateMyProfile } from "./services/profile-api.js?v=20260717-member-workspace";
import { destroyWorkspace, initializeWorkspace, updateWorkspaceIdentity } from "./modules/workspace-shell.js?v=20260717-auth-routing";
import { WithdrawalSettings } from "./modules/withdrawal-settings.js?v=20260719-withdrawals";


let generation = 0;
let withdrawalSettings = null;


function message(id, value, tone) {
  const element = document.getElementById(id);
  element.textContent = value;
  element.dataset.tone = tone;
  element.hidden = false;
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
  for (const id of ["settingsNewPassword", "settingsConfirmPassword"]) {
    const input = document.getElementById(id);
    if (input) { input.value = ""; input.type = "password"; }
  }
}


function initializeSettings({ profile, state }) {
  const pageGeneration = ++generation;
  const expectedUserId = state.backendUser.id;
  const preferenceForm = document.getElementById("settingsPreferenceForm");
  const language = document.getElementById("settingsLanguage");
  const optIn = document.getElementById("settingsLeaderboardOptIn");
  const preferenceSubmit = document.getElementById("settingsPreferenceSubmit");
  const preferenceLabel = document.getElementById("settingsPreferenceSubmitLabel");
  language.value = profile.preferredLanguage;
  if (!language.value) language.value = "Pashto";
  optIn.checked = profile.leaderboardOptIn;
  withdrawalSettings = new WithdrawalSettings();
  withdrawalSettings.initialize({ expectedUserId });

  preferenceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (preferenceSubmit.disabled || !preferenceForm.reportValidity()) return;
    preferenceSubmit.disabled = true;
    preferenceLabel.textContent = "Saving…";
    try {
      const updated = await updateMyProfile({ preferredLanguage: language.value, leaderboardOptIn: optIn.checked });
      if (pageGeneration !== generation || getCurrentAuthState().backendUser?.id !== expectedUserId) return;
      updateWorkspaceIdentity(updated);
      message("settingsPreferenceMessage", "Preferences saved.", "success");
    } catch {
      if (pageGeneration === generation && getCurrentAuthState().backendUser?.id === expectedUserId) message("settingsPreferenceMessage", "Preferences could not be saved. Please try again.", "error");
    } finally {
      preferenceSubmit.disabled = false;
      preferenceLabel.textContent = "Save preferences";
    }
  });

  const passwordForm = document.getElementById("settingsPasswordForm");
  const provider = String(profile.authProvider ?? "").toLowerCase();
  if (provider === "google") {
    passwordForm.hidden = true;
    document.getElementById("passwordSettingsIntro").hidden = true;
    document.getElementById("googlePasswordNotice").hidden = false;
    return;
  }

  bindPasswordToggle("toggleSettingsPassword", "settingsNewPassword");
  bindPasswordToggle("toggleSettingsConfirmPassword", "settingsConfirmPassword");
  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const first = document.getElementById("settingsNewPassword");
    const second = document.getElementById("settingsConfirmPassword");
    if (first.value.length < 8) { message("settingsPasswordMessage", "Password must contain at least 8 characters.", "error"); clearPasswords(); return; }
    if (first.value !== second.value) { message("settingsPasswordMessage", "Passwords do not match.", "error"); clearPasswords(); return; }
    const submit = document.getElementById("settingsPasswordSubmit");
    const label = document.getElementById("settingsPasswordSubmitLabel");
    submit.disabled = true; label.textContent = "Updating securely…";
    try {
      await updatePassword(first.value);
      if (getCurrentAuthState().backendUser?.id !== expectedUserId) return;
      message("settingsPasswordMessage", "Password updated successfully.", "success");
    } catch {
      if (getCurrentAuthState().backendUser?.id === expectedUserId) message("settingsPasswordMessage", "We could not update the password. Please try again.", "error");
    } finally {
      clearPasswords(); submit.disabled = false; label.textContent = "Update password";
    }
  });
}


window.addEventListener("beforeunload", () => { generation += 1; clearPasswords(); withdrawalSettings?.destroy(); withdrawalSettings = null; destroyWorkspace(); }, { once: true });
void initializeWorkspace({ page: "settings", onReady: initializeSettings }).catch(() => { document.body.dataset.workspaceState = "error"; });
