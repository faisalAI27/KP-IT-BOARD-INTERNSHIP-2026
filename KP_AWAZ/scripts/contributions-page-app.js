import {
  destroyMyContributions,
  initializeMyContributions,
} from "./modules/my-contributions.js?v=20260719-withdrawals";
import {
  destroyWorkspace,
  initializeWorkspace,
} from "./modules/workspace-shell.js?v=20260717-auth-routing";


function openContributionHistory() {
  const section = document.getElementById("myContributionsPageSection");
  if (!section) throw new Error("Contribution history could not be loaded.");
  section.hidden = false;
  initializeMyContributions();
}


window.addEventListener(
  "beforeunload",
  () => {
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
