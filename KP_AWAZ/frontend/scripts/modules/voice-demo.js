export const VOICE_DEMO_DURATION_MS = 4300;

export const VOICE_DEMO_WORD_TIMINGS = Object.freeze([
  Object.freeze({ start: 0, end: 720 }),
  Object.freeze({ start: 720, end: 1380 }),
  Object.freeze({ start: 1380, end: 2100 }),
  Object.freeze({ start: 2100, end: 3260 }),
  Object.freeze({ start: 3260, end: 3960 }),
]);

export const VOICE_DEMO_WAVEFORM = Object.freeze([
  0.34, 0.58, 0.42, 0.76, 0.5, 0.86, 0.62, 0.38,
  0.72, 0.94, 0.55, 0.8, 0.46, 0.68, 0.9, 0.6,
  0.4, 0.74, 0.52, 0.84, 0.64, 0.44, 0.7, 0.36,
]);

export const VOICE_DEMO_STATE_COPY = Object.freeze({
  idle: Object.freeze({
    accessibleName: "Play visual sentence sample",
    prompt: "Tap the wave to see the sentence flow",
    label: "Ready",
  }),
  playing: Object.freeze({
    accessibleName: "Pause visual sentence sample",
    prompt: "Tap the wave to pause the flow",
    label: "Voice in motion",
  }),
  paused: Object.freeze({
    accessibleName: "Resume visual sentence sample",
    prompt: "Tap the wave to continue",
    label: "Paused",
  }),
  complete: Object.freeze({
    accessibleName: "Replay visual sentence sample",
    prompt: "Tap the wave to replay",
    label: "Complete",
  }),
});

export function voiceWordState(elapsedMs, timing) {
  if (elapsedMs < timing.start) return "upcoming";
  if (elapsedMs >= timing.end) return "completed";
  return "current";
}

function formatElapsed(elapsedMs) {
  const seconds = Math.min(4, Math.floor(elapsedMs / 1000));
  return `00:0${seconds} / 00:04`;
}

export class VoiceDemo {
  constructor(root, options = {}) {
    this.root = root;
    this.scriptWords = [
      ...root.querySelectorAll("[data-voice-script-face] [data-voice-word]"),
    ];
    this.romanWords = [
      ...root.querySelectorAll("[data-voice-roman-face] [data-voice-word]"),
    ];
    this.wordTracks = [this.scriptWords, this.romanWords];
    this.words = this.scriptWords;
    this.wave = root.querySelector("[data-voice-wave]");
    this.progress = root.querySelector("[data-voice-progress]");
    this.control = root.querySelector("[data-voice-control]");
    this.languageToggle = root.querySelector("[data-voice-language-toggle]");
    this.scriptFace = root.querySelector("[data-voice-script-face]");
    this.romanFace = root.querySelector("[data-voice-roman-face]");
    this.languageHint = root.querySelector("[data-voice-language-hint]");
    this.prompt = root.querySelector("[data-voice-prompt]");
    this.stateLabel = root.querySelector("[data-voice-state-label]");
    this.time = root.querySelector("[data-voice-time]");
    this.elapsedMs = 0;
    this.startedAt = 0;
    this.frameId = null;
    this.state = "idle";

    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
    this.motionQuery = options.motionQuery
      ?? window.matchMedia("(prefers-reduced-motion: reduce)");
    this.observerFactory = options.observerFactory
      ?? (typeof IntersectionObserver === "function"
        ? (callback, observerOptions) => new IntersectionObserver(callback, observerOptions)
        : null);
    this.revealObserver = null;

    this.handleControl = this.handleControl.bind(this);
    this.handleLanguageToggle = this.handleLanguageToggle.bind(this);
    this.handleMotionChange = this.handleMotionChange.bind(this);
    this.handleReveal = this.handleReveal.bind(this);
    this.tick = this.tick.bind(this);
  }

  initialize() {
    const tracksAreAligned = this.wordTracks.every(
      (track) => track.length === VOICE_DEMO_WORD_TIMINGS.length,
    );
    if (!this.control || !this.progress || !tracksAreAligned) {
      return this;
    }

    this.buildWaveform();
    this.control.addEventListener("click", this.handleControl);
    this.languageToggle?.addEventListener("click", this.handleLanguageToggle);
    this.motionQuery.addEventListener?.("change", this.handleMotionChange);
    this.setLanguage("script");
    this.handleMotionChange();
    this.render();
    this.initializeReveal();
    return this;
  }

  buildWaveform() {
    if (!this.wave) return;
    const fragment = document.createDocumentFragment();
    VOICE_DEMO_WAVEFORM.forEach((height, index) => {
      const bar = document.createElement("span");
      bar.style.setProperty("--voice-bar", `${Math.round(12 + height * 32)}px`);
      bar.style.setProperty("--voice-delay", `${-index * 37}ms`);
      fragment.append(bar);
    });
    this.wave.replaceChildren(fragment);
  }

  handleMotionChange() {
    this.root.dataset.reducedMotion = String(this.motionQuery.matches);
    if (this.motionQuery.matches) this.revealImmediately();
  }

  initializeReveal() {
    if (this.motionQuery.matches || !this.observerFactory) {
      this.revealImmediately();
      return;
    }

    this.root.dataset.revealReady = "true";
    this.revealObserver = this.observerFactory(this.handleReveal, {
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.2,
    });
    this.revealObserver.observe(this.root);
  }

  handleReveal(entries) {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    this.revealImmediately();
  }

  revealImmediately() {
    this.root.classList.add("is-visible");
    this.revealObserver?.disconnect();
    this.revealObserver = null;
  }

  handleControl() {
    if (this.state === "playing") {
      this.pause();
      return;
    }
    this.play();
  }

  handleLanguageToggle() {
    const nextLanguage = this.root.dataset.voiceLanguage === "roman"
      ? "script"
      : "roman";
    this.setLanguage(nextLanguage);
  }

  setLanguage(language) {
    const showRoman = language === "roman";
    this.root.dataset.voiceLanguage = showRoman ? "roman" : "script";
    this.languageToggle?.setAttribute("aria-pressed", String(showRoman));
    this.languageToggle?.setAttribute(
      "aria-label",
      showRoman ? "Show Pashto script" : "Show Roman Pashto",
    );
    this.scriptFace?.setAttribute("aria-hidden", String(showRoman));
    this.romanFace?.setAttribute("aria-hidden", String(!showRoman));
    if (this.languageHint) {
      this.languageHint.textContent = showRoman
        ? "Tap to show Pashto script"
        : "Tap to show Roman Pashto";
    }
  }

  play() {
    if (this.state === "complete") this.elapsedMs = 0;
    this.state = "playing";
    this.startedAt = this.now() - this.elapsedMs;
    this.render();
    this.frameId = this.requestFrame(this.tick);
  }

  pause() {
    if (this.state !== "playing") return;
    this.elapsedMs = Math.min(VOICE_DEMO_DURATION_MS, this.now() - this.startedAt);
    this.state = "paused";
    if (this.frameId !== null) this.cancelFrame(this.frameId);
    this.frameId = null;
    this.render();
  }

  tick() {
    this.elapsedMs = Math.min(VOICE_DEMO_DURATION_MS, this.now() - this.startedAt);
    if (this.elapsedMs >= VOICE_DEMO_DURATION_MS) {
      this.state = "complete";
      this.frameId = null;
      this.render();
      return;
    }
    this.render();
    this.frameId = this.requestFrame(this.tick);
  }

  render() {
    const progressValue = Math.round((this.elapsedMs / VOICE_DEMO_DURATION_MS) * 100);
    this.root.dataset.voiceState = this.state;
    this.root.style.setProperty("--voice-progress", String(progressValue / 100));
    this.progress?.setAttribute("aria-valuenow", String(progressValue));
    if (this.time) this.time.textContent = formatElapsed(this.elapsedMs);

    this.wordTracks.forEach((track) => {
      track.forEach((word, index) => {
        const state = this.state === "idle"
          ? "upcoming"
          : voiceWordState(this.elapsedMs, VOICE_DEMO_WORD_TIMINGS[index]);
        word.dataset.wordState = state;
      });
    });

    const playing = this.state === "playing";
    const stateCopy = VOICE_DEMO_STATE_COPY[this.state];
    this.control?.setAttribute("aria-pressed", String(playing));
    this.control?.setAttribute("aria-label", stateCopy.accessibleName);
    if (this.prompt) this.prompt.textContent = stateCopy.prompt;
    if (this.stateLabel) this.stateLabel.textContent = stateCopy.label;
  }

  destroy() {
    if (this.frameId !== null) this.cancelFrame(this.frameId);
    this.revealObserver?.disconnect();
    this.control?.removeEventListener("click", this.handleControl);
    this.languageToggle?.removeEventListener("click", this.handleLanguageToggle);
    this.motionQuery.removeEventListener?.("change", this.handleMotionChange);
    this.frameId = null;
    this.revealObserver = null;
  }
}

export function initVoiceDemo(scope = document) {
  const root = scope.querySelector("[data-voice-demo]");
  if (!root) return null;
  return new VoiceDemo(root).initialize();
}

// A future real-audio adapter can supply HTMLAudioElement.currentTime * 1000 as
// the clock and replace VOICE_DEMO_WORD_TIMINGS with aligned transcript timestamps.
