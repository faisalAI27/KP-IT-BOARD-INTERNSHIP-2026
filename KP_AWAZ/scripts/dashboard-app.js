import {
  destroyWorkspace,
  initializeWorkspace,
} from "./modules/workspace-shell.js?v=20260717-auth-routing";
import {
  formatContributionDate,
  formatContributionReviewStatus,
  formatContributionType,
} from "./modules/my-contributions.js?v=20260717-member-workspace";
import { getMyContributions } from "./services/contributions-api.js?v=20260717-member-workspace";
import { getPublicLeaderboard } from "./services/leaderboard-api.js?v=20260717-member-workspace";
import { getMyContributionStatistics } from "./services/profile-api.js?v=20260717-member-workspace";
import { getCurrentAuthState } from "./services/auth-service.js?v=20260717-auth-routing";


function text(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value);
}


function renderStatistics(statistics) {
  text("dashboardTotalCount", statistics.totalContributions);
  text("dashboardPendingCount", statistics.pendingContributions);
  text("dashboardApprovedCount", statistics.approvedContributions);
  text("dashboardRejectedCount", statistics.rejectedContributions);
  text(
    "dashboardVisibility",
    statistics.leaderboardOptIn ? "Name is visible" : "Private by default",
  );
  text(
    "dashboardRank",
    statistics.publicRank ? `#${statistics.publicRank}` : "Not currently ranked",
  );
  text("dashboardPointBalance", statistics.approvedContributions);
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
    list.hidden = true;
    return;
  }

  const items = response.items.map((item) => {
    const row = document.createElement("li");
    const mark = document.createElement("span");
    mark.className = "recent-voice-mark";
    mark.dataset.status = item.reviewStatus;
    mark.textContent = item.reviewStatus === "approved" ? "✓" : item.reviewStatus === "rejected" ? "!" : "···";
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = formatContributionType(item.contributionType);
    const detail = document.createElement("small");
    detail.textContent = `${formatContributionDate(item.createdAt)} · ${item.language} · ${formatDuration(item.durationSeconds)}`;
    copy.append(heading, detail);
    const badge = document.createElement("b");
    badge.dataset.status = item.reviewStatus;
    badge.textContent = formatContributionReviewStatus(item.reviewStatus);
    row.append(mark, copy, badge);
    return row;
  });
  list.replaceChildren(...items);
  list.hidden = false;
  status.textContent = "";
  status.hidden = true;
}


function renderLeaderboard(response) {
  const list = document.getElementById("dashboardLeaderboardList");
  const status = document.getElementById("dashboardLeaderboardStatus");
  if (!list || !status) return;
  if (!response.items.length) {
    status.textContent = "No approved public contributors are ranked yet.";
    list.hidden = true;
    return;
  }
  list.replaceChildren(...response.items.slice(0, 3).map((item) => {
    const row = document.createElement("li");
    const rank = document.createElement("span");
    rank.textContent = `#${item.rank}`;
    const name = document.createElement("strong");
    name.textContent = item.displayName;
    const score = document.createElement("b");
    score.textContent = `${item.approvedContributions} approved`;
    row.append(rank, name, score);
    return row;
  }));
  list.hidden = false;
  status.hidden = true;
}


function safePanelFailure(message) {
  const status = document.getElementById("dashboardRecentStatus");
  if (status) status.textContent = message;
}


async function loadOverview({ profile, state }) {
  const expectedUserId = state.backendUser.id;
  text("dashboardLanguage", profile?.preferredLanguage ?? "Pashto");
  text(
    "dashboardVisibility",
    profile?.leaderboardOptIn ? "Name is visible" : "Private by default",
  );

  const [statisticsResult, recentResult, leaderboardResult] = await Promise.allSettled([
    getMyContributionStatistics(),
    getMyContributions({ limit: 3, offset: 0 }),
    getPublicLeaderboard({ limit: 3, offset: 0 }),
  ]);
  if (getCurrentAuthState().backendUser?.id !== expectedUserId) return;

  if (statisticsResult.status === "fulfilled") {
    renderStatistics(statisticsResult.value);
  } else {
    for (const id of [
      "dashboardTotalCount",
      "dashboardPendingCount",
      "dashboardApprovedCount",
      "dashboardRejectedCount",
    ]) text(id, "Unavailable");
    text("dashboardRank", "Unavailable");
  }

  if (recentResult.status === "fulfilled") renderRecent(recentResult.value);
  else safePanelFailure("We could not load recent recordings. Open My Contributions to retry.");

  if (leaderboardResult.status === "fulfilled") renderLeaderboard(leaderboardResult.value);
  else text("dashboardLeaderboardStatus", "The leaderboard preview could not be loaded. Open the full leaderboard to retry.");
}


window.addEventListener("beforeunload", destroyWorkspace, { once: true });


void initializeWorkspace({ page: "overview", onReady: loadOverview }).catch(() => {
  document.body.dataset.workspaceState = "error";
});
