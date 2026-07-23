const activeCounters = new WeakMap();


function reducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}


export function animateLeaderboardCounter(element, value) {
  if (!element) return;
  const target = Number.isFinite(Number(value))
    ? Math.max(0, Math.round(Number(value)))
    : 0;
  activeCounters.get(element)?.();

  if (reducedMotion() || typeof globalThis.requestAnimationFrame !== "function") {
    element.textContent = String(target);
    return;
  }

  let cancelled = false;
  let frame = 0;
  let startedAt;
  const duration = Math.min(1100, Math.max(520, target * 85));
  element.textContent = "0";

  const tick = (timestamp) => {
    if (cancelled) return;
    if (startedAt === undefined) startedAt = timestamp;
    const progress = Math.min(1, (timestamp - startedAt) / duration);
    const eased = 1 - ((1 - progress) ** 3);
    element.textContent = String(Math.round(target * eased));
    if (progress < 1) {
      frame = globalThis.requestAnimationFrame(tick);
    } else {
      activeCounters.delete(element);
    }
  };

  frame = globalThis.requestAnimationFrame(tick);
  activeCounters.set(element, () => {
    cancelled = true;
    globalThis.cancelAnimationFrame?.(frame);
  });
}


export function initLeaderboardTemplateMotion(root = document) {
  const section = root.getElementById?.("leaderboard");
  const list = root.getElementById?.("leaderboardList");
  const toast = root.getElementById?.("leaderboardToast");
  const toastText = root.getElementById?.("leaderboardToastText");
  if (!section || !list || !toast || !toastText) return { destroy() {} };

  let toastTimer = 0;
  let announcedCurrentRow = false;

  const showToast = (message) => {
    toastText.textContent = message;
    toast.classList.add("is-visible");
    globalThis.clearTimeout(toastTimer);
    toastTimer = globalThis.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2200);
  };

  const handlePointerMove = (event) => {
    if (reducedMotion()) return;
    const row = event.target.closest?.(".leaderboard-entry");
    if (!row || !section.contains(row)) return;
    const bounds = row.getBoundingClientRect();
    if (!bounds.width) return;
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    row.style.setProperty(
      "--leaderboard-row-glow-x",
      `${Math.max(0, Math.min(100, x))}%`,
    );
  };

  const handlePointerOver = (event) => {
    const currentRow = event.target.closest?.(".leaderboard-entry-current");
    if (!currentRow || !section.contains(currentRow)) return;
    showToast("This is your highlighted leaderboard row.");
  };

  const announceCurrentRow = () => {
    if (announcedCurrentRow) return;
    if (!list.querySelector?.(".leaderboard-entry-current")) return;
    announcedCurrentRow = true;
    showToast("Your leaderboard position is highlighted.");
  };

  section.addEventListener("pointermove", handlePointerMove);
  section.addEventListener("pointerover", handlePointerOver);
  const observer = typeof MutationObserver === "function"
    ? new MutationObserver(announceCurrentRow)
    : null;
  observer?.observe(list, { childList: true });
  announceCurrentRow();

  return {
    destroy() {
      observer?.disconnect();
      section.removeEventListener("pointermove", handlePointerMove);
      section.removeEventListener("pointerover", handlePointerOver);
      globalThis.clearTimeout(toastTimer);
      toast.classList.remove("is-visible");
    },
  };
}
