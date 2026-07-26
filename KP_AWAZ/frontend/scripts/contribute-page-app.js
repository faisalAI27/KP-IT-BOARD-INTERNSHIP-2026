import { destroyContributions, initContributions } from "./modules/contributions.js?v=20260726-focused-recorder";
import { destroyWorkspace, initializeWorkspace } from "./modules/workspace-shell.js?v=20260723-auth-config-v2";


window.addEventListener("beforeunload", () => {
  destroyContributions();
  destroyWorkspace();
}, { once: true });


void initializeWorkspace({
  page: "contribute",
  onReady: async ({ profile }) => {
    await initContributions({ profile });
  },
}).catch(() => { document.body.dataset.workspaceState = "error"; });
