const activeCounters = new WeakMap();


function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}


export function animateDashboardCounter(element, target) {
  if (!element) return () => {};
  const safeTarget = Number.isFinite(Number(target))
    ? Math.max(0, Math.round(Number(target)))
    : 0;

  activeCounters.get(element)?.();
  if (prefersReducedMotion() || typeof globalThis.requestAnimationFrame !== "function") {
    element.textContent = String(safeTarget);
    return () => {};
  }

  let cancelled = false;
  let frame = 0;
  let startedAt;
  const duration = Math.min(900, Math.max(480, safeTarget * 65));
  element.textContent = "0";

  const tick = (timestamp) => {
    if (cancelled) return;
    if (startedAt === undefined) startedAt = timestamp;
    const progress = Math.min(1, (timestamp - startedAt) / duration);
    const eased = 1 - ((1 - progress) ** 3);
    element.textContent = String(Math.round(safeTarget * eased));
    if (progress < 1) {
      frame = globalThis.requestAnimationFrame(tick);
      return;
    }
    activeCounters.delete(element);
  };

  frame = globalThis.requestAnimationFrame(tick);
  const cancel = () => {
    cancelled = true;
    globalThis.cancelAnimationFrame?.(frame);
  };
  activeCounters.set(element, cancel);
  return cancel;
}


export function initDashboardColorflow() {
  return { destroy() {} };
}
