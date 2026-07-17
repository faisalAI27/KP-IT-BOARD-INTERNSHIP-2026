import {
  destroyAuthService,
  requestPasswordReset,
} from "./services/auth-service.js?v=20260717-auth-routing";


const SAFE_SUCCESS = "If an account is associated with that email, password-reset instructions have been sent.";


const form = document.getElementById("forgotPasswordForm");
const input = document.getElementById("recoveryEmail");
const submit = document.getElementById("recoverySubmit");
const label = document.getElementById("recoverySubmitLabel");
const message = document.getElementById("recoveryMessage");


function showMessage(value, tone = "success") {
  message.textContent = value;
  message.dataset.tone = tone;
  message.hidden = false;
}


form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled || !form.reportValidity()) return;
  submit.disabled = true;
  label.textContent = "Sending safely…";
  message.hidden = true;
  try {
    await requestPasswordReset(input.value);
    form.reset();
    showMessage(SAFE_SUCCESS);
  } catch (error) {
    showMessage(
      error?.code === "INVALID_EMAIL"
        ? "Enter a valid email address."
        : "We could not send reset instructions. Please try again.",
      "error",
    );
  } finally {
    submit.disabled = false;
    label.textContent = "Send reset instructions";
  }
});


window.addEventListener("beforeunload", () => {
  form?.reset();
  destroyAuthService();
}, { once: true });
