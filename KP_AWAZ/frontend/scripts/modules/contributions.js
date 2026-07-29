import {
  CONSENT_POLICY_VERSION,
  getSentencePrompts,
  submitVoiceDonation,
} from "../services/contributions-api.js?v=20260726-account-consent";
import {
  acceptMyCurrentPolicy,
  getMyConsentSummary,
} from "../services/profile-api.js?v=20260726-account-consent";
import { ContributionAuthController } from "./contribution-auth.js?v=20260717-member-workspace";
import { initRababRecorderTemplate } from "./rabab-recorder-template.js?v=20260726-focused-recorder";
import { createRecorder } from "./recorder.js?v=20260726-focused-recorder";

const SENTENCE_LOAD_ERROR =
  "The reviewed Pashto sentence could not be loaded. Try again before recording.";
const NO_SENTENCE_PROMPTS =
  "No reviewed Pashto sentences are available right now. Please try again later.";
export const DEMO_PASHTO_SENTENCE =
  "زما ژبه زما پېژندنه ده، او زما غږ د هغې راتلونکی جوړوي.";
export const DEMO_ROMAN_PASHTO =
  "Zama zhaba zama pehzhandana da, ao zama ghag da haghe ratlonkay jorawi.";

let activeContributionCleanup = null;

export function tokenizeSentenceWords(text = "") {
  return String(text)
    .split(/(\s+)/u)
    .filter(Boolean)
    .map((token) => ({
      text: token,
      isWord: !/^\s+$/u.test(token),
    }));
}

export function normalizeContributionMode() {
  return "guided";
}

export function getSentenceLanguageView(language = "script") {
  const showRoman = language === "roman";
  return {
    language: showRoman ? "roman" : "script",
    showRoman,
    accessibleName: showRoman ? "Show Pashto script" : "Show Roman Pashto",
    hint: showRoman
      ? "Tap to show Pashto script"
      : "Tap to show Roman Pashto",
  };
}

export function createSentenceLanguageToggle({
  source,
  toggle,
  scriptFace,
  romanFace,
  hint,
}) {
  if (!source || !toggle || !scriptFace || !romanFace || !hint) {
    return {
      setLanguage() {},
      destroy() {},
    };
  }

  function setLanguage(language) {
    const view = getSentenceLanguageView(language);
    source.dataset.sentenceLanguage = view.language;
    toggle.setAttribute("aria-pressed", String(view.showRoman));
    toggle.setAttribute("aria-label", view.accessibleName);
    toggle.setAttribute(
      "aria-describedby",
      view.showRoman ? "providedRoman" : "providedSentence",
    );
    scriptFace.setAttribute("aria-hidden", String(view.showRoman));
    romanFace.setAttribute("aria-hidden", String(!view.showRoman));
    hint.textContent = view.hint;
  }

  function handleToggle() {
    setLanguage(
      source.dataset.sentenceLanguage === "roman" ? "script" : "roman",
    );
  }

  toggle.addEventListener("click", handleToggle);
  setLanguage(source.dataset.sentenceLanguage);

  return {
    setLanguage,
    destroy() {
      toggle.removeEventListener("click", handleToggle);
    },
  };
}

export function destroyContributions() {
  activeContributionCleanup?.();
}

export async function initContributions({ profile = {} } = {}) {
  if (activeContributionCleanup) return true;
  const contributionPanel = document.getElementById("contribution-panel");
  if (!contributionPanel) return false;

  const donateForm = document.getElementById("donateForm");
  const donateSuccess = document.getElementById("success-donate");
  const donationError = document.getElementById("donationError");
  const providedSentenceInput = document.querySelector(
    'input[name="sentence-source"][value="provided"]',
  );
  const providedSentenceSource = document.getElementById("providedSentenceSource");
  const providedSentenceToggle = document.getElementById("providedSentenceToggle");
  const providedSentence = document.getElementById("providedSentence");
  const providedRoman = document.getElementById("providedRoman");
  const providedScriptFace = document.querySelector("[data-provided-script-face]");
  const providedRomanFace = document.querySelector("[data-provided-roman-face]");
  const providedLanguageHint = document.querySelector(
    "[data-provided-language-hint]",
  );
  const sentenceLanguageToggle = createSentenceLanguageToggle({
    source: providedSentenceSource,
    toggle: providedSentenceToggle,
    scriptFace: providedScriptFace,
    romanFace: providedRomanFace,
    hint: providedLanguageHint,
  });
  const providedMeaning = document.getElementById("providedMeaning");
  const sentenceNumber = document.getElementById("sentenceNumber");
  const nextSentenceButton = document.getElementById("nextSentenceBtn");
  const sentencePromptStatus = document.getElementById("sentencePromptStatus");
  const sentencePromptMessage = document.getElementById("sentencePromptMessage");
  const retrySentencePrompts = document.getElementById("retrySentencePrompts");
  const donorName = document.getElementById("donor-name");
  const donorLanguage = document.getElementById("donor-language");
  const donateReview = document.getElementById("donateReview");
  const donateRecordAgain = document.getElementById("donateRecordAgain");
  const reviewSentence = document.getElementById("reviewSentence");
  const submitDonationButton = document.getElementById("submitDonation");
  const accountConsentPanel = document.getElementById("accountConsentPanel");
  const accountConsentCheckbox = document.getElementById(
    "accountConsentCheckbox",
  );
  const accountConsentStatus = document.getElementById("accountConsentStatus");
  const contributionAuthStatus = document.getElementById("contributionAuthStatus");
  const contributionAuthMessage = document.getElementById("contributionAuthMessage");
  const contributionSignInButton = document.getElementById(
    "contributionSignInButton",
  );
  const donateRecordButton = document.getElementById("donateRecBtn");

  let pashtoSentences = [];
  let sentenceIndex = 0;
  let sentencePromptsReady = false;
  let sentencePromptsLoading = false;
  let authVerified = false;
  let accountConsentCurrent = false;
  let accountConsentLoading = false;
  let submitting = false;
  let consentRequestGeneration = 0;
  let destroyed = false;
  let donateRecorder;
  let accessController;
  let rababRecorderPresenter;
  const sentenceTransitionTimeouts = new Set();

  function applyProfileDefaults() {
    donorName.value =
      typeof profile.displayName === "string" && profile.displayName.trim()
        ? profile.displayName.trim()
        : "Contributor";
    donorLanguage.value = "Pashto";
  }

  function getSelectedSentence() {
    return pashtoSentences[sentenceIndex] ?? null;
  }

  function clearSentenceTransitions() {
    sentenceTransitionTimeouts.forEach((handle) => window.clearTimeout(handle));
    sentenceTransitionTimeouts.clear();
    providedSentenceToggle.classList.remove("is-leaving", "is-entering");
  }

  function scheduleSentenceTransition(callback, delay) {
    const handle = window.setTimeout(() => {
      sentenceTransitionTimeouts.delete(handle);
      callback();
    }, delay);
    sentenceTransitionTimeouts.add(handle);
  }

  function replaceProvidedSentenceText(text) {
    const fragment = document.createDocumentFragment();
    tokenizeSentenceWords(text).forEach((token) => {
      if (!token.isWord) {
        fragment.append(document.createTextNode(token.text));
        return;
      }
      const word = document.createElement("span");
      word.className = "pashto-word";
      word.textContent = token.text;
      fragment.append(word);
    });
    providedSentence.replaceChildren(fragment);
  }

  function setProvidedSentenceLanguage(language) {
    sentenceLanguageToggle.setLanguage(language);
  }

  function renderProvidedSentence({ animate = false } = {}) {
    const sentence = getSelectedSentence();
    const update = () => {
      setProvidedSentenceLanguage("script");
      replaceProvidedSentenceText(sentence?.text ?? "");
      providedRoman.textContent = sentence?.romanText ?? DEMO_ROMAN_PASHTO;
      providedMeaning.textContent = sentence?.meaning ?? "Meaning not available.";
      sentenceNumber.textContent = sentence
        ? `Sentence ${sentenceIndex + 1} of ${pashtoSentences.length}`
        : "Sentence unavailable";
    };
    const reducedMotion =
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

    clearSentenceTransitions();
    if (!animate || reducedMotion) {
      update();
      return;
    }

    providedSentenceToggle.classList.add("is-leaving");
    scheduleSentenceTransition(() => {
      update();
      providedSentenceToggle.classList.remove("is-leaving");
      providedSentenceToggle.classList.add("is-entering");
      scheduleSentenceTransition(() => {
        providedSentenceToggle.classList.remove("is-entering");
      }, 190);
    }, 110);
  }

  function showSentencePromptStatus(message, { retry = true } = {}) {
    sentencePromptMessage.textContent = message;
    retrySentencePrompts.hidden = !retry;
    retrySentencePrompts.disabled = !retry;
    sentencePromptStatus.hidden = false;
  }

  function hideSentencePromptStatus() {
    sentencePromptStatus.hidden = true;
    retrySentencePrompts.hidden = false;
    retrySentencePrompts.disabled = false;
  }

  function syncRecordAccess() {
    donateRecordButton.disabled = !authVerified || !sentencePromptsReady;
    submitDonationButton.disabled =
      !authVerified ||
      !donateRecorder?.hasRecording() ||
      submitting ||
      accountConsentLoading ||
      (!accountConsentCurrent && !accountConsentCheckbox.checked);
  }

  function validateCurrentSentence({ focus = false } = {}) {
    if (sentencePromptsReady && getSelectedSentence()) return true;
    showSentencePromptStatus(SENTENCE_LOAD_ERROR);
    if (focus) retrySentencePrompts.focus();
    return false;
  }

  function renderAccountConsent() {
    accountConsentPanel.hidden = accountConsentCurrent;
    accountConsentCheckbox.disabled =
      accountConsentCurrent || accountConsentLoading || submitting;
    accountConsentStatus.textContent = accountConsentCurrent
      ? "Current data-use policy accepted for this account."
      : accountConsentLoading
        ? "Checking your account acceptance…"
        : "Accept once to submit this and future recordings under the current policy.";
    syncRecordAccess();
  }

  async function loadAccountConsent() {
    const generation = ++consentRequestGeneration;
    accountConsentLoading = true;
    renderAccountConsent();
    try {
      const summary = await getMyConsentSummary();
      if (destroyed || generation !== consentRequestGeneration) return;
      accountConsentCurrent = summary.isCurrent;
      accountConsentCheckbox.checked = summary.isCurrent;
    } catch {
      if (destroyed || generation !== consentRequestGeneration) return;
      accountConsentCurrent = false;
      accountConsentCheckbox.checked = false;
      accountConsentStatus.textContent =
        "Acceptance status could not be checked. You can still accept it below and submit.";
    } finally {
      if (!destroyed && generation === consentRequestGeneration) {
        accountConsentLoading = false;
        renderAccountConsent();
      }
    }
  }

  function setSubmitButtonLabel(label, { arrow = false } = {}) {
    submitDonationButton.replaceChildren(document.createTextNode(label));
    if (arrow) {
      const arrowMark = document.createElement("span");
      arrowMark.setAttribute("aria-hidden", "true");
      arrowMark.textContent = "→";
      submitDonationButton.append(" ", arrowMark);
    }
  }

  function hideDonateReview() {
    donateReview.hidden = true;
    donateRecordAgain.disabled = true;
    submitDonationButton.disabled = true;
  }

  rababRecorderPresenter = initRababRecorderTemplate();

  donateRecorder = createRecorder({
    buttonId: "donateRecBtn",
    timerId: "donateRecTimer",
    statusId: "donateRecStatus",
    playbackId: "donateRecPlayback",
    calloutId: "donateRecCallout",
    visualizerCanvasId: "donateWaveform",
    idleStatus: "Speak at your normal pace. Tap again when finished.",
    idleCallout: "Tap once to record",
    recordingStatus: "The sentence stays visible. Tap again when finished.",
    previewOnReady: true,
    canStart: () =>
      (accessController?.canContribute() ?? false) &&
      validateCurrentSentence({ focus: true }),
    onLevel: rababRecorderPresenter.setSignalLevel,
    onCapture: () => {
      reviewSentence.textContent = getSelectedSentence()?.text ?? "";
      donateReview.hidden = false;
      donateRecordAgain.disabled = false;
      submitDonationButton.disabled = !authVerified;
      syncRecordAccess();
    },
    onReset: hideDonateReview,
  });

  function resetDonationFlow() {
    donateForm.reset();
    donateForm.classList.remove("is-submitted");
    donateRecorder.reset();
    applyProfileDefaults();
    sentenceIndex = 0;
    donationError.hidden = true;
    donateSuccess.hidden = true;
    providedSentenceInput.checked = true;
    if (sentencePromptsReady) renderProvidedSentence();
    syncRecordAccess();
  }

  function clearContributionSession() {
    resetDonationFlow();
    authVerified = false;
    accountConsentCurrent = false;
    accountConsentLoading = false;
    consentRequestGeneration += 1;
    accountConsentCheckbox.checked = false;
    renderAccountConsent();
    syncRecordAccess();
  }

  function updateContributionAccess({ verified }) {
    authVerified = verified;
    if (verified) {
      void loadAccountConsent();
    }
    syncRecordAccess();
  }

  function makeGuidedRecordingUnavailable(message) {
    pashtoSentences = [];
    sentenceIndex = 0;
    sentencePromptsReady = false;
    providedSentenceInput.disabled = true;
    nextSentenceButton.disabled = true;
    clearSentenceTransitions();
    setProvidedSentenceLanguage("script");
    replaceProvidedSentenceText(DEMO_PASHTO_SENTENCE);
    providedRoman.textContent = DEMO_ROMAN_PASHTO;
    providedMeaning.textContent =
      "Preview only — a reviewed sentence will replace this example when recording is available.";
    sentenceNumber.textContent = "Preview sentence";
    showSentencePromptStatus(message);
    syncRecordAccess();
  }

  async function loadSentencePrompts() {
    if (destroyed || sentencePromptsLoading) return;
    sentencePromptsLoading = true;
    sentencePromptsReady = false;
    providedSentenceInput.disabled = true;
    nextSentenceButton.disabled = true;
    providedMeaning.textContent = "Loading a reviewed sentence…";
    showSentencePromptStatus("Loading a reviewed sentence…", { retry: false });
    syncRecordAccess();
    try {
      const prompts = await getSentencePrompts("Pashto");
      if (destroyed) return;
      if (!prompts.length) {
        makeGuidedRecordingUnavailable(NO_SENTENCE_PROMPTS);
        return;
      }
      pashtoSentences = prompts;
      sentenceIndex = 0;
      sentencePromptsReady = true;
      providedSentenceInput.disabled = false;
      nextSentenceButton.disabled = prompts.length < 2;
      renderProvidedSentence();
      hideSentencePromptStatus();
      syncRecordAccess();
    } catch {
      if (!destroyed) makeGuidedRecordingUnavailable(SENTENCE_LOAD_ERROR);
    } finally {
      sentencePromptsLoading = false;
    }
  }

  nextSentenceButton.addEventListener("click", () => {
    if (!sentencePromptsReady || pashtoSentences.length < 2) return;
    donateRecorder.reset();
    sentenceIndex = (sentenceIndex + 1) % pashtoSentences.length;
    renderProvidedSentence({ animate: true });
    providedSentenceToggle.focus({ preventScroll: true });
  });
  retrySentencePrompts.addEventListener("click", loadSentencePrompts);

  donateRecordAgain.addEventListener("click", () => {
    donateRecorder.reset();
    donateRecordButton.focus();
  });
  accountConsentCheckbox.addEventListener("change", () => {
    donationError.hidden = true;
    syncRecordAccess();
  });
  donateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    donationError.hidden = true;
    if (!accessController.canContribute()) return;
    if (!validateCurrentSentence({ focus: true })) return;
    if (!donateRecorder.hasRecording()) {
      donateRecordButton.focus();
      return;
    }
    if (!accountConsentCurrent && !accountConsentCheckbox.checked) {
      donationError.textContent =
        "Accept the current data-use policy before submitting.";
      donationError.hidden = false;
      accountConsentCheckbox.focus();
      return;
    }

    const submission = accessController.beginSubmission("guided");
    if (!submission) return;
    submitting = true;
    setSubmitButtonLabel("Submitting…");
    renderAccountConsent();

    try {
      if (!accountConsentCurrent) {
        const summary = await acceptMyCurrentPolicy(CONSENT_POLICY_VERSION);
        if (!accessController.isCurrent(submission)) return;
        accountConsentCurrent = summary.isCurrent;
        if (!accountConsentCurrent) {
          throw new Error(
            "The current data-use policy could not be accepted. Please try again.",
          );
        }
      }

      const sentence = getSelectedSentence();
      await submitVoiceDonation({
        contributorName: donorName.value,
        language: donorLanguage.value,
        sentence: sentence.text,
        sentenceSource: "provided",
        sentenceId: sentence.id,
        consentGiven: true,
        consentPolicyVersion: CONSENT_POLICY_VERSION,
        audioBlob: donateRecorder.getBlob(),
        audioDurationSeconds: donateRecorder.getDurationSeconds(),
        deviceMetadata: donateRecorder.getDeviceMetadata(),
      });
      if (!accessController.isCurrent(submission)) return;

      donateReview.hidden = true;
      donateForm.classList.add("is-submitted");
      donateSuccess.hidden = false;
      donateSuccess.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      globalThis.dispatchEvent?.(
        new CustomEvent("kpawaz:contribution-submitted", {
          detail: { type: "guided" },
        }),
      );
    } catch (error) {
      if (!accessController.isCurrent(submission)) return;
      donationError.textContent =
        typeof error?.message === "string" && error.message.trim()
          ? error.message.trim()
          : "The recording could not be submitted. It is still here to try again.";
      donationError.hidden = false;
      donationError.focus();
    } finally {
      const sessionStillCurrent = accessController.finishSubmission(submission);
      submitting = false;
      setSubmitButtonLabel("Submit recording", { arrow: true });
      if (sessionStillCurrent) renderAccountConsent();
    }
  });

  document.getElementById("donateAgainBtn").addEventListener("click", () => {
    resetDonationFlow();
    providedSentenceToggle.focus({ preventScroll: true });
  });

  applyProfileDefaults();
  setProvidedSentenceLanguage("script");
  renderAccountConsent();
  providedSentenceInput.checked = true;
  accessController = new ContributionAuthController({
    recorders: [donateRecorder],
    statusElement: contributionAuthStatus,
    messageElement: contributionAuthMessage,
    signInButton: contributionSignInButton,
    onAccessChange: updateContributionAccess,
    onSessionInvalidated: clearContributionSession,
  });
  activeContributionCleanup = () => {
    if (destroyed) return;
    destroyed = true;
    clearSentenceTransitions();
    sentenceLanguageToggle.destroy();
    rababRecorderPresenter.destroy();
    accessController.destroy();
    donateRecorder.destroy();
    activeContributionCleanup = null;
  };
  accessController.init();
  await loadSentencePrompts();

  if (sentencePromptsReady) {
    window.requestAnimationFrame(() => {
      providedSentenceToggle.focus({ preventScroll: true });
    });
  }
  return true;
}
