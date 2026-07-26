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
  const duration = Math.min(900, Math.max(480, target * 70));
  element.textContent = "0";

  const tick = (timestamp) => {
    if (cancelled) return;
    if (startedAt === undefined) startedAt = timestamp;
    const progress = Math.min(1, (timestamp - startedAt) / duration);
    const eased = 1 - ((1 - progress) ** 3);
    element.textContent = String(Math.round(target * eased));
    if (progress < 1) {
      frame = globalThis.requestAnimationFrame(tick);
      return;
    }
    activeCounters.delete(element);
  };

  frame = globalThis.requestAnimationFrame(tick);
  activeCounters.set(element, () => {
    cancelled = true;
    globalThis.cancelAnimationFrame?.(frame);
  });
}


export function initLeaderboardTemplateMotion() {
  return { destroy() {} };
}
