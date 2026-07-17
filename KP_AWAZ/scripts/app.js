import { initFaq } from "./modules/faq.js";
import {
  destroyLeaderboard,
  initializeLeaderboard,
} from "./modules/leaderboard.js?v=20260717-member-workspace";
import { initNavigation } from "./modules/navigation.js";
import { loadPartials, restoreHashPosition } from "./modules/partials.js?v=20260717-member-workspace";
import { PublicRouting } from "./modules/public-routing.js?v=20260717-auth-routing";


let routing = null;


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
  routing?.destroy();
}, { once: true });


void bootstrap();
