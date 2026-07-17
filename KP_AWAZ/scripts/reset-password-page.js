import {
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  destroyAuthService,
  initializeAuthService,
  isPasswordRecoverySession,
  updatePassword,
} from "./services/auth-service.js?v=20260717-auth-routing";


const form = document.getElementById("resetPasswordForm");
const password = document.getElementById("resetPassword");
const confirmation = document.getElementById("resetPasswordConfirm");
const submit = document.getElementById("resetSubmit");
const label = document.getElementById("resetSubmitLabel");
const message = document.getElementById("resetMessage");
const intro = document.getElementById("resetIntro");
const requestLink = document.getElementById("newRecoveryLink");


export function validateNewPasswords(first, second) {
  if (
    typeof first !== "string" ||
    first.length < ACCOUNT_PASSWORD_MIN_LENGTH ||
    first.length > ACCOUNT_PASSWORD_MAX_LENGTH
  ) return "Password must contain at least 8 characters.";
  if (first !== second) return "Passwords do not match.";
  return "";
}


function setMessage(value, tone = "error") {
  message.textContent = value;
  message.dataset.tone = tone;
  message.hidden = false;
}


function clearSecrets() {
  if (password) password.value = "";
  if (confirmation) confirmation.value = "";
}


function bindToggle(buttonId, input) {
  const button = document.getElementById(buttonId);
  button?.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Hide" : "Show";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
}


async function initialize() {
  bindToggle("toggleResetPassword", password);
  bindToggle("toggleResetPasswordConfirm", confirmation);
  try {
    const state = await initializeAuthService();
    if (
      state.status !== "signed_in" ||
      !state.backendUser?.id ||
      !isPasswordRecoverySession()
    ) {
      intro.textContent = "This recovery link is invalid or has expired.";
      requestLink.hidden = false;
      document.body.dataset.recoveryState = "invalid";
      return;
    }
    intro.textContent = "Choose a fresh password for your verified account.";
    form.hidden = false;
    document.body.dataset.recoveryState = "ready";
  } catch {
    intro.textContent = "This recovery session could not be verified.";
    requestLink.hidden = false;
    document.body.dataset.recoveryState = "invalid";
  }
}


form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  const validation = validateNewPasswords(password.value, confirmation.value);
  if (validation) {
    setMessage(validation);
    clearSecrets();
    password.focus();
    return;
  }
  submit.disabled = true;
  label.textContent = "Updating securely…";
  message.hidden = true;
  try {
    await updatePassword(password.value);
    clearSecrets();
    if (globalThis.history?.replaceState) {
      history.replaceState({}, "", "reset-password.html");
    }
    form.hidden = true;
    intro.textContent = "Your password has been updated.";
    setMessage("Password updated. Opening your dashboard…", "success");
    globalThis.location.assign("dashboard.html");
  } catch {
    clearSecrets();
    setMessage("We could not update the password. Request a new recovery email and try again.");
    requestLink.hidden = false;
  } finally {
    submit.disabled = false;
    label.textContent = "Update password";
  }
});


window.addEventListener("beforeunload", () => {
  clearSecrets();
  destroyAuthService();
}, { once: true });


void initialize();
