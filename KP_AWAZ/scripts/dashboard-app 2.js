import {
  destroyWorkspace,
  initializeWorkspace,
} from "./modules/workspace-shell.js?v=20260717-auth-routing";
import {
  animateDashboardCounter,
  initDashboardColorflow,
} from "./modules/dashboard-colorflow.js?v=20260723-dashboard-colorflow";
import {
  formatContributionDate,
  formatContributionReviewStatus,
  formatContributionType,
} from "./modules/my-contributions.js?v=20260717-member-workspace";
import { getMyContributions } from "./services/contributions-api.js?v=20260717-member-workspace";
import { getMyContributionStatistics } from "./services/profile-api.js?v=20260717-member-workspace";
import { getCurrentAuthState } from "./services/auth-service.js?v=20260717-auth-routing";


function text(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value);
}


function renderStatistics(statistics) {
  for (const [id, value] of [
    ["dashboardTotalCount", statistics.totalContributions],
    ["dashboardPendingCount", statistics.pendingContributions],
    ["dashboardApprovedCount", statistics.approvedContributions],
  ]) {
    const element = document.getElementById(id);
    if (!element) continue;
    animateDashboardCounter(element, value);
  }
  const approved = Math.max(0, Math.round(Number(statistics.approvedContributions) || 0));
  text("dashboardApprovedBadge", `${approved} approved ${approved === 1 ? "voice" : "voices"}`);
}


function formatDuration(value) {
  if (typeof value !== "number" || value < 0) return "Duration unavailable";
  const seconds = Math.round(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}


function renderRecent(response) {
  const list = document.getElementById("dashboardRecentList");
  const status = document.getElementById("dashboardRecentStatus");
  if (!list || !status) return;
  if (!response.items.length) {
    status.textContent = "Your voice trail is empty. Your first recording can begin today.";
    status.hidden = false;
    list.hidden = true;
    return;
  }

  const items = response.items.map((item) => {
    const row = document.createElement("li");
    const safeStatus = ["approved", "rejected"].includes(item.reviewStatus)
      ? item.reviewStatus
      : "pending";
    row.className = "dashboard-mini-record";
    row.dataset.status = safeStatus;
    const mark = document.createElement("span");
    mark.className = "dashboard-mini-icon";
    mark.textContent = safeStatus === "approved" ? "✓" : safeStatus === "rejected" ? "!" : "···";
    const copy = document.createElement("div");
    copy.className = "dashboard-mini-copy";
    const heading = document.createElement("strong");
    heading.textContent = formatContributionType(item.contributionType);
    const detail = document.createElement("small");
    detail.textContent = `${formatContributionDate(item.createdAt)} · ${item.language} · ${formatDuration(item.durationSeconds)}`;
    copy.append(heading, detail);
    const badge = document.createElement("b");
    badge.className = "dashboard-status-pill";
    badge.textContent = safeStatus === "pending"
      ? "Under review"
      : safeStatus === "rejected"
        ? "Please try again"
        : formatContributionReviewStatus(safeStatus);
    row.append(mark, copy, badge);
    return row;
  });
  list.replaceChildren(...items);
  list.hidden = false;
  status.textContent = "";
  status.hidden = true;
}


function safePanelFailure(message) {
  const status = document.getElementById("dashboardRecentStatus");
  if (status) {
    status.textContent = message;
    status.hidden = false;
  }
}


async function loadOverview({ state }) {
  const expectedUserId = state.backendUser.id;

  const [statisticsResult, recentResult] = await Promise.allSettled([
    getMyContributionStatistics(),
    getMyContributions({ limit: 3, offset: 0 }),
  ]);
  if (getCurrentAuthState().backendUser?.id !== expectedUserId) return;

  if (statisticsResult.status === "fulfilled") {
    renderStatistics(statisticsResult.value);
  } else {
    for (const id of [
      "dashboardTotalCount",
      "dashboardPendingCount",
      "dashboardApprovedCount",
    ]) text(id, "Unavailable");
  }

  if (recentResult.status === "fulfilled") renderRecent(recentResult.value);
  else safePanelFailure("We could not load recent recordings. Open My Contributions to retry.");

}


const dashboardColorflow = initDashboardColorflow();


window.addEventListener("beforeunload", () => {
  dashboardColorflow.destroy();
  destroyWorkspace();
}, { once: true });


void initializeWorkspace({ page: "overview", onReady: loadOverview }).catch(() => {
  document.body.dataset.workspaceState = "error";
});
