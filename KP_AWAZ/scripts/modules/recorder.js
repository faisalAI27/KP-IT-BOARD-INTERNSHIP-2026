export const RECORDING_MIME_TYPE_PREFERENCES = Object.freeze([
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
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
        "Open KP AWAZ at http://127.0.0.1:4173, or use HTTPS after deployment, to enable microphone access.",
    };
  }

  if (typeof mediaDevices?.getUserMedia !== "function") {
    return {
      supported: false,
      callout: "Microphone unavailable",
      message:
        "Open KP AWAZ directly in a current browser at http://127.0.0.1:4173. File and embedded previews may block microphone access.",
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
    return "This page is not allowed to use the microphone. Open it directly at http://127.0.0.1:4173.";
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
  idleStatus,
  maxDurationSeconds,
  maxDurationMessage,
  onStart,
  onCapture,
  onReset,
}) {
  const durationLimit = validateMaxDurationSeconds(maxDurationSeconds);
  const durationMessage =
    typeof maxDurationMessage === "string" && maxDurationMessage.trim()
      ? maxDurationMessage.trim()
      : `The ${durationLimit}-second recording limit was reached.`;
  const button = document.getElementById(buttonId);
  const timer = document.getElementById(timerId);
  const status = document.getElementById(statusId);
  const playback = document.getElementById(playbackId);
  const callout = document.getElementById(calloutId);

  let activeSession = null;
  let timerHandle = null;
  let secondsElapsed = 0;
  let recording = false;
  let starting = false;
  let playbackUrl = null;
  let audioBlob = null;
  let sessionId = 0;
  let destroyed = false;

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
    button.classList.remove("recording");
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
    revokePlaybackUrl();
    audioBlob = null;
    playback.removeAttribute("src");
    playback.hidden = true;
    playback.load();
  }

  function showRecordingFailure(session, error) {
    if (session.id !== sessionId || activeSession !== session) {
      releaseStream(session.stream);
      return;
    }

    console.error("MediaRecorder failed.", error);
    sessionId += 1;
    clearTimer();
    setIdleButton();
    session.chunks.length = 0;
    releaseStream(session.stream);
    activeSession = null;
    callout.textContent = "Recording failed";
    status.textContent = RECORDING_FAILURE_MESSAGE;
    onReset?.();
  }

  function finishRecording(session) {
    releaseStream(session.stream);
    if (session.id !== sessionId || activeSession !== session) return;

    clearTimer();
    setIdleButton();
    activeSession = null;

    if (session.chunks.length === 0) {
      callout.textContent = "Recording failed";
      status.textContent = RECORDING_FAILURE_MESSAGE;
      onReset?.();
      return;
    }

    const mimeType =
      session.recorder.mimeType || session.selectedMimeType || "audio/webm";
    audioBlob = new Blob(session.chunks, { type: mimeType });
    revokePlaybackUrl();
    playbackUrl = URL.createObjectURL(audioBlob);
    playback.src = playbackUrl;
    playback.hidden = false;

    if (session.stopReason === "automatic") {
      callout.textContent = "Recording stopped automatically";
      status.textContent = durationMessage;
    } else {
      callout.textContent = "Recording ready";
      status.textContent = "Listen back, or record again if needed.";
    }

    onCapture?.({ blob: audioBlob, url: playbackUrl });
  }

  function requestStop(reason = "manual") {
    const session = activeSession;
    if (!recording || !session || session.stopRequested) return;

    session.stopRequested = true;
    session.stopReason = reason;
    clearTimer();
    setIdleButton();

    if (reason === "automatic") {
      callout.textContent = "Recording stopped automatically";
      status.textContent = durationMessage;
    } else {
      callout.textContent = "Processing recording";
      status.textContent = "One moment while we prepare your audio…";
    }

    try {
      session.recorder.stop();
    } catch (error) {
      showRecordingFailure(session, error);
    }
  }

  function discardActiveSession() {
    const session = activeSession;
    sessionId += 1;
    starting = false;
    clearTimer();
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
    callout.textContent = "Start recording";
    status.textContent = idleStatus;
    onReset?.();
  }

  async function start() {
    if (destroyed || recording || starting || activeSession) return;
    const capability = getRecordingCapability();
    if (!capability.supported) {
      callout.textContent = capability.callout;
      status.textContent = capability.message;
      return;
    }

    starting = true;
    onStart?.();
    clearTimer();
    const currentSessionId = ++sessionId;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (currentSessionId !== sessionId || destroyed) return;
      starting = false;
      callout.textContent = "Microphone unavailable";
      status.textContent = microphoneFailureMessage(error);
      return;
    }

    if (currentSessionId !== sessionId || destroyed) {
      releaseStream(stream);
      return;
    }

    starting = false;

    const selectedMimeType = selectSupportedRecordingMimeType();
    let recorder;
    try {
      recorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType })
        : new MediaRecorder(stream);
    } catch (error) {
      releaseStream(stream);
      callout.textContent = "Recording failed";
      status.textContent = RECORDING_FAILURE_MESSAGE;
      console.error("Could not construct MediaRecorder.", error);
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
    recorder.addEventListener("error", (event) =>
      showRecordingFailure(session, event.error),
    );

    try {
      recorder.start();
    } catch (error) {
      showRecordingFailure(session, error);
      return;
    }

    recording = true;
    secondsElapsed = 0;
    renderTimer();
    button.classList.add("recording");
    button.setAttribute("aria-label", "Stop recording");
    callout.textContent = "Recording now";
    status.textContent = "Speak naturally, then tap to stop";

    timerHandle = window.setInterval(() => {
      if (session.id !== sessionId || activeSession !== session) {
        clearTimer();
        return;
      }

      secondsElapsed = Math.min(secondsElapsed + 1, durationLimit);
      renderTimer();
      if (secondsElapsed >= durationLimit) requestStop("automatic");
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
        callout.textContent = "Start recording";
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
    destroyed = true;
    button.removeEventListener("click", handleButtonClick);
  }

  function handleButtonClick() {
    if (recording || starting) stop();
    else start();
  }

  button.addEventListener("click", handleButtonClick);
  renderTimer();

  return {
    start,
    stop,
    reset,
    destroy,
    getBlob: () => audioBlob,
    getUrl: () => playbackUrl,
    hasRecording: () => Boolean(audioBlob),
    isRecording: () => recording || starting,
  };
}
