import {
  getSentencePrompts,
  submitOpenRecording,
  submitVoiceDonation,
} from "../services/contributions-api.js";
import { createRecorder } from "./recorder.js";

export async function initContributions() {
  const contributionPanel = document.getElementById("contribution-panel");
  if (!contributionPanel) return;

  const pashtoSentences = await getSentencePrompts("Pashto");

  const featureTabs = document.querySelectorAll("[data-feature]");
  const featurePanels = document.querySelectorAll("[data-feature-panel]");
  const donateForm = document.getElementById("donateForm");
  const donateFlowContent = document.getElementById("donateFlowContent");
  const donateSuccess = document.getElementById("success-donate");
  const donationError = document.getElementById("donationError");
  const flowProgress = document.querySelector(".flow-progress");
  const flowScreens = document.querySelectorAll("[data-flow-step]");
  const stepIndicators = document.querySelectorAll("[data-step-indicator]");
  const sentenceSourceInputs = document.querySelectorAll('input[name="sentence-source"]');
  const providedSentenceSource = document.getElementById("providedSentenceSource");
  const customSentenceSource = document.getElementById("customSentenceSource");
  const providedSentence = document.getElementById("providedSentence");
  const providedMeaning = document.getElementById("providedMeaning");
  const customSentence = document.getElementById("custom-sentence");
  const sentenceCount = document.getElementById("sentenceCount");
  const donorName = document.getElementById("donor-name");
  const donorLanguage = document.getElementById("donor-language");
  const recordSentence = document.getElementById("recordSentence");
  const recordLanguage = document.getElementById("recordLanguage");
  const reviewName = document.getElementById("reviewName");
  const reviewLanguage = document.getElementById("reviewLanguage");
  const reviewSentence = document.getElementById("reviewSentence");
  const reviewAvatar = document.getElementById("reviewAvatar");
  const reviewPlayback = document.getElementById("reviewPlayback");
  const toReviewButton = document.getElementById("toReviewBtn");
  const donationConsent = document.getElementById("donation-consent");
  const submitDonationButton = document.getElementById("submitDonation");
  const submitOpenRecordingButton = document.getElementById("submitOpenRecording");
  const recordSoundForm = document.getElementById("recordSoundForm");
  const recordSuccess = document.getElementById("success-record");
  const recordError = document.getElementById("recordError");

  let sentenceIndex = 0;

  const donateRecorder = createRecorder({
    buttonId: "donateRecBtn",
    timerId: "donateRecTimer",
    statusId: "donateRecStatus",
    playbackId: "donateRecPlayback",
    calloutId: "donateRecCallout",
    idleStatus: "Tap the microphone when you are ready",
    onCapture: () => {
      toReviewButton.disabled = false;
    },
    onReset: () => {
      toReviewButton.disabled = true;
      reviewPlayback.removeAttribute("src");
      reviewPlayback.load();
    },
  });

  const openRecorder = createRecorder({
    buttonId: "openRecBtn",
    timerId: "openRecTimer",
    statusId: "openRecStatus",
    playbackId: "openRecPlayback",
    calloutId: "openRecCallout",
    idleStatus: "Tap when you are ready to speak",
    onCapture: () => {
      submitOpenRecordingButton.disabled = false;
    },
    onReset: () => {
      submitOpenRecordingButton.disabled = true;
    },
  });

  function selectedSentenceSource() {
    return document.querySelector('input[name="sentence-source"]:checked').value;
  }

  function getSelectedSentence() {
    if (selectedSentenceSource() === "custom") {
      return {
        text: customSentence.value.trim(),
        meaning: "Contributor-written sentence",
      };
    }

    return pashtoSentences[sentenceIndex];
  }

  function updateSentenceSource() {
    const useCustomSentence = selectedSentenceSource() === "custom";
    providedSentenceSource.hidden = useCustomSentence;
    customSentenceSource.hidden = !useCustomSentence;
    customSentence.disabled = !useCustomSentence;
    customSentence.required = useCustomSentence;
    donorLanguage.disabled = !useCustomSentence;

    if (!useCustomSentence) donorLanguage.value = "Pashto";

    document.getElementById("donorLanguageHint").textContent = useCustomSentence
      ? "Choose the language you wrote in"
      : "Provided prompts are in Pashto";
  }

  function validateFirstStep() {
    if (!donorName.reportValidity() || !donorLanguage.reportValidity()) return false;

    if (selectedSentenceSource() === "custom" && customSentence.value.trim().length < 3) {
      customSentence.setCustomValidity("Please enter a sentence before continuing.");
      customSentence.reportValidity();
      return false;
    }

    customSentence.setCustomValidity("");
    return true;
  }

  function updateReadingPrompt() {
    const sentence = getSelectedSentence();
    const language = donorLanguage.value;
    const isPashto = language === "Pashto";

    recordSentence.textContent = sentence.text;
    recordSentence.lang = isPashto ? "ps" : "";
    recordSentence.dir = isPashto ? "rtl" : "auto";
    recordLanguage.textContent = language;
  }

  function contributorInitials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "KA";
  }

  function updateReview() {
    const sentence = getSelectedSentence();
    const isPashto = donorLanguage.value === "Pashto";

    reviewName.textContent = donorName.value.trim();
    reviewLanguage.textContent = `${donorLanguage.value} contribution`;
    reviewAvatar.textContent = contributorInitials(donorName.value);
    reviewSentence.textContent = sentence.text;
    reviewSentence.lang = isPashto ? "ps" : "";
    reviewSentence.dir = isPashto ? "rtl" : "auto";
    reviewPlayback.src = donateRecorder.getUrl();
    reviewPlayback.load();
  }

  function showDonateStep(step) {
    flowScreens.forEach((screen) => {
      const isSelected = Number(screen.dataset.flowStep) === step;
      screen.hidden = !isSelected;
      screen.classList.toggle("active", isSelected);
    });

    stepIndicators.forEach((indicator) => {
      const indicatorStep = Number(indicator.dataset.stepIndicator);
      indicator.classList.toggle("active", indicatorStep === step);
      indicator.classList.toggle("complete", indicatorStep < step);

      if (indicatorStep === step) indicator.setAttribute("aria-current", "step");
      else indicator.removeAttribute("aria-current");
    });

    if (step === 2) updateReadingPrompt();
    if (step === 3) updateReview();
  }

  function setPending(button, isPending, pendingLabel) {
    if (isPending) {
      button.dataset.originalContent = button.innerHTML;
      button.textContent = pendingLabel;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      return;
    }

    button.innerHTML = button.dataset.originalContent;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }

  function showError(element, error) {
    element.textContent = error.message || "Something went wrong. Please try again.";
    element.hidden = false;
  }

  function resetDonationFlow() {
    donateForm.reset();
    donateRecorder.reset();
    sentenceIndex = 0;
    providedSentence.textContent = pashtoSentences[0].text;
    providedMeaning.textContent = pashtoSentences[0].meaning;
    sentenceCount.textContent = "0 characters";
    donationError.hidden = true;
    updateSentenceSource();
    donateSuccess.hidden = true;
    donateFlowContent.hidden = false;
    flowProgress.hidden = false;
    showDonateStep(1);
  }

  featureTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const selectedFeature = tab.dataset.feature;

      featureTabs.forEach((item) => {
        const isSelected = item === tab;
        item.classList.toggle("active", isSelected);
        item.setAttribute("aria-selected", String(isSelected));
        item.tabIndex = isSelected ? 0 : -1;
      });

      featurePanels.forEach((panel) => {
        const isSelected = panel.dataset.featurePanel === selectedFeature;
        panel.hidden = !isSelected;
        panel.classList.toggle("active", isSelected);
      });

      contributionPanel.setAttribute("aria-labelledby", tab.id);

      if (selectedFeature === "donate") openRecorder.stop();
      else donateRecorder.stop();
    });
  });

  sentenceSourceInputs.forEach((input) => {
    input.addEventListener("change", updateSentenceSource);
  });

  updateSentenceSource();

  document.getElementById("nextSentenceBtn").addEventListener("click", () => {
    sentenceIndex = (sentenceIndex + 1) % pashtoSentences.length;
    const sentence = pashtoSentences[sentenceIndex];
    providedSentence.textContent = sentence.text;
    providedMeaning.textContent = sentence.meaning;
  });

  customSentence.addEventListener("input", () => {
    sentenceCount.textContent = `${customSentence.value.length} characters`;
    customSentence.setCustomValidity("");
  });

  document.getElementById("toRecordBtn").addEventListener("click", () => {
    if (validateFirstStep()) showDonateStep(2);
  });

  document.querySelectorAll("[data-previous-step]").forEach((button) => {
    button.addEventListener("click", () => {
      showDonateStep(Number(button.dataset.previousStep));
    });
  });

  toReviewButton.addEventListener("click", () => {
    if (donateRecorder.hasRecording()) showDonateStep(3);
  });

  donateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    donationError.hidden = true;

    if (!donateRecorder.hasRecording()) {
      showDonateStep(2);
      return;
    }

    if (!donationConsent.reportValidity()) return;

    setPending(submitDonationButton, true, "Submitting…");

    try {
      const result = await submitVoiceDonation({
        contributorName: donorName.value.trim(),
        language: donorLanguage.value,
        sentence: getSelectedSentence().text,
        sentenceSource: selectedSentenceSource(),
        consent: donationConsent.checked,
        audioBlob: donateRecorder.getBlob(),
      });

      donateForm.dataset.submissionId = result.id;
      donateFlowContent.hidden = true;
      flowProgress.hidden = true;
      donateSuccess.hidden = false;
    } catch (error) {
      showError(donationError, error);
      setPending(submitDonationButton, false);
    }
  });

  document.getElementById("donateAgainBtn").addEventListener("click", resetDonationFlow);

  recordSoundForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    recordError.hidden = true;
    if (!openRecorder.hasRecording()) return;

    setPending(submitOpenRecordingButton, true, "Submitting…");

    try {
      const result = await submitOpenRecording({
        contributorName: document.getElementById("record-name").value.trim(),
        language: document.getElementById("record-language-select").value,
        topic: document.getElementById("record-topic").value.trim(),
        audioBlob: openRecorder.getBlob(),
      });

      recordSoundForm.dataset.submissionId = result.id;
      recordSuccess.classList.add("show");
      submitOpenRecordingButton.textContent = "Submitted";
      submitOpenRecordingButton.removeAttribute("aria-busy");
    } catch (error) {
      showError(recordError, error);
      setPending(submitOpenRecordingButton, false);
    }
  });

  recordSoundForm.addEventListener("reset", () => {
    if (submitOpenRecordingButton.dataset.originalContent) {
      submitOpenRecordingButton.innerHTML = submitOpenRecordingButton.dataset.originalContent;
      submitOpenRecordingButton.removeAttribute("aria-busy");
    }
    openRecorder.reset();
    recordSuccess.classList.remove("show");
    recordError.hidden = true;
  });

  window.addEventListener("beforeunload", () => {
    donateRecorder.reset();
    openRecorder.reset();
  });
}
