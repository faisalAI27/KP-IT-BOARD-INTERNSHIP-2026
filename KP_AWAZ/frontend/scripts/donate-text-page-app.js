import { destroyDonateText, initDonateText } from "./modules/donate-text.js?v=20260723-standalone-page";
import { destroyWorkspace, initializeWorkspace } from "./modules/workspace-shell.js?v=20260723-auth-config-v2";


window.addEventListener("beforeunload", () => {
  destroyDonateText();
  destroyWorkspace();
}, { once: true });


void initializeWorkspace({
  page: "donate-text",
  onReady: ({ profile }) => {
    initDonateText({ profile });
  },
}).catch(() => { document.body.dataset.workspaceState = "error"; });
