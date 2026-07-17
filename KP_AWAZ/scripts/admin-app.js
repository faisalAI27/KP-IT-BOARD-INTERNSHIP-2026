import {
  destroyAdminReview,
  initializeAdminReview,
} from "./modules/admin-review.js?v=20260717-member-workspace";


initializeAdminReview();
globalThis.addEventListener?.("beforeunload", destroyAdminReview, { once: true });
