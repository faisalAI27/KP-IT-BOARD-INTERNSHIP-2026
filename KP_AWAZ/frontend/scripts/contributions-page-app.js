import {
  destroyMyContributions,
  initializeMyContributions,
} from "./modules/my-contributions.js?v=20260723-contributions-motion";
import { initContributionsMotion } from "./modules/contributions-motion.js?v=20260723-contributions-motion";
import {
  destroyWorkspace,
  initializeWorkspace,
} from "./modules/workspace-shell.js?v=20260723-auth-config-v2";


let contributionsMotion = null;


function openContributionHistory() {
  const section = document.getElementById("myContributionsPageSection");
  if (!section) throw new Error("Contribution history could not be loaded.");
  section.hidden = false;
  contributionsMotion = initContributionsMotion();
  initializeMyContributions();
}


window.addEventListener(
  "beforeunload",
  () => {
    contributionsMotion?.destroy();
    contributionsMotion = null;
    destroyMyContributions();
    destroyWorkspace();
  },
  { once: true },
);


void initializeWorkspace({
  page: "contributions",
  onReady: openContributionHistory,
}).catch(() => {
  document.body.dataset.workspaceState = "error";
});
