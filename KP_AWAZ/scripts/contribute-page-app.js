import { destroyContributions, initContributions } from "./modules/contributions.js?v=20260723-guided-only";
import { destroyDonateText, initDonateText } from "./modules/donate-text.js?v=20260723-donate-text";
import { destroyWorkspace, initializeWorkspace } from "./modules/workspace-shell.js?v=20260717-auth-routing";


window.addEventListener("beforeunload", () => {
  destroyContributions();
  destroyDonateText();
  destroyWorkspace();
}, { once: true });


void initializeWorkspace({
  page: "contribute",
  onReady: async ({ profile }) => {
    initDonateText({ profile });
    await initContributions({ profile });
  },
}).catch(() => { document.body.dataset.workspaceState = "error"; });
