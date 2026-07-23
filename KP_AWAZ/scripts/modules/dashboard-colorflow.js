const ACTION_SELECTOR = ".dashboard-action-card";
const RECENT_SELECTOR = ".dashboard-mini-record";


function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}


function supportsFinePointer() {
  return globalThis.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
}


function resetTilt(card) {
  card.style.removeProperty("--dashboard-tilt-x");
  card.style.removeProperty("--dashboard-tilt-y");
}


export function animateDashboardCounter(element, target) {
  if (!element) return () => {};

  const safeTarget = Number.isFinite(Number(target))
    ? Math.max(0, Math.round(Number(target)))
    : 0;
  let frame = 0;
  let cancelled = false;

  if (prefersReducedMotion() || typeof globalThis.requestAnimationFrame !== "function") {
    element.textContent = String(safeTarget);
    return () => {};
  }

  const duration = Math.min(1100, Math.max(520, safeTarget * 70));
  let startedAt;
  element.textContent = "0";

  const tick = (timestamp) => {
    if (cancelled) return;
    if (startedAt === undefined) startedAt = timestamp;
    const progress = Math.min(1, (timestamp - startedAt) / duration);
    const eased = 1 - ((1 - progress) ** 3);
    element.textContent = String(Math.round(safeTarget * eased));
    if (progress < 1) frame = globalThis.requestAnimationFrame(tick);
  };

  frame = globalThis.requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(frame);
    }
  };
}


export function initDashboardColorflow(root = document) {
  const cleanups = [];
  if (prefersReducedMotion() || !supportsFinePointer()) {
    return { destroy() {} };
  }

  for (const card of root.querySelectorAll(ACTION_SELECTOR)) {
    const handlePointerMove = (event) => {
      const bounds = card.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = ((event.clientX - bounds.left) / bounds.width) - 0.5;
      const y = ((event.clientY - bounds.top) / bounds.height) - 0.5;
      card.style.setProperty("--dashboard-tilt-x", `${y * -2.2}deg`);
      card.style.setProperty("--dashboard-tilt-y", `${x * 2.2}deg`);
    };
    const handlePointerLeave = () => resetTilt(card);
    card.addEventListener("pointermove", handlePointerMove);
    card.addEventListener("pointerleave", handlePointerLeave);
    cleanups.push(() => {
      card.removeEventListener("pointermove", handlePointerMove);
      card.removeEventListener("pointerleave", handlePointerLeave);
      resetTilt(card);
    });
  }

  const handleRecentPointerMove = (event) => {
    const card = event.target.closest(RECENT_SELECTOR);
    if (!card || !root.contains(card)) return;
    const bounds = card.getBoundingClientRect();
    if (!bounds.width) return;
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    card.style.setProperty("--dashboard-glow-x", `${Math.max(0, Math.min(100, x))}%`);
  };
  root.addEventListener("pointermove", handleRecentPointerMove);
  cleanups.push(() => root.removeEventListener("pointermove", handleRecentPointerMove));

  return {
    destroy() {
      cleanups.splice(0).forEach((cleanup) => cleanup());
    },
  };
}
