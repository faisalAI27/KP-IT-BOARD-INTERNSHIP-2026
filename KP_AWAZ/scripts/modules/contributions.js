import { getSentencePrompts } from "../services/contributions-api.js?v=20260723-guided-only";
import { ContributionAuthController } from "./contribution-auth.js?v=20260717-member-workspace";
import { initRababRecorderTemplate } from "./rabab-recorder-template.js?v=20260723-rabab-recorder";
import { createRecorder } from "./recorder.js?v=20260723-rabab-recorder";

const SENTENCE_LOAD_ERROR =
  "The reviewed Pashto sentence could not be loaded. Try again before recording.";
const NO_SENTENCE_PROMPTS =
  "No reviewed Pashto sentences are available right now. Please try again later.";
export const ACCOUNT_POLICY_SUBMISSION_BLOCK_MESSAGE =
  "Submission is temporarily unavailable while KP AWAZ connects your verified account-level data-use acceptance. No recording was uploaded; your recording is still here to listen to or record again.";

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
  const providedSentence = document.getElementById("providedSentence");
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
    providedSentence.classList.remove("is-leaving", "is-entering");
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

  function renderProvidedSentence({ animate = false } = {}) {
    const sentence = getSelectedSentence();
    const update = () => {
      replaceProvidedSentenceText(sentence?.text ?? "");
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

    providedSentence.classList.add("is-leaving");
    scheduleSentenceTransition(() => {
      update();
      providedSentence.classList.remove("is-leaving");
      providedSentence.classList.add("is-entering");
      scheduleSentenceTransition(() => {
        providedSentence.classList.remove("is-entering");
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
      !authVerified || !donateRecorder?.hasRecording();
  }

  function validateCurrentSentence({ focus = false } = {}) {
    if (sentencePromptsReady && getSelectedSentence()) return true;
    showSentencePromptStatus(SENTENCE_LOAD_ERROR);
    if (focus) retrySentencePrompts.focus();
    return false;
  }

  function showAccountPolicyBlock(element) {
    // TODO(account-policy): Re-enable uploads only after the authenticated profile API
    // returns an explicit current-version acceptance with a server timestamp. Never
    // synthesize consent or infer it from an earlier recording's consent fields.
    element.textContent = ACCOUNT_POLICY_SUBMISSION_BLOCK_MESSAGE;
    element.hidden = false;
    element.focus?.();
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
    idleStatus: "Speak at your normal pace. Tap the Rabab again when finished.",
    idleCallout: "Your voice, in its natural rhythm.",
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
    syncRecordAccess();
  }

  function updateContributionAccess({ verified }) {
    authVerified = verified;
    syncRecordAccess();
  }

  function makeGuidedRecordingUnavailable(message) {
    pashtoSentences = [];
    sentenceIndex = 0;
    sentencePromptsReady = false;
    providedSentenceInput.disabled = true;
    nextSentenceButton.disabled = true;
    clearSentenceTransitions();
    replaceProvidedSentenceText("");
    providedMeaning.textContent =
      "Recording starts when a reviewed Pashto sentence is available.";
    sentenceNumber.textContent = "Sentence unavailable";
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
    providedSentence.focus({ preventScroll: true });
  });
  retrySentencePrompts.addEventListener("click", loadSentencePrompts);

  donateRecordAgain.addEventListener("click", () => {
    donateRecorder.reset();
    donateRecordButton.focus();
  });
  donateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    donationError.hidden = true;
    if (!accessController.canContribute()) return;
    if (!validateCurrentSentence({ focus: true })) return;
    if (!donateRecorder.hasRecording()) {
      donateRecordButton.focus();
      return;
    }
    showAccountPolicyBlock(donationError);
  });

  document.getElementById("donateAgainBtn").addEventListener("click", () => {
    resetDonationFlow();
    providedSentence.focus({ preventScroll: true });
  });

  applyProfileDefaults();
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
    rababRecorderPresenter.destroy();
    accessController.destroy();
    donateRecorder.destroy();
    activeContributionCleanup = null;
  };
  accessController.init();
  await loadSentencePrompts();

  if (sentencePromptsReady) {
    window.requestAnimationFrame(() => {
      providedSentence.focus({ preventScroll: true });
    });
  }
  return true;
}
