import { initFaq } from "./modules/faq.js";
import {
  destroyLeaderboard,
  initializeLeaderboard,
} from "./modules/leaderboard.js?v=20260717-member-workspace";
import { initLeaderboardTemplateMotion } from "./modules/leaderboard-template-motion.js?v=20260723-leaderboard-flow";
import { initNavigation } from "./modules/navigation.js";
import { loadPartials, restoreHashPosition } from "./modules/partials.js?v=20260717-member-workspace";
import { PublicRouting } from "./modules/public-routing.js?v=20260720-public-polish";


let routing = null;
let leaderboardMotion = null;


function showBootError() {
  const message = document.createElement("div");
  message.className = "app-error";
  message.setAttribute("role", "alert");
  message.innerHTML = "<strong>The page could not be assembled.</strong><span>Run KP AWAZ through its local web server and reload.</span>";
  document.body.append(message);
}


async function bootstrap() {
  try {
    await loadPartials();
    initNavigation();
    initFaq();
    leaderboardMotion = initLeaderboardTemplateMotion();
    initializeLeaderboard();
    restoreHashPosition();
    document.body.dataset.appState = "ready";
    routing = new PublicRouting();
    await routing.initialize();
  } catch {
    document.body.dataset.appState = "error";
    showBootError();
  }
}


window.addEventListener("beforeunload", () => {
  destroyLeaderboard();
  leaderboardMotion?.destroy();
  routing?.destroy();
}, { once: true });


void bootstrap();
