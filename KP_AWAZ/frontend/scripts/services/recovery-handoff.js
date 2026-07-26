const RECOVERY_EMAIL_KEY = "kp_awaz_recovery_email_handoff";


function safeSessionStorage(storage = globalThis.sessionStorage) {
  try {
    return storage ?? null;
  } catch {
    return null;
  }
}


export function preserveRecoveryEmailForSignIn(email, storage) {
  const normalizedEmail =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalizedEmail) return false;
  try {
    safeSessionStorage(storage)?.setItem(RECOVERY_EMAIL_KEY, normalizedEmail);
    return true;
  } catch {
    return false;
  }
}


export function consumeRecoveryEmailForSignIn(storage) {
  const sessionStorage = safeSessionStorage(storage);
  if (!sessionStorage) return "";
  try {
    const email = sessionStorage.getItem(RECOVERY_EMAIL_KEY) ?? "";
    sessionStorage.removeItem(RECOVERY_EMAIL_KEY);
    return email.trim().toLowerCase();
  } catch {
    return "";
  }
}


export function clearRecoveryEmailHandoff(storage) {
  try {
    safeSessionStorage(storage)?.removeItem(RECOVERY_EMAIL_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}
