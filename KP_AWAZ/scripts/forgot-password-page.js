import {
  destroyAuthCulturalPanel,
  initializeAuthCulturalPanel,
} from "./modules/auth-cultural-panel.js?v=20260717-cultural-hero";
import { loadPartials } from "./modules/partials.js?v=20260717-member-workspace";
import { PasswordRecovery } from "./modules/password-recovery.js?v=20260720-recovery-otp";
import { destroyAuthService } from "./services/auth-service.js?v=20260723-auth-config-v2";


const recovery = new PasswordRecovery();


async function bootstrap() {
  try {
    await loadPartials();
    initializeAuthCulturalPanel();
    if (!recovery.initialize()) throw new Error("Recovery interface unavailable.");
    document.body.dataset.pageState = "ready";
  } catch {
    document.body.dataset.pageState = "error";
  }
}


window.addEventListener(
  "beforeunload",
  () => {
    recovery.destroy();
    destroyAuthCulturalPanel();
    destroyAuthService();
  },
  { once: true },
);


void bootstrap();
