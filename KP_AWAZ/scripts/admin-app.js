import {
  destroyAdminReview,
  initializeAdminReview,
} from "./modules/admin-review.js";


initializeAdminReview();
globalThis.addEventListener?.("beforeunload", destroyAdminReview, { once: true });
