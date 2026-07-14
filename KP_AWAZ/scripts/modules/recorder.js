export function createRecorder({
  buttonId,
  timerId,
  statusId,
  playbackId,
  calloutId,
  idleStatus,
  onCapture,
  onReset,
}) {
  const button = document.getElementById(buttonId);
  const timer = document.getElementById(timerId);
  const status = document.getElementById(statusId);
  const playback = document.getElementById(playbackId);
  const callout = document.getElementById(calloutId);

  let mediaRecorder = null;
  let micStream = null;
  let recordedChunks = [];
  let timerHandle = null;
  let secondsElapsed = 0;
  let recording = false;
  let playbackUrl = null;
  let audioBlob = null;
  let discardRecording = false;

  function renderTimer() {
    const minutes = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
    const seconds = String(secondsElapsed % 60).padStart(2, "0");
    timer.textContent = `${minutes}:${seconds}`;
  }

  function releaseMicrophone() {
    if (!micStream) return;
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  function stop(shouldDiscard = false) {
    if (!recording || !mediaRecorder) return;

    discardRecording = shouldDiscard;
    mediaRecorder.stop();
    clearInterval(timerHandle);
    timerHandle = null;
    recording = false;
    button.classList.remove("recording");
    button.setAttribute("aria-label", "Start recording");

    if (!shouldDiscard) {
      callout.textContent = "Processing recording";
      status.textContent = "One moment while we prepare your audio…";
    }
  }

  function reset() {
    stop(true);
    releaseMicrophone();
    recordedChunks = [];
    audioBlob = null;
    secondsElapsed = 0;
    renderTimer();
    callout.textContent = "Start recording";
    status.textContent = idleStatus;

    if (playbackUrl) URL.revokeObjectURL(playbackUrl);

    playbackUrl = null;
    playback.removeAttribute("src");
    playback.hidden = true;
    playback.load();
    onReset?.();
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      callout.textContent = "Recording unavailable";
      status.textContent = "Audio recording is not supported in this browser.";
      return;
    }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      callout.textContent = "Microphone unavailable";
      status.textContent = "Allow microphone access in your browser, then try again.";
      return;
    }

    if (playbackUrl) URL.revokeObjectURL(playbackUrl);

    playbackUrl = null;
    audioBlob = null;
    onReset?.();
    playback.hidden = true;
    recordedChunks = [];
    discardRecording = false;
    mediaRecorder = new MediaRecorder(micStream);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", () => {
      if (!discardRecording && recordedChunks.length > 0) {
        const mimeType = mediaRecorder.mimeType || "audio/webm";
        audioBlob = new Blob(recordedChunks, { type: mimeType });
        playbackUrl = URL.createObjectURL(audioBlob);
        playback.src = playbackUrl;
        playback.hidden = false;
        callout.textContent = "Recording ready";
        status.textContent = "Listen back, or record again if needed.";
        onCapture?.({ blob: audioBlob, url: playbackUrl });
      }

      releaseMicrophone();
    });

    mediaRecorder.start();
    recording = true;
    secondsElapsed = 0;
    renderTimer();
    button.classList.add("recording");
    button.setAttribute("aria-label", "Stop recording");
    callout.textContent = "Recording now";
    status.textContent = "Read the sentence, then tap to stop";

    timerHandle = window.setInterval(() => {
      secondsElapsed += 1;
      renderTimer();
    }, 1000);
  }

  button.addEventListener("click", () => {
    if (recording) stop();
    else start();
  });

  return {
    getBlob: () => audioBlob,
    getUrl: () => playbackUrl,
    hasRecording: () => Boolean(audioBlob),
    isRecording: () => recording,
    reset,
    stop,
  };
}

