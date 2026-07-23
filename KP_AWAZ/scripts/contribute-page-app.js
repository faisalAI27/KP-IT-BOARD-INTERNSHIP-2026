import { destroyContributions, initContributions } from "./modules/contributions.js?v=20260723-voice-mission-template";
import { destroyWorkspace, initializeWorkspace } from "./modules/workspace-shell.js?v=20260717-auth-routing";


window.addEventListener("beforeunload", () => {
  destroyContributions();
  destroyWorkspace();
}, { once: true });


void initializeWorkspace({
  page: "contribute",
  onReady: async ({ profile }) => {
    await initContributions({ profile, search: window.location.search });
  },
}).catch(() => { document.body.dataset.workspaceState = "error"; });
