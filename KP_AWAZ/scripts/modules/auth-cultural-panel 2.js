export const CULTURAL_MESSAGE_INTERVAL_MS = 6_000;

export const CULTURAL_MESSAGES = Object.freeze([
  "Every voice carries a memory.",
  "Every language carries a community.",
  "Small recordings can protect a language for generations.",
  "Your accent belongs in the digital future.",
  "Technology grows wiser when every community can be heard.",
]);


export class AuthCulturalPanel {
  constructor({
    root = globalThis.document,
    matchMediaImpl = globalThis.matchMedia?.bind(globalThis),
    setIntervalImpl = (...args) => globalThis.setInterval(...args),
    clearIntervalImpl = (timer) => globalThis.clearInterval(timer),
  } = {}) {
    this._root = root;
    this._matchMedia = matchMediaImpl;
    this._setInterval = setIntervalImpl;
    this._clearInterval = clearIntervalImpl;
    this._message = null;
    this._hero = null;
    this._heroImage = null;
    this._timer = null;
    this._index = 0;
    this._visibilityListener = () => this._handleVisibility();
    this._imageLoadListener = () => this._setHeroState("loaded");
    this._imageErrorListener = () => this._setHeroState("fallback");
  }

  initialize() {
    if (this._message) return true;
    this._message = this._root?.getElementById?.("authCulturalMessage") ?? null;
    if (!this._message) return false;
    this._hero = this._root?.getElementById?.("authCulturalHero") ?? null;
    this._heroImage = this._root?.getElementById?.("authCulturalHeroImage") ?? null;

    this._root.addEventListener?.("visibilitychange", this._visibilityListener);
    this._heroImage?.addEventListener?.("load", this._imageLoadListener);
    this._heroImage?.addEventListener?.("error", this._imageErrorListener);
    if (this._heroImage?.complete) {
      this._setHeroState(this._heroImage.naturalWidth > 0 ? "loaded" : "fallback");
    } else {
      this._setHeroState("loading");
    }
    this._setAmbientPaused(Boolean(this._root?.hidden) || this._prefersReducedMotion());
    this._renderMessage();
    this._start();
    return true;
  }

  destroy() {
    this._stop();
    this._root?.removeEventListener?.("visibilitychange", this._visibilityListener);
    this._heroImage?.removeEventListener?.("load", this._imageLoadListener);
    this._heroImage?.removeEventListener?.("error", this._imageErrorListener);
    this._setAmbientPaused(true);
    this._message = null;
    this._hero = null;
    this._heroImage = null;
    this._index = 0;
  }

  _prefersReducedMotion() {
    try {
      return Boolean(this._matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    } catch {
      return false;
    }
  }

  _start() {
    if (this._timer !== null || this._root?.hidden || this._prefersReducedMotion()) {
      return;
    }
    this._timer = this._setInterval(() => {
      this._index = (this._index + 1) % CULTURAL_MESSAGES.length;
      this._renderMessage();
    }, CULTURAL_MESSAGE_INTERVAL_MS);
  }

  _stop() {
    if (this._timer !== null) this._clearInterval(this._timer);
    this._timer = null;
  }

  _handleVisibility() {
    if (this._root?.hidden) {
      this._stop();
      this._setAmbientPaused(true);
      return;
    }
    this._setAmbientPaused(this._prefersReducedMotion());
    this._start();
  }

  _setHeroState(state) {
    if (!this._hero) return;
    this._hero.dataset.heroState = state;
  }

  _setAmbientPaused(paused) {
    if (!this._hero) return;
    this._hero.dataset.ambientState = paused ? "paused" : "running";
  }

  _renderMessage() {
    if (!this._message) return;
    this._message.textContent = CULTURAL_MESSAGES[this._index];
  }
}


const authCulturalPanel = new AuthCulturalPanel();


export const initializeAuthCulturalPanel = () => authCulturalPanel.initialize();
export const destroyAuthCulturalPanel = () => authCulturalPanel.destroy();
