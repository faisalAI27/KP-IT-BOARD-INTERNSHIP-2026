import {
  destroyWorkspace,
  initializeWorkspace,
} from "./modules/workspace-shell.js?v=20260723-auth-config-v2";
import {
  animateDashboardCounter,
  initDashboardColorflow,
} from "./modules/dashboard-colorflow.js?v=20260723-refined-surfaces";
import {
  formatContributionDate,
  formatContributionReviewStatus,
  formatContributionType,
} from "./modules/my-contributions.js?v=20260717-member-workspace";
import { getMyContributions } from "./services/contributions-api.js?v=20260717-member-workspace";
import { getMyContributionStatistics } from "./services/profile-api.js?v=20260717-member-workspace";
import { getCurrentAuthState } from "./services/auth-service.js?v=20260723-auth-config-v2";


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


function createStatusIcon(status) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  if (status === "approved") {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", "m5 12 4 4L19 6");
    svg.append(path);
  } else if (status === "rejected") {
    const line = document.createElementNS(namespace, "path");
    line.setAttribute("d", "M12 7v6");
    const dot = document.createElementNS(namespace, "circle");
    dot.setAttribute("cx", "12");
    dot.setAttribute("cy", "17");
    dot.setAttribute("r", "1.35");
    dot.classList.add("dashboard-status-dot");
    svg.append(line, dot);
  } else {
    svg.classList.add("dashboard-dot-icon");
    for (const cx of ["6", "12", "18"]) {
      const dot = document.createElementNS(namespace, "circle");
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", "12");
      dot.setAttribute("r", "1.6");
      svg.append(dot);
    }
  }

  return svg;
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
    mark.setAttribute("aria-hidden", "true");
    mark.append(createStatusIcon(safeStatus));
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
