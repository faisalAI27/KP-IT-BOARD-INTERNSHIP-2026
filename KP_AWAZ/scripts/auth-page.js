import {
  destroyAccountAccess,
  initializeAccountAccess,
} from "./modules/account-access.js?v=20260717-auth-routing";
import {
  destroyAuthCulturalPanel,
  initializeAuthCulturalPanel,
} from "./modules/auth-cultural-panel.js?v=20260717-cultural-hero";
import { destroyAuthService } from "./services/auth-service.js?v=20260717-auth-routing";


async function bootstrap() {
  try {
    initializeAuthCulturalPanel();
    await initializeAccountAccess();
    document.body.dataset.pageState = "ready";
  } catch {
    document.body.dataset.pageState = "error";
    const message = document.getElementById("accountAccessMessage");
    if (message) {
      message.hidden = false;
      message.dataset.tone = "error";
      message.textContent = "Account access could not be started. Please reload the page.";
    }
  }
}


window.addEventListener(
  "beforeunload",
  () => {
    destroyAuthCulturalPanel();
    destroyAccountAccess();
    destroyAuthService();
  },
  { once: true },
);


void bootstrap();
