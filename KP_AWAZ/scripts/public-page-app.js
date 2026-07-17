import { initNavigation } from "./modules/navigation.js";
import { initFaq } from "./modules/faq.js";
import {
  destroyLeaderboard,
  initializeLeaderboard,
} from "./modules/leaderboard.js?v=20260717-member-workspace";
import { loadPartials } from "./modules/partials.js?v=20260717-member-workspace";
import { PublicRouting } from "./modules/public-routing.js?v=20260717-auth-routing";


let routing = null;
let leaderboardStarted = false;


async function bootstrap() {
  try {
    await loadPartials();
    initNavigation();
    if (document.getElementById("faq")) initFaq();
    if (document.getElementById("leaderboard")) {
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
  routing?.destroy();
}, { once: true });


void bootstrap();
