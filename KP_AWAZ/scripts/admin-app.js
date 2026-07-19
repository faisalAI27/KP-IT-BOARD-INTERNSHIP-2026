import {
  destroyAdminReview,
  initializeAdminReview,
} from "./modules/admin-review.js?v=20260719-withdrawals";
import {
  destroyAdminWithdrawals,
  initializeAdminWithdrawals,
} from "./modules/admin-withdrawals.js?v=20260719-withdrawals";


initializeAdminReview();
initializeAdminWithdrawals();
globalThis.addEventListener?.("beforeunload", () => {
  destroyAdminWithdrawals();
  destroyAdminReview();
}, { once: true });
