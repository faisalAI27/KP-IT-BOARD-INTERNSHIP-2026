import { getSentencePrompts } from "../services/contributions-api.js?v=20260717-member-workspace";
import { ContributionAuthController } from "./contribution-auth.js?v=20260717-member-workspace";
import { createRecorder, stopRecorderIfActive } from "./recorder.js?v=20260723-rabab-reading";

const SENTENCE_LOAD_ERROR =
  "Sentence prompts could not be loaded. Try again, or use your own Pashto sentence below.";
const NO_SENTENCE_PROMPTS =
  "No reviewed sentences are available right now. You can still use your own Pashto sentence.";
const VALID_CONTRIBUTION_MODES = new Set(["guided", "custom"]);
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

export function normalizeContributionMode(search = "") {
  const raw = String(search || "");
  const query = raw.startsWith("?") ? raw : `?${raw}`;
  const mode = new URLSearchParams(query).get("mode");
  return VALID_CONTRIBUTION_MODES.has(mode) ? mode : "guided";
}

export function destroyContributions() {
  activeContributionCleanup?.();
}

export async function initContributions({
  profile = {},
  search = globalThis.location?.search ?? "",
} = {}) {
  if (activeContributionCleanup) return true;
  const contributionPanel = document.getElementById("contribution-panel");
  if (!contributionPanel) return false;

  const initialMode = normalizeContributionMode(search);
  const donateForm = document.getElementById("donateForm");
  const donateSuccess = document.getElementById("success-donate");
  const donationError = document.getElementById("donationError");
  const providedSentenceInput = document.querySelector('input[name="sentence-source"][value="provided"]');
  const customSentenceInput = document.querySelector('input[name="sentence-source"][value="custom"]');
  const providedSentenceSource = document.getElementById("providedSentenceSource");
  const customSentenceSource = document.getElementById("customSentenceSource");
  const providedSentence = document.getElementById("providedSentence");
  const providedMeaning = document.getElementById("providedMeaning");
  const nextSentenceButton = document.getElementById("nextSentenceBtn");
  const sentencePromptStatus = document.getElementById("sentencePromptStatus");
  const sentencePromptMessage = document.getElementById("sentencePromptMessage");
  const retrySentencePrompts = document.getElementById("retrySentencePrompts");
  const customSentence = document.getElementById("custom-sentence");
  const contributionModeLabel = document.getElementById("contributionModeLabel");
  const contributionModeDescription = document.getElementById("contributionModeDescription");
  const switchSentenceMode = document.getElementById("switchSentenceMode");
  const customSentenceError = document.getElementById("customSentenceError");
  const sentenceCount = document.getElementById("sentenceCount");
  const donorName = document.getElementById("donor-name");
  const donorLanguage = document.getElementById("donor-language");
  const donateReview = document.getElementById("donateReview");
  const reviewSentence = document.getElementById("reviewSentence");
  const submitDonationButton = document.getElementById("submitDonation");
  const recordSoundForm = document.getElementById("recordSoundForm");
  const openRecordingDisclosure = document.querySelector(".open-recording-disclosure");
  const recordName = document.getElementById("record-name");
  const recordLanguage = document.getElementById("record-language-select");
  const openReview = document.getElementById("openReview");
  const submitOpenRecordingButton = document.getElementById("submitOpenRecording");
  const recordSuccess = document.getElementById("success-record");
  const recordError = document.getElementById("recordError");
  const contributionAuthStatus = document.getElementById("contributionAuthStatus");
  const contributionAuthMessage = document.getElementById("contributionAuthMessage");
  const contributionSignInButton = document.getElementById("contributionSignInButton");
  const donateRecordButton = document.getElementById("donateRecBtn");
  const donateRecordStateLabel = document.getElementById("donateRecordStateLabel");
  const openRecordButton = document.getElementById("openRecBtn");
  const recordingJourneySteps = [
    ...document.querySelectorAll("#recordingJourney [data-recording-step]"),
  ];

  let pashtoSentences = [];
  let sentenceIndex = 0;
  let sentencePromptsReady = false;
  let sentencePromptsLoading = false;
  let authVerified = false;
  let destroyed = false;
  let donateRecorder;
  let openRecorder;
  let accessController;
  let recordingJourneyObserver;
  const sentenceTransitionTimeouts = new Set();

  function setRecordingJourney(step) {
    recordingJourneySteps.forEach((item) => {
      const itemStep = Number(item.dataset.recordingStep);
      const indicator = item.querySelector(".journey-step-number");
      const isActive = itemStep === step;
      const isDone = itemStep < step;

      item.classList.toggle("is-active", isActive);
      item.classList.toggle("is-done", isDone);
      if (isActive) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
      if (indicator) indicator.textContent = isDone ? "✓" : String(itemStep);
    });
  }

  function syncRecordingJourney() {
    if (donateRecordButton.classList.contains("ready")) {
      setRecordingJourney(3);
      donateRecordStateLabel.textContent = "Ready to submit";
      return;
    }
    if (
      donateRecordButton.classList.contains("recording") ||
      donateRecordButton.classList.contains("requesting") ||
      donateRecordButton.classList.contains("processing")
    ) {
      setRecordingJourney(2);
      donateRecordStateLabel.textContent = donateRecordButton.classList.contains("recording")
        ? "Recording in progress"
        : "Preparing your recording";
      return;
    }
    setRecordingJourney(1);
    donateRecordStateLabel.textContent = "Ready when you are";
  }

  function selectedSentenceSource() {
    return document.querySelector('input[name="sentence-source"]:checked')?.value ?? "provided";
  }

  function selectedMode() {
    return selectedSentenceSource() === "custom" ? "custom" : "guided";
  }

  function applyProfileDefaults() {
    donorName.value = typeof profile.displayName === "string" ? profile.displayName.trim() : "Contributor";
    donorLanguage.value = "Pashto";
    recordName.value = donorName.value;
    const preferred = typeof profile.preferredLanguage === "string" ? profile.preferredLanguage.trim() : "";
    if ([...recordLanguage.options].some((option) => option.value === preferred)) {
      recordLanguage.value = preferred;
    } else {
      recordLanguage.value = "Pashto";
    }
  }

  function getSelectedSentence() {
    if (selectedSentenceSource() === "custom") {
      return {
        id: null,
        language: "Pashto",
        text: customSentence.value.trim(),
        meaning: "Contributor-written sentence",
      };
    }
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
    const sentence = pashtoSentences[sentenceIndex];
    const update = () => {
      replaceProvidedSentenceText(sentence?.text ?? "");
      providedMeaning.textContent = sentence?.meaning ?? "Meaning not available.";
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

  function setMode(mode, { updateAddress = false, focus = false } = {}) {
    const useCustomSentence = mode === "custom";
    providedSentenceInput.checked = !useCustomSentence;
    customSentenceInput.checked = useCustomSentence;
    providedSentenceSource.hidden = useCustomSentence;
    customSentenceSource.hidden = !useCustomSentence;
    providedSentenceSource.classList.toggle("is-entering", !useCustomSentence);
    customSentenceSource.classList.toggle("is-entering", useCustomSentence);
    customSentence.disabled = !useCustomSentence;
    customSentence.required = useCustomSentence;
    nextSentenceButton.disabled = useCustomSentence || !sentencePromptsReady || pashtoSentences.length < 2;
    contributionModeLabel.textContent = useCustomSentence
      ? "Your own Pashto sentence"
      : "Reviewed Pashto sentence";
    contributionModeDescription.textContent = useCustomSentence
      ? "Write the words below, then record them."
      : "Your sentence is ready below.";
    switchSentenceMode.textContent = useCustomSentence
      ? "Use a reviewed sentence instead"
      : "Use my own sentence instead";

    if (updateAddress && globalThis.history?.replaceState && globalThis.location) {
      const url = new URL(globalThis.location.href);
      url.searchParams.set("mode", useCustomSentence ? "custom" : "guided");
      globalThis.history.replaceState(globalThis.history.state, "", url);
    }

    if (focus) {
      window.requestAnimationFrame(() => {
        const target = useCustomSentence ? customSentence : providedSentence;
        target.focus({ preventScroll: true });
      });
    }
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

  function validateCustomSentence({ focus = false } = {}) {
    if (selectedSentenceSource() !== "custom") return true;
    const valid = customSentence.value.trim().length >= 3;
    const message = valid ? "" : "Write at least 3 characters before recording.";
    customSentence.setCustomValidity(message);
    customSentenceError.textContent = message;
    customSentenceError.hidden = valid;
    if (!valid && focus) customSentence.focus();
    return valid;
  }

  function validateCurrentSentence({ focus = false } = {}) {
    if (selectedSentenceSource() === "custom") return validateCustomSentence({ focus });
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
    submitDonationButton.disabled = true;
  }

  function hideOpenReview() {
    openReview.hidden = true;
    submitOpenRecordingButton.disabled = true;
  }

  donateRecorder = createRecorder({
    buttonId: "donateRecBtn",
    timerId: "donateRecTimer",
    statusId: "donateRecStatus",
    playbackId: "donateRecPlayback",
    calloutId: "donateRecCallout",
    visualizerCanvasId: "donateWaveform",
    idleStatus: "Your sentence stays visible while you speak.",
    idleCallout: "Press the Rabab to record",
    canStart: () => (accessController?.canContribute() ?? false) && validateCurrentSentence({ focus: true }),
    onStart: () => stopRecorderIfActive(openRecorder),
    onCapture: () => {
      const sentence = getSelectedSentence();
      reviewSentence.textContent = sentence?.text ?? "";
      donateReview.hidden = false;
      submitDonationButton.disabled = !authVerified;
    },
    onReset: hideDonateReview,
  });

  openRecorder = createRecorder({
    buttonId: "openRecBtn",
    timerId: "openRecTimer",
    statusId: "openRecStatus",
    playbackId: "openRecPlayback",
    calloutId: "openRecCallout",
    visualizerCanvasId: "openWaveform",
    idleStatus: "Speak naturally when recording begins.",
    idleCallout: "Press the Rabab to record",
    canStart: () => accessController?.canContribute() ?? false,
    onStart: () => stopRecorderIfActive(donateRecorder),
    onCapture: () => {
      openReview.hidden = false;
      submitOpenRecordingButton.disabled = !authVerified;
    },
    onReset: hideOpenReview,
  });

  function resetDonationFlow({ mode = initialMode } = {}) {
    donateForm.reset();
    donateForm.classList.remove("is-submitted");
    donateRecorder.reset();
    applyProfileDefaults();
    sentenceIndex = 0;
    sentenceCount.textContent = "0 / 300";
    customSentenceError.hidden = true;
    donationError.hidden = true;
    donateSuccess.hidden = true;
    setMode(mode);
    if (sentencePromptsReady) renderProvidedSentence();
  }

  function clearContributionSession() {
    resetDonationFlow();
    recordSoundForm.reset();
    applyProfileDefaults();
    openRecorder.reset();
    recordSuccess.classList.remove("show");
    recordError.hidden = true;
    submitDonationButton.disabled = true;
    submitOpenRecordingButton.disabled = true;
  }

  function updateContributionAccess({ verified }) {
    authVerified = verified;
    donateRecordButton.disabled = !verified;
    openRecordButton.disabled = !verified;
    submitDonationButton.disabled = !verified || !donateRecorder.hasRecording();
    submitOpenRecordingButton.disabled = !verified || !openRecorder.hasRecording();
  }

  function makeCustomSentenceAvailable(message) {
    pashtoSentences = [];
    sentenceIndex = 0;
    sentencePromptsReady = false;
    providedSentenceInput.disabled = true;
    nextSentenceButton.disabled = true;
    clearSentenceTransitions();
    replaceProvidedSentenceText("");
    providedMeaning.textContent = "";
    showSentencePromptStatus(message);
    switchSentenceMode.hidden = true;
    if (selectedSentenceSource() === "provided") setMode("custom", { updateAddress: true });
  }

  async function loadSentencePrompts() {
    if (destroyed || sentencePromptsLoading) return;
    sentencePromptsLoading = true;
    sentencePromptsReady = false;
    providedSentenceInput.disabled = true;
    nextSentenceButton.disabled = true;
    providedMeaning.textContent = "Loading a reviewed sentence…";
    showSentencePromptStatus("Loading a reviewed sentence…", { retry: false });
    try {
      const prompts = await getSentencePrompts("Pashto");
      if (destroyed) return;
      if (!prompts.length) {
        makeCustomSentenceAvailable(NO_SENTENCE_PROMPTS);
        return;
      }
      pashtoSentences = prompts;
      sentenceIndex = 0;
      sentencePromptsReady = true;
      providedSentenceInput.disabled = false;
      switchSentenceMode.hidden = false;
      renderProvidedSentence();
      hideSentencePromptStatus();
      setMode(selectedMode());
    } catch {
      if (!destroyed) makeCustomSentenceAvailable(SENTENCE_LOAD_ERROR);
    } finally {
      sentencePromptsLoading = false;
    }
  }

  switchSentenceMode.addEventListener("click", () => {
    donateRecorder.reset();
    const nextMode = selectedMode() === "custom" ? "guided" : "custom";
    setMode(nextMode, { updateAddress: true, focus: true });
  });

  nextSentenceButton.addEventListener("click", () => {
    if (!sentencePromptsReady || !pashtoSentences.length) return;
    donateRecorder.reset();
    sentenceIndex = (sentenceIndex + 1) % pashtoSentences.length;
    renderProvidedSentence({ animate: true });
    providedSentence.focus({ preventScroll: true });
  });
  retrySentencePrompts.addEventListener("click", loadSentencePrompts);

  customSentence.addEventListener("input", () => {
    if (donateRecorder.hasRecording() || donateRecorder.isRecording()) donateRecorder.reset();
    sentenceCount.textContent = `${customSentence.value.length} / 300`;
    customSentence.setCustomValidity("");
    customSentenceError.hidden = true;
  });
  customSentence.addEventListener("blur", () => validateCustomSentence());

  document.getElementById("donateRecordAgain").addEventListener("click", () => {
    donateRecorder.reset();
    donateRecordButton.focus();
  });
  document.getElementById("openRecordAgain").addEventListener("click", () => {
    openRecorder.reset();
    openRecordButton.focus();
  });
  openRecordingDisclosure.addEventListener("toggle", () => {
    if (!openRecordingDisclosure.open) openRecorder.reset();
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
    resetDonationFlow({ mode: selectedMode() });
    (selectedMode() === "custom" ? customSentence : providedSentence).focus({ preventScroll: true });
  });

  recordSoundForm.addEventListener("submit", (event) => {
    event.preventDefault();
    recordError.hidden = true;
    if (!accessController.canContribute()) return;
    if (!recordSoundForm.reportValidity()) return;
    if (!openRecorder.hasRecording()) {
      openRecordButton.focus();
      return;
    }
    showAccountPolicyBlock(recordError);
  });

  recordSoundForm.addEventListener("reset", () => {
    window.requestAnimationFrame(() => {
      applyProfileDefaults();
      openRecorder.reset();
      recordSuccess.classList.remove("show");
      recordError.hidden = true;
    });
  });

  applyProfileDefaults();
  setMode(initialMode);
  accessController = new ContributionAuthController({
    recorders: [donateRecorder, openRecorder],
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
    recordingJourneyObserver?.disconnect();
    accessController.destroy();
    donateRecorder.destroy();
    openRecorder.destroy();
    activeContributionCleanup = null;
  };
  accessController.init();
  setRecordingJourney(1);
  if (typeof globalThis.MutationObserver === "function") {
    recordingJourneyObserver = new globalThis.MutationObserver(syncRecordingJourney);
    recordingJourneyObserver.observe(donateRecordButton, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  await loadSentencePrompts();

  window.requestAnimationFrame(() => {
    const target = selectedMode() === "custom" ? customSentence : providedSentence;
    target.focus({ preventScroll: true });
  });
  return true;
}
