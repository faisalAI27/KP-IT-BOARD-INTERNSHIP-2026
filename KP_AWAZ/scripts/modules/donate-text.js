import { submitTextContribution } from "../services/text-contributions-api.js?v=20260723-donate-text";

const ACCEPTED_EXTENSIONS = new Set(["csv", "txt", "tsv", "json"]);
const MAX_FILES = 5;
const MAX_FILE_SIZE = 2 * 1024 * 1024;

let activeDonateTextCleanup = null;

export function validateDonateTextFile(file) {
  const name = typeof file?.name === "string" ? file.name.trim() : "";
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  if (!name || !ACCEPTED_EXTENSIONS.has(extension)) {
    return "Choose CSV, TXT, TSV, or JSON text files only.";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return `${name} is empty.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `${name} is larger than 2 MB.`;
  }
  return "";
}

export function destroyDonateText() {
  activeDonateTextCleanup?.();
}

export function initDonateText({
  profile = {},
  root = globalThis.document,
  windowObject = globalThis.window,
} = {}) {
  if (activeDonateTextCleanup) return true;
  const section = root?.getElementById?.("donate-text");
  if (!section) return false;

  const form = root.getElementById("donateTextForm");
  const contributorName = root.getElementById("donateTextContributorName");
  const typeSelect = root.getElementById("donateTextType");
  const sentence = root.getElementById("donateTextSentence");
  const sentenceCount = root.getElementById("donateTextCount");
  const sentenceError = root.getElementById("donateTextSentenceError");
  const fileInput = root.getElementById("donateTextFileInput");
  const dropzone = root.getElementById("donateTextDropzone");
  const fileError = root.getElementById("donateTextFileError");
  const fileList = root.getElementById("donateTextFileList");
  const clearButton = root.getElementById("donateTextClear");
  const submitButton = root.getElementById("donateTextSubmit");
  const submitError = root.getElementById("donateTextSubmitError");
  const toast = root.getElementById("donateTextToast");
  const choices = [...section.querySelectorAll("[data-donate-text-target]")];
  const manualPanel = root.getElementById("donateTextManualPanel");
  const filesPanel = root.getElementById("donateTextFilesPanel");
  const reducedMotion =
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  let selectedFiles = [];
  let toastTimer = null;
  let targetTimer = null;
  let destroyed = false;

  const profileName =
    typeof profile.displayName === "string" && profile.displayName.trim()
      ? profile.displayName.trim()
      : "Contributor";
  contributorName.value = profileName;

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    if (toastTimer !== null) windowObject.clearTimeout(toastTimer);
    toastTimer = windowObject.setTimeout(() => {
      toast.classList.remove("show");
      toastTimer = null;
    }, 3600);
  }

  function setFieldError(element, message) {
    element.textContent = message;
    element.hidden = !message;
  }

  function fileKey(file) {
    return `${file.name}:${file.size}:${file.lastModified ?? 0}`;
  }

  function renderFiles() {
    if (!selectedFiles.length) {
      const empty = root.createElement("p");
      empty.className = "donate-text-empty-files";
      empty.textContent = "No files selected yet.";
      fileList.replaceChildren(empty);
      return;
    }

    const fragment = root.createDocumentFragment();
    selectedFiles.forEach((file, index) => {
      const item = root.createElement("div");
      item.className = "donate-text-file-item";
      const meta = root.createElement("span");
      const name = root.createElement("strong");
      const size = root.createElement("small");
      const remove = root.createElement("button");
      name.textContent = file.name;
      size.textContent = `${formatFileSize(file.size)} · Ready for review`;
      meta.append(name, size);
      remove.type = "button";
      remove.className = "donate-text-file-remove";
      remove.dataset.fileIndex = String(index);
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.textContent = "×";
      item.append(meta, remove);
      fragment.append(item);
    });
    fileList.replaceChildren(fragment);
  }

  function addFiles(fileCollection) {
    setFieldError(fileError, "");
    const incoming = [...(fileCollection ?? [])];
    const errors = [];
    const known = new Set(selectedFiles.map(fileKey));

    for (const file of incoming) {
      const error = validateDonateTextFile(file);
      if (error) {
        errors.push(error);
        continue;
      }
      const key = fileKey(file);
      if (known.has(key)) continue;
      if (selectedFiles.length >= MAX_FILES) {
        errors.push("You can select up to five files at a time.");
        break;
      }
      selectedFiles.push(file);
      known.add(key);
    }

    if (errors.length) setFieldError(fileError, errors[0]);
    renderFiles();
    fileInput.value = "";
  }

  function clearForm({ announce = false } = {}) {
    form.reset();
    contributorName.value = profileName;
    sentenceCount.textContent = "0 / 500";
    selectedFiles = [];
    fileInput.value = "";
    setFieldError(sentenceError, "");
    setFieldError(fileError, "");
    setFieldError(submitError, "");
    renderFiles();
    if (announce) showToast("Text contribution fields cleared.");
  }

  function validateSubmission() {
    const text = sentence.value.trim();
    setFieldError(sentenceError, "");
    setFieldError(submitError, "");
    if (!text && !selectedFiles.length) {
      setFieldError(
        submitError,
        "Write one Pashto sentence or choose at least one text file.",
      );
      sentence.focus();
      return false;
    }
    if (text && text.length < 3) {
      setFieldError(sentenceError, "Write at least 3 characters.");
      sentence.focus();
      return false;
    }
    return true;
  }

  function focusTarget(targetName) {
    const panel = targetName === "files" ? filesPanel : manualPanel;
    const control = targetName === "files" ? dropzone : sentence;
    panel.classList.add("is-targeted");
    panel.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
    windowObject.setTimeout(() => control.focus({ preventScroll: true }), 280);
    if (targetTimer !== null) windowObject.clearTimeout(targetTimer);
    targetTimer = windowObject.setTimeout(() => {
      panel.classList.remove("is-targeted");
      targetTimer = null;
    }, 1200);
  }

  function handleSentenceInput() {
    sentenceCount.textContent = `${sentence.value.length} / 500`;
    setFieldError(sentenceError, "");
    setFieldError(submitError, "");
  }

  function handleFileListClick(event) {
    const remove = event.target.closest("[data-file-index]");
    if (!remove) return;
    const index = Number(remove.dataset.fileIndex);
    if (!Number.isInteger(index) || index < 0 || index >= selectedFiles.length) {
      return;
    }
    selectedFiles.splice(index, 1);
    renderFiles();
  }

  function handleDragOver(event) {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  }

  function handleDragLeave(event) {
    if (!dropzone.contains(event.relatedTarget)) {
      dropzone.classList.remove("is-dragging");
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
    addFiles(event.dataTransfer?.files);
  }

  function handleDropzoneClick() {
    fileInput.click();
  }

  function handleFileInputChange() {
    addFiles(fileInput.files);
  }

  function handleClear() {
    clearForm({ announce: true });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validateSubmission()) return;

    submitButton.disabled = true;
    clearButton.disabled = true;
    submitButton.textContent = "Submitting…";
    try {
      const result = await submitTextContribution({
        contributorName: contributorName.value,
        textType: typeSelect.value,
        text: sentence.value,
        files: selectedFiles,
      });
      if (destroyed) return;
      clearForm();
      showToast(
        `${result.itemCount} text contribution${result.itemCount === 1 ? "" : "s"} submitted for review.`,
      );
    } catch (error) {
      if (destroyed) return;
      setFieldError(
        submitError,
        error instanceof Error
          ? error.message
          : "The text contribution could not be submitted.",
      );
      submitError.focus();
    } finally {
      if (destroyed) return;
      submitButton.disabled = false;
      clearButton.disabled = false;
      submitButton.textContent = "Submit text";
    }
  }

  const choiceHandlers = choices.map((choice) => {
    const handler = () => focusTarget(choice.dataset.donateTextTarget);
    choice.addEventListener("click", handler);
    return [choice, handler];
  });
  sentence.addEventListener("input", handleSentenceInput);
  dropzone.addEventListener("click", handleDropzoneClick);
  dropzone.addEventListener("dragover", handleDragOver);
  dropzone.addEventListener("dragleave", handleDragLeave);
  dropzone.addEventListener("drop", handleDrop);
  fileInput.addEventListener("change", handleFileInputChange);
  fileList.addEventListener("click", handleFileListClick);
  clearButton.addEventListener("click", handleClear);
  form.addEventListener("submit", handleSubmit);
  renderFiles();

  if (windowObject.location?.hash === "#donate-text") {
    windowObject.requestAnimationFrame(() => {
      section.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  }

  activeDonateTextCleanup = () => {
    if (destroyed) return;
    destroyed = true;
    choiceHandlers.forEach(([choice, handler]) =>
      choice.removeEventListener("click", handler),
    );
    sentence.removeEventListener("input", handleSentenceInput);
    dropzone.removeEventListener("click", handleDropzoneClick);
    dropzone.removeEventListener("dragover", handleDragOver);
    dropzone.removeEventListener("dragleave", handleDragLeave);
    dropzone.removeEventListener("drop", handleDrop);
    fileInput.removeEventListener("change", handleFileInputChange);
    fileList.removeEventListener("click", handleFileListClick);
    clearButton.removeEventListener("click", handleClear);
    form.removeEventListener("submit", handleSubmit);
    if (toastTimer !== null) windowObject.clearTimeout(toastTimer);
    if (targetTimer !== null) windowObject.clearTimeout(targetTimer);
    activeDonateTextCleanup = null;
  };
  return true;
}
