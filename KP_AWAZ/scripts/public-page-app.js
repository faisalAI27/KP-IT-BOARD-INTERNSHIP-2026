import { initNavigation } from "./modules/navigation.js";
import { initFaq } from "./modules/faq.js";
import {
  destroyLeaderboard,
  initializeLeaderboard,
} from "./modules/leaderboard.js?v=20260717-member-workspace";
import { initLeaderboardTemplateMotion } from "./modules/leaderboard-template-motion.js?v=20260723-leaderboard-flow";
import { loadPartials } from "./modules/partials.js?v=20260717-member-workspace";
import { PublicRouting } from "./modules/public-routing.js?v=20260720-public-polish";


let routing = null;
let leaderboardStarted = false;
let leaderboardMotion = null;


async function bootstrap() {
  try {
    await loadPartials();
    initNavigation();
    if (document.getElementById("faq")) initFaq();
    if (document.getElementById("leaderboard")) {
      leaderboardMotion = initLeaderboardTemplateMotion();
      initializeLeaderboard();
      leaderboardStarted = true;
    }
    document.body.dataset.appState = "ready";
    routing = new PublicRouting();
    await routing.initialize();
  } catch {
    document.body.dataset.appState = "error";
  }
}


window.addEventListener("beforeunload", () => {
  if (leaderboardStarted) destroyLeaderboard();
  leaderboardMotion?.destroy();
  routing?.destroy();
}, { once: true });


void bootstrap();
