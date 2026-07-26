function noopMotion() {
  return { destroy() {} };
}


export function initContributionsMotion({
  root = globalThis.document,
  windowObject = globalThis.window,
} = {}) {
  const page = root?.getElementById?.("myContributionsPageSection");
  const list = root?.getElementById?.("myContributionsList");
  const refreshButton = root?.getElementById?.("refreshContributionsButton");
  const updated = root?.getElementById?.("myContributionsUpdated");
  const toast = root?.getElementById?.("myContributionsToast");
  const filters = [
    ...(root?.querySelectorAll?.(".my-contributions-filter") ?? []),
  ];
  const statValues = [
    ...(root?.querySelectorAll?.(".contributions-stat dd") ?? []),
  ];

  if (!page || !list || !refreshButton || !updated || !toast) {
    return noopMotion();
  }

  const reducedMotion =
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  const finePointer =
    globalThis.matchMedia?.("(pointer: fine)")?.matches === true;
  const bindings = [];
  const pendingTimeouts = new Set();
  const burstPieces = new Set();
  const observers = [];
  let refreshRequested = false;
  let toastTimeout = null;
  let destroyed = false;

  function listen(element, type, listener) {
    element.addEventListener(type, listener);
    bindings.push({ element, type, listener });
  }

  function schedule(callback, delay) {
    const handle = windowObject.setTimeout(() => {
      pendingTimeouts.delete(handle);
      if (!destroyed) callback();
    }, delay);
    pendingTimeouts.add(handle);
    return handle;
  }

  function showToast() {
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");
    if (toastTimeout !== null) windowObject.clearTimeout(toastTimeout);
    toastTimeout = schedule(() => {
      toast.classList.remove("show");
      toastTimeout = null;
    }, 2300);
  }

  function burstRefresh() {
    if (reducedMotion) return;
    const rect = refreshButton.getBoundingClientRect();
    for (let index = 0; index < 10; index += 1) {
      const piece = root.createElement("i");
      piece.className = "contributions-refresh-burst";
      piece.setAttribute("aria-hidden", "true");
      const angle = (Math.PI * 2 * index) / 10;
      const distance = 28 + Math.random() * 20;
      piece.style.left = `${rect.left + rect.width / 2}px`;
      piece.style.top = `${rect.top + rect.height / 2}px`;
      piece.style.setProperty(
        "--burst-x",
        `${Math.cos(angle) * distance}px`,
      );
      piece.style.setProperty(
        "--burst-y",
        `${Math.sin(angle) * distance}px`,
      );
      root.body.append(piece);
      burstPieces.add(piece);
      schedule(() => {
        burstPieces.delete(piece);
        piece.remove();
      }, 760);
    }
  }

  listen(refreshButton, "click", () => {
    refreshRequested = true;
    burstRefresh();
  });

  for (const filter of filters) {
    listen(filter, "click", () => {
      filter.classList.remove("clicked");
      void filter.offsetWidth;
      filter.classList.add("clicked");
      schedule(() => filter.classList.remove("clicked"), 520);
    });
  }

  if (finePointer && !reducedMotion) {
    listen(list, "pointermove", (event) => {
      const card = event.target?.closest?.(".my-contribution-card");
      if (!card || !list.contains(card)) return;
      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const rotateX = ((y / rect.height) - 0.5) * -2.3;
      const rotateY = ((x / rect.width) - 0.5) * 2.3;
      card.style.setProperty("--mx", `${x}px`);
      card.style.setProperty("--my", `${y}px`);
      card.style.transform =
        `translateY(-7px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });
    listen(list, "pointerout", (event) => {
      const card = event.target?.closest?.(".my-contribution-card");
      if (!card || card.contains(event.relatedTarget)) return;
      card.style.removeProperty("transform");
    });
  }

  if (typeof globalThis.MutationObserver === "function") {
    const updatedObserver = new globalThis.MutationObserver(() => {
      if (!refreshRequested || updated.textContent.trim() !== "Updated just now") {
        return;
      }
      refreshRequested = false;
      showToast();
    });
    updatedObserver.observe(updated, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    observers.push(updatedObserver);

    for (const value of statValues) {
      const observer = new globalThis.MutationObserver(() => {
        if (value.textContent.trim() === "—") return;
        const stat = value.closest(".contributions-stat");
        stat?.classList.remove("count-pop");
        void stat?.offsetWidth;
        stat?.classList.add("count-pop");
        schedule(() => stat?.classList.remove("count-pop"), 450);
      });
      observer.observe(value, {
        characterData: true,
        childList: true,
        subtree: true,
      });
      observers.push(observer);
    }
  }

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const { element, type, listener } of bindings) {
        element.removeEventListener(type, listener);
      }
      for (const observer of observers) observer.disconnect();
      for (const handle of pendingTimeouts) windowObject.clearTimeout(handle);
      for (const piece of burstPieces) piece.remove();
      pendingTimeouts.clear();
      burstPieces.clear();
      toast.classList.remove("show");
    },
  };
}
