const SIGNAL_BAR_COUNT = 44;
const CONFETTI_COLORS = Object.freeze([
  "#dda84f",
  "#b75a34",
  "#216555",
  "#efc16f",
  "#ca6b42",
]);

function noopPresenter() {
  return {
    celebrateSubmission() {},
    destroy() {},
    setSignalLevel() {},
  };
}

export function initMicEnhancedTemplate({
  root = globalThis.document,
  windowObject = globalThis.window,
} = {}) {
  const card = root?.getElementById?.("contribution-panel");
  const recordButton = root?.getElementById?.("donateRecBtn");
  const recordStage = root?.getElementById?.("donateRecordStage");
  const recordCue = root?.getElementById?.("donateRecordCue");
  const signalState = root?.getElementById?.("donateSignalState");
  const stateLabel = root?.getElementById?.("donateRecordStateLabel");
  const signalVisualizer = root?.getElementById?.("donateSignalVisualizer");
  const toast = root?.getElementById?.("micTemplateToast");
  const xpFloat = root?.getElementById?.("donateXpFloat");
  const sentenceButton = root?.getElementById?.("nextSentenceBtn");
  const successElement = root?.getElementById?.("success-donate");
  const journeySteps = [
    ...(root?.querySelectorAll?.("#recordingJourney [data-recording-step]") ?? []),
  ];

  if (
    !card ||
    !recordButton ||
    !recordStage ||
    !recordCue ||
    !signalState ||
    !stateLabel ||
    !signalVisualizer
  ) {
    return noopPresenter();
  }

  const reducedMotion =
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  const finePointer =
    globalThis.matchMedia?.("(pointer: fine)")?.matches === true;
  const pendingTimeouts = new Set();
  const confettiPieces = new Set();
  let recordStateObserver;
  let successObserver;
  let readyPreviously = false;
  let destroyed = false;
  let toastTimeout = null;

  function schedule(callback, delay) {
    const handle = windowObject.setTimeout(() => {
      pendingTimeouts.delete(handle);
      if (!destroyed) callback();
    }, delay);
    pendingTimeouts.add(handle);
    return handle;
  }

  function buildSignalVisualizer() {
    if (signalVisualizer.childElementCount > 0) return;
    const fragment = root.createDocumentFragment();
    for (let index = 0; index < SIGNAL_BAR_COUNT; index += 1) {
      const bar = root.createElement("span");
      const centerBoost = 1 - Math.abs((index - 21.5) / 21.5);
      const idle = (0.12 + Math.random() * 0.24 + centerBoost * 0.08).toFixed(2);
      const peak = Math.min(
        1,
        0.42 + Math.random() * 0.5 + centerBoost * 0.14,
      ).toFixed(2);
      bar.style.setProperty("--idle", idle);
      bar.style.setProperty("--peak", peak);
      bar.style.setProperty("--delay", `${-((index % 11) * 0.075).toFixed(3)}s`);
      bar.style.setProperty("--speed", `${(0.72 + (index % 8) * 0.075).toFixed(2)}s`);
      fragment.append(bar);
    }
    signalVisualizer.append(fragment);
  }

  function setJourney(step) {
    journeySteps.forEach((item) => {
      const itemStep = Number(item.dataset.recordingStep);
      const bubble = item.querySelector(".journey-step-number");
      const active = itemStep === step;
      const done = itemStep < step;

      item.classList.toggle("active", active);
      item.classList.toggle("is-active", active);
      item.classList.toggle("done", done);
      item.classList.toggle("is-done", done);
      if (active) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
      if (bubble) bubble.textContent = done ? "✓" : String(itemStep);
    });
  }

  function setCue(message) {
    const dot = root.createElement("span");
    dot.className = "tap-dot";
    dot.setAttribute("aria-hidden", "true");
    recordCue.replaceChildren(dot, root.createTextNode(message));
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");
    if (toastTimeout !== null) windowObject.clearTimeout(toastTimeout);
    toastTimeout = schedule(() => {
      toast.classList.remove("show");
      toastTimeout = null;
    }, 2300);
  }

  function syncRecorderState() {
    const recording = recordButton.classList.contains("recording");
    const requesting = recordButton.classList.contains("requesting");
    const processing = recordButton.classList.contains("processing");
    const reviewing = recordButton.classList.contains("ready");
    const playing = recordButton.classList.contains("playing");
    const error = recordButton.classList.contains("error");

    card.classList.toggle("recording", recording);
    card.classList.toggle("reviewing", reviewing);
    card.classList.toggle("playing", playing);
    card.classList.toggle("is-requesting", requesting);
    card.classList.toggle("is-processing", processing);
    card.classList.toggle("is-error", error);

    if (playing) {
      setJourney(3);
      stateLabel.textContent = "Playing back";
      signalState.textContent = "Playing back";
      setCue("Playing preview");
    } else if (reviewing) {
      setJourney(3);
      stateLabel.textContent = "Voice captured";
      signalState.textContent = "Captured";
      setCue("Tap to preview");
    } else if (recording) {
      setJourney(2);
      stateLabel.textContent = "Recording now";
      signalState.textContent = "Listening";
      setCue("Tap to stop");
    } else if (requesting || processing) {
      setJourney(2);
      stateLabel.textContent = requesting
        ? "Microphone permission"
        : "Preparing recording";
      signalState.textContent = requesting ? "Connecting" : "Processing";
      setCue("Please wait");
    } else if (error) {
      setJourney(1);
      stateLabel.textContent = "Needs attention";
      signalState.textContent = "Unavailable";
      setCue("Try again");
    } else {
      setJourney(1);
      stateLabel.textContent = "Ready when you are";
      signalState.textContent = "Waiting";
      setCue("Tap to start");
    }

    if (reviewing && !readyPreviously) {
      showToast("Recording captured — listen, retry, or submit");
    }
    readyPreviously = reviewing;
  }

  function handleStagePointerMove(event) {
    const bounds = recordStage.getBoundingClientRect();
    recordStage.style.setProperty(
      "--spot-x",
      `${(((event.clientX - bounds.left) / bounds.width) * 100).toFixed(1)}%`,
    );
    recordStage.style.setProperty(
      "--spot-y",
      `${(((event.clientY - bounds.top) / bounds.height) * 100).toFixed(1)}%`,
    );
  }

  function handleStagePointerLeave() {
    recordStage.style.setProperty("--spot-x", "48%");
    recordStage.style.setProperty("--spot-y", "50%");
  }

  function handleCardPointerMove(event) {
    const bounds = card.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    card.style.transform =
      `perspective(900px) rotateX(${(y * -2.2).toFixed(3)}deg) ` +
      `rotateY(${(x * 2.8).toFixed(3)}deg) translateY(-2px)`;
  }

  function handleCardPointerLeave() {
    card.style.removeProperty("transform");
  }

  function handleSentenceChange() {
    showToast("A new sentence is ready");
  }

  function removeConfetti(piece) {
    piece.remove();
    confettiPieces.delete(piece);
  }

  function confettiBurst() {
    if (reducedMotion) return;
    const submitButton = root.getElementById("submitDonation");
    const bounds = submitButton?.getBoundingClientRect?.();
    if (!bounds) return;

    for (let index = 0; index < 26; index += 1) {
      const piece = root.createElement("i");
      piece.className = "mic-template-confetti";
      piece.style.left = `${bounds.left + bounds.width / 2}px`;
      piece.style.top = `${bounds.top + bounds.height / 2}px`;
      piece.style.background = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
      piece.style.setProperty("--x", `${(Math.random() - 0.5) * 320}px`);
      piece.style.setProperty("--y", `${80 + Math.random() * 220}px`);
      piece.style.setProperty("--r", `${(Math.random() - 0.5) * 720}deg`);
      piece.style.animationDelay = `${Math.random() * 0.12}s`;
      root.body.append(piece);
      confettiPieces.add(piece);
      schedule(() => removeConfetti(piece), 1500);
    }
  }

  function celebrateSubmission() {
    if (xpFloat) {
      xpFloat.classList.remove("show");
      void xpFloat.offsetWidth;
      xpFloat.classList.add("show");
    }
    confettiBurst();
    showToast("Submitted successfully · +20 XP earned");
  }

  function syncSubmissionSuccess() {
    if (successElement && !successElement.hidden) celebrateSubmission();
  }

  function setSignalLevel(level) {
    const normalized = Math.max(0, Math.min(1, Number(level) || 0));
    card.style.setProperty(
      "--signal-brightness",
      (0.9 + normalized * 0.38).toFixed(3),
    );
  }

  buildSignalVisualizer();
  setJourney(1);
  syncRecorderState();

  if (typeof globalThis.MutationObserver === "function") {
    recordStateObserver = new globalThis.MutationObserver(syncRecorderState);
    recordStateObserver.observe(recordButton, {
      attributes: true,
      attributeFilter: ["class"],
    });
    if (successElement) {
      successObserver = new globalThis.MutationObserver(syncSubmissionSuccess);
      successObserver.observe(successElement, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
    }
  }

  sentenceButton?.addEventListener("click", handleSentenceChange);
  if (finePointer && !reducedMotion) {
    recordStage.addEventListener("pointermove", handleStagePointerMove);
    recordStage.addEventListener("pointerleave", handleStagePointerLeave);
    card.addEventListener("pointermove", handleCardPointerMove);
    card.addEventListener("pointerleave", handleCardPointerLeave);
  }

  return {
    celebrateSubmission,
    setSignalLevel,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      recordStateObserver?.disconnect();
      successObserver?.disconnect();
      sentenceButton?.removeEventListener("click", handleSentenceChange);
      recordStage.removeEventListener("pointermove", handleStagePointerMove);
      recordStage.removeEventListener("pointerleave", handleStagePointerLeave);
      card.removeEventListener("pointermove", handleCardPointerMove);
      card.removeEventListener("pointerleave", handleCardPointerLeave);
      pendingTimeouts.forEach((handle) => windowObject.clearTimeout(handle));
      pendingTimeouts.clear();
      confettiPieces.forEach((piece) => piece.remove());
      confettiPieces.clear();
      if (toastTimeout !== null) windowObject.clearTimeout(toastTimeout);
      toast?.classList.remove("show");
      card.style.removeProperty("transform");
      card.style.removeProperty("--signal-brightness");
    },
  };
}
