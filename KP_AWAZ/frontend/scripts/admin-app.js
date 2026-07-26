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
import {
  destroyAdminTextReview,
  initializeAdminTextReview,
} from "./modules/admin-text-review.js?v=20260726-text-review";


initializeAdminReview();
initializeAdminTextReview();
initializeAdminWithdrawals();
initializeAdminPhrases();
globalThis.addEventListener?.("beforeunload", () => {
  destroyAdminPhrases();
  destroyAdminWithdrawals();
  destroyAdminTextReview();
  destroyAdminReview();
}, { once: true });
