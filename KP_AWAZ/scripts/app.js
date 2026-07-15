import { initContributions } from "./modules/contributions.js";
import { initFaq } from "./modules/faq.js";
import { initNavigation } from "./modules/navigation.js";
import { loadPartials, restoreHashPosition } from "./modules/partials.js";
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
    if (state.error?.code === "AUTH_NOT_CONFIGURED") {
      console.info("Authentication is not configured.");
    }
  } catch {
    console.warn("Authentication could not be initialized.");
  }
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

window.addEventListener("beforeunload", destroyAuthService, { once: true });
bootstrap();
