import {
  destroyAdminReview,
  initializeAdminReview,
} from "./modules/admin-review.js";
import {
  destroyAdminPhrases,
  initializeAdminPhrases,
} from "./modules/admin-phrases.js";
import {
  destroyAdminWithdrawals,
  initializeAdminWithdrawals,
} from "./modules/admin-withdrawals.js";


initializeAdminReview();
initializeAdminWithdrawals();
initializeAdminPhrases();
globalThis.addEventListener?.("beforeunload", () => {
  destroyAdminPhrases();
  destroyAdminWithdrawals();
  destroyAdminReview();
}, { once: true });
