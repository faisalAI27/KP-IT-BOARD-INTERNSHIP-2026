import {
  destroyAccountAccess,
  initializeAccountAccess,
  prefillAccountSignInEmail,
} from "./modules/account-access.js?v=20260723-auth-config-v2";
import {
  destroyAuthCulturalPanel,
  initializeAuthCulturalPanel,
} from "./modules/auth-cultural-panel.js?v=20260717-cultural-hero";
import { destroyAuthService } from "./services/auth-service.js?v=20260723-auth-config-v2";
import { consumeRecoveryEmailForSignIn } from "./services/recovery-handoff.js";


async function bootstrap() {
  try {
    initializeAuthCulturalPanel();
    await initializeAccountAccess();
    const recoveredEmail = consumeRecoveryEmailForSignIn();
    if (recoveredEmail) prefillAccountSignInEmail(recoveredEmail);
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
