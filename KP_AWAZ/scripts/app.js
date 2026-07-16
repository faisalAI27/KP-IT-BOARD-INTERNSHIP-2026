import {
  destroyContributions,
  initContributions,
} from "./modules/contributions.js";
import { initFaq } from "./modules/faq.js";
import { initNavigation } from "./modules/navigation.js";
import { loadPartials, restoreHashPosition } from "./modules/partials.js";
import { destroyAuthUI, initAuthUI } from "./modules/auth-ui.js";
import {
  destroyMyContributions,
  initializeMyContributions,
} from "./modules/my-contributions.js";
import { destroyProfileUI, initProfileUI } from "./modules/profile-ui.js";
import {
  destroyAuthService,
  initializeAuthService,
} from "./services/auth-service.js";

function showBootError(error) {
  const message = document.createElement("div");
  message.className = "app-error";
  message.setAttribute("role", "alert");
  message.innerHTML = `
    <strong>The page could not be assembled.</strong>
    <span>${error.message}</span>
    <small>Run the site through a local web server instead of opening index.html directly.</small>
  `;
  document.body.append(message);
}

async function initializeAuthentication() {
  try {
    const state = await initializeAuthService();
    initializeAuthenticationInterfaces();
    if (state.error?.code === "AUTH_NOT_CONFIGURED") {
      console.info("Authentication is not configured.");
    }
  } catch {
    console.warn("Authentication could not be initialized.");
    initializeAuthenticationInterfaces();
  }
}

function initializeAuthenticationInterfaces() {
  try {
    initAuthUI();
  } catch {
    // Authentication UI failures remain isolated from the rest of the page.
  }

  try {
    initProfileUI();
  } catch {
    // Profile UI failures remain isolated from authentication and the page.
  }

  try {
    initializeMyContributions();
  } catch {
    // Contribution history failures remain isolated from account settings.
  }
}

function cleanupApplication() {
  destroyContributions();
  destroyMyContributions();
  destroyProfileUI();
  destroyAuthUI();
  destroyAuthService();
}

async function bootstrap() {
  try {
    await loadPartials();
    initNavigation();
    initFaq();
    await initContributions();
    void initializeAuthentication();
    restoreHashPosition();
    document.body.dataset.appState = "ready";
  } catch (error) {
    document.body.dataset.appState = "error";
    showBootError(error);
    console.error(error);
  }
}

window.addEventListener("beforeunload", cleanupApplication, { once: true });
bootstrap();
