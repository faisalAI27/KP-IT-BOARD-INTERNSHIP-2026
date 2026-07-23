import { createAudioVisualizer } from "./audio-visualizer.js?v=20260723-rabab-level";

export const RECORDING_MIME_TYPE_PREFERENCES = Object.freeze([
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
]);

const RECORDING_FAILURE_MESSAGE =
  "The browser could not complete the recording. Please try again.";

export function getRecordingCapability({
  isSecureContext = globalThis.isSecureContext,
  mediaDevices = globalThis.navigator?.mediaDevices,
  mediaRecorderClass = globalThis.MediaRecorder,
} = {}) {
  if (isSecureContext === false) {
    return {
      supported: false,
      callout: "Secure page required",
      message:
        "Open KP AWAZ from its official HTTPS address to enable microphone access.",
    };
  }

  if (typeof mediaDevices?.getUserMedia !== "function") {
    return {
      supported: false,
      callout: "Microphone unavailable",
      message:
        "Open KP AWAZ directly in a current browser. File and embedded previews may block microphone access.",
    };
  }

  if (typeof mediaRecorderClass !== "function") {
    return {
      supported: false,
      callout: "Recording unavailable",
      message:
        "This browser cannot create audio recordings. Try a current version of Chrome, Edge, Firefox, or Safari.",
    };
  }

  return { supported: true };
}

function microphoneFailureMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "Microphone permission was blocked. Allow it in your browser's site settings, then try again.";
  }
  if (error?.name === "NotFoundError") {
    return "No microphone was found. Connect or enable a microphone, then try again.";
  }
  if (error?.name === "NotReadableError") {
    return "The microphone is busy or unavailable. Close other recording apps, then try again.";
  }
  if (error?.name === "SecurityError") {
    return "This page is not allowed to use the microphone. Open KP AWAZ directly from its official address.";
  }
  return "Allow microphone access in your browser, then try again.";
}

export function selectSupportedRecordingMimeType(
  mediaRecorderClass = globalThis.MediaRecorder,
) {
  if (typeof mediaRecorderClass?.isTypeSupported !== "function") return "";

  return (
    RECORDING_MIME_TYPE_PREFERENCES.find((mimeType) =>
      mediaRecorderClass.isTypeSupported(mimeType),
    ) ?? ""
  );
}

export function validateMaxDurationSeconds(maxDurationSeconds) {
  if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds <= 0) {
    throw new TypeError("maxDurationSeconds must be a positive integer.");
  }
  return maxDurationSeconds;
}

export function stopRecorderIfActive(recorder) {
  if (recorder?.isRecording?.()) recorder.stop();
}

export function createRecorder({
  buttonId,
  timerId,
  statusId,
  playbackId,
  calloutId,
  visualizerCanvasId,
  idleStatus,
  idleCallout = "Start recording",
  recordingStatus = "Speak naturally, then press the Rabab again to stop.",
  previewOnReady = false,
  maxDurationSeconds,
  maxDurationMessage,
  canStart = () => true,
  onStart,
  onCapture,
  onLevel,
  onReset,
}) {
  const durationLimit =
    maxDurationSeconds === undefined || maxDurationSeconds === null
      ? null
      : validateMaxDurationSeconds(maxDurationSeconds);
  const durationMessage =
    typeof maxDurationMessage === "string" && maxDurationMessage.trim()
      ? maxDurationMessage.trim()
      : durationLimit === null
        ? ""
        : `The ${durationLimit}-second recording limit was reached.`;
  const button = document.getElementById(buttonId);
  const timer = document.getElementById(timerId);
  const status = document.getElementById(statusId);
  const playback = document.getElementById(playbackId);
  const callout = document.getElementById(calloutId);
  const visualizer = createAudioVisualizer({
    canvas: visualizerCanvasId,
    onLevel: (level) => {
      updateRababLevel(level);
      onLevel?.(level);
    },
  });

  let activeSession = null;
  let timerHandle = null;
  let secondsElapsed = 0;
  let recording = false;
  let starting = false;
  let playbackUrl = null;
  let audioBlob = null;
  let capturedDurationSeconds = 0;
  let sessionId = 0;
  let destroyed = false;

  function updateRababLevel(level) {
    const normalized = Math.max(0, Math.min(1, Number(level) || 0));
    button.style?.setProperty?.("--rabab-scale", (1 + normalized * 0.018).toFixed(4));
    button.style?.setProperty?.("--rabab-echo-opacity", (0.12 + normalized * 0.72).toFixed(3));
    button.style?.setProperty?.("--rabab-string-one", `${(-normalized * 2.8).toFixed(2)}px`);
    button.style?.setProperty?.("--rabab-string-two", `${(normalized * 1.7).toFixed(2)}px`);
    button.style?.setProperty?.("--rabab-string-three", `${(normalized * 3.1).toFixed(2)}px`);
  }

  function renderTimer() {
    const minutes = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
    const seconds = String(secondsElapsed % 60).padStart(2, "0");
    timer.textContent = `${minutes}:${seconds}`;
  }

  function clearTimer() {
    if (timerHandle === null) return;
    window.clearInterval(timerHandle);
    timerHandle = null;
  }

  function setIdleButton() {
    recording = false;
    ["recording", "requesting", "processing", "ready", "playing", "error"].forEach((state) => {
      button.classList.remove(state);
    });
    updateRababLevel(0);
    button.removeAttribute("aria-busy");
    button.setAttribute("aria-label", "Start recording");
  }

  function releaseStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    if (activeSession?.stream === stream) activeSession.stream = null;
  }

  function revokePlaybackUrl() {
    if (!playbackUrl) return;
    URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;
  }

  function clearPlayback() {
    playback.pause?.();
    revokePlaybackUrl();
    audioBlob = null;
    capturedDurationSeconds = 0;
    playback.removeAttribute("src");
    playback.hidden = true;
    playback.load();
  }

  function showRecordingFailure(session) {
    if (session.id !== sessionId || activeSession !== session) {
      releaseStream(session.stream);
      return;
    }

    sessionId += 1;
    clearTimer();
    visualizer.stop();
    setIdleButton();
    button.classList.add("error");
    session.chunks.length = 0;
    releaseStream(session.stream);
    activeSession = null;
    callout.textContent = "Recording failed";
    status.textContent = RECORDING_FAILURE_MESSAGE;
    onReset?.();
  }

  function finishRecording(session) {
    releaseStream(session.stream);
    visualizer.stop();
    if (session.id !== sessionId || activeSession !== session) return;

    clearTimer();
    setIdleButton();
    activeSession = null;

    if (session.chunks.length === 0) {
      callout.textContent = "Recording failed";
      status.textContent = RECORDING_FAILURE_MESSAGE;
      button.classList.add("error");
      onReset?.();
      return;
    }

    const chunks = session.chunks.splice(0);
    const mimeType =
      chunks.find((chunk) => typeof chunk?.type === "string" && chunk.type)?.type ||
      session.recorder.mimeType ||
      session.selectedMimeType ||
      "";
    audioBlob = new Blob(chunks, { type: mimeType });
    if (audioBlob.size <= 0) {
      audioBlob = null;
      callout.textContent = "Recording failed";
      status.textContent = "No usable recording was received. Please record again.";
      button.classList.add("error");
      onReset?.();
      return;
    }
    capturedDurationSeconds = secondsElapsed;
    revokePlaybackUrl();
    playbackUrl = URL.createObjectURL(audioBlob);
    playback.src = playbackUrl;
    playback.hidden = false;
    button.classList.add("ready");
    if (previewOnReady) button.setAttribute("aria-label", "Preview recording");

    if (session.stopReason === "automatic") {
      callout.textContent = "Recording stopped automatically";
      status.textContent = durationMessage;
    } else {
      callout.textContent = "Recording ready";
      status.textContent = "Listen back, or record again if needed.";
    }

    onCapture?.({
      blob: audioBlob,
      url: playbackUrl,
      durationSeconds: capturedDurationSeconds,
    });
  }

  function requestStop(reason = "manual") {
    const session = activeSession;
    if (!recording || !session || session.stopRequested) return;

    session.stopRequested = true;
    session.stopReason = reason;
    clearTimer();
    visualizer.stop();
    setIdleButton();
    button.classList.add("processing");
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-label", "Preparing your recording");

    if (reason === "automatic") {
      callout.textContent = "Recording stopped automatically";
      status.textContent = durationMessage;
    } else {
      callout.textContent = "Preparing your recording";
      status.textContent = "One moment while we prepare your audio…";
    }

    try {
      session.recorder.stop();
    } catch {
      showRecordingFailure(session);
    }
  }

  function discardActiveSession() {
    const session = activeSession;
    sessionId += 1;
    starting = false;
    clearTimer();
    visualizer.stop();
    setIdleButton();
    activeSession = null;

    if (!session) return;
    session.chunks.length = 0;
    if (!session.stopRequested && session.recorder.state !== "inactive") {
      session.stopRequested = true;
      try {
        session.recorder.stop();
      } catch {
        // Reset and destroy still release the stream below.
      }
    }
    releaseStream(session.stream);
  }

  function reset() {
    if (destroyed) return;
    discardActiveSession();
    clearPlayback();
    secondsElapsed = 0;
    renderTimer();
    callout.textContent = idleCallout;
    status.textContent = idleStatus;
    onReset?.();
  }

  async function start() {
    if (destroyed || recording || starting || activeSession) return;
    if (!canStart()) return;
    const capability = getRecordingCapability();
    if (!capability.supported) {
      callout.textContent = capability.callout;
      status.textContent = capability.message;
      button.classList.add("error");
      return;
    }

    starting = true;
    button.classList.remove("ready", "error");
    onStart?.();
    clearTimer();
    button.classList.add("requesting");
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-label", "Cancel microphone request");
    callout.textContent = "Requesting microphone access";
    status.textContent = "Allow microphone access in your browser to begin.";
    const currentSessionId = ++sessionId;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (currentSessionId !== sessionId || destroyed) return;
      starting = false;
      setIdleButton();
      button.classList.add("error");
      callout.textContent = "Microphone unavailable";
      status.textContent = microphoneFailureMessage(error);
      return;
    }

    if (currentSessionId !== sessionId || destroyed) {
      releaseStream(stream);
      return;
    }

    starting = false;
    button.classList.remove("requesting");
    button.removeAttribute("aria-busy");

    const selectedMimeType = selectSupportedRecordingMimeType();
    let recorder;
    try {
      recorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType })
        : new MediaRecorder(stream);
    } catch {
      releaseStream(stream);
      setIdleButton();
      button.classList.add("error");
      callout.textContent = "Recording failed";
      status.textContent = RECORDING_FAILURE_MESSAGE;
      return;
    }

    clearPlayback();
    onReset?.();
    const session = {
      id: currentSessionId,
      recorder,
      stream,
      chunks: [],
      selectedMimeType,
      stopReason: null,
      stopRequested: false,
    };
    activeSession = session;

    recorder.addEventListener("dataavailable", (event) => {
      if (session.id !== sessionId || activeSession !== session) return;
      if (event.data.size > 0) session.chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => finishRecording(session));
    recorder.addEventListener("error", () => showRecordingFailure(session));

    try {
      recorder.start();
    } catch {
      showRecordingFailure(session);
      return;
    }

    recording = true;
    visualizer.start(stream);
    secondsElapsed = 0;
    renderTimer();
    button.classList.add("recording");
    button.setAttribute("aria-label", "Stop recording");
    callout.textContent = "Recording now";
    status.textContent = recordingStatus;

    timerHandle = window.setInterval(() => {
      if (session.id !== sessionId || activeSession !== session) {
        clearTimer();
        return;
      }

      secondsElapsed = durationLimit === null
        ? secondsElapsed + 1
        : Math.min(secondsElapsed + 1, durationLimit);
      renderTimer();
      if (durationLimit !== null && secondsElapsed >= durationLimit) {
        requestStop("automatic");
      }
    }, 1000);
  }

  function stop() {
    if (starting && !activeSession) {
      sessionId += 1;
      starting = false;
      clearTimer();
      setIdleButton();
      if (audioBlob) {
        callout.textContent = "Recording ready";
        status.textContent = "Listen back, or record again if needed.";
      } else {
        callout.textContent = idleCallout;
        status.textContent = idleStatus;
      }
      return;
    }
    requestStop("manual");
  }

  function destroy() {
    if (destroyed) return;
    discardActiveSession();
    clearPlayback();
    visualizer.destroy();
    destroyed = true;
    button.removeEventListener("click", handleButtonClick);
    playback.removeEventListener("error", handlePlaybackError);
    playback.removeEventListener("play", handlePlaybackStart);
    playback.removeEventListener("pause", handlePlaybackStop);
    playback.removeEventListener("ended", handlePlaybackStop);
  }

  function handleButtonClick() {
    if (recording || starting) {
      stop();
      return;
    }
    if (previewOnReady && audioBlob) {
      if (playback.paused === false) {
        playback.pause?.();
        return;
      }
      const playResult = playback.play?.();
      playResult?.catch?.(() => {
        status.textContent =
          "This browser cannot play the original recording format directly.";
      });
      return;
    }
    start();
  }

  function handlePlaybackError() {
    if (!audioBlob) return;
    status.textContent =
      "This browser cannot play the original recording format directly.";
  }

  function handlePlaybackStart() {
    if (!audioBlob) return;
    button.classList.add("playing");
    if (previewOnReady) button.setAttribute("aria-label", "Pause playback");
    callout.textContent = "Playing recording";
    status.textContent = "Listening back to your recording.";
  }

  function handlePlaybackStop() {
    if (!audioBlob || recording || starting) return;
    button.classList.remove("playing");
    if (previewOnReady) button.setAttribute("aria-label", "Preview recording");
    callout.textContent = "Recording ready";
    status.textContent = "Listen back, or record again if needed.";
  }

  button.addEventListener("click", handleButtonClick);
  playback.addEventListener("error", handlePlaybackError);
  playback.addEventListener("play", handlePlaybackStart);
  playback.addEventListener("pause", handlePlaybackStop);
  playback.addEventListener("ended", handlePlaybackStop);
  renderTimer();

  return {
    start,
    stop,
    reset,
    destroy,
    getBlob: () => audioBlob,
    getDurationSeconds: () => capturedDurationSeconds,
    getUrl: () => playbackUrl,
    hasRecording: () => Boolean(audioBlob),
    isRecording: () => recording || starting,
  };
}
