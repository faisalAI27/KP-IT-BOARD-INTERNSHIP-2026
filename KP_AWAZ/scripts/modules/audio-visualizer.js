function resolveCanvas(canvasOrId, root) {
  if (typeof canvasOrId === "string") return root?.getElementById?.(canvasOrId) ?? null;
  return canvasOrId ?? null;
}

export function createAudioVisualizer({
  canvas: canvasOrId,
  root = globalThis.document,
  audioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
  pixelRatio = globalThis.devicePixelRatio ?? 1,
} = {}) {
  const canvas = resolveCanvas(canvasOrId, root);
  const drawing = canvas?.getContext?.("2d") ?? null;
  let audioContext = null;
  let source = null;
  let analyser = null;
  let frameHandle = null;
  let samples = null;
  let active = false;
  let lastDrawAt = 0;

  function resizeCanvas() {
    if (!canvas || !drawing) return;
    const bounds = canvas.getBoundingClientRect?.();
    if (!bounds?.width || !bounds?.height) return;
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  function clear() {
    if (!drawing || !canvas) return;
    drawing.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawIdle() {
    if (!drawing || !canvas) return;
    resizeCanvas();
    clear();
    const middle = canvas.height / 2;
    drawing.strokeStyle = "rgba(255, 255, 255, 0.34)";
    drawing.lineWidth = Math.max(1, pixelRatio);
    drawing.setLineDash?.([4 * pixelRatio, 8 * pixelRatio]);
    drawing.beginPath();
    drawing.moveTo(0, middle);
    drawing.lineTo(canvas.width, middle);
    drawing.stroke();
    drawing.setLineDash?.([]);
  }

  function drawWaveform() {
    if (!active || !analyser || !drawing || !canvas || !samples) return;
    analyser.getByteTimeDomainData(samples);
    resizeCanvas();
    clear();
    const height = canvas.height;
    const width = canvas.width;
    const slice = width / Math.max(1, samples.length - 1);
    drawing.lineWidth = Math.max(2, 2 * pixelRatio);
    drawing.strokeStyle = "#f4ca84";
    drawing.lineCap = "round";
    drawing.lineJoin = "round";
    drawing.beginPath();
    for (let index = 0; index < samples.length; index += 1) {
      const x = index * slice;
      const y = (samples[index] / 255) * height;
      if (index === 0) drawing.moveTo(x, y);
      else drawing.lineTo(x, y);
    }
    drawing.stroke();
  }

  function animate(timestamp = 0) {
    if (!active) return;
    if (!reducedMotion || timestamp - lastDrawAt >= 100) {
      drawWaveform();
      lastDrawAt = timestamp;
    }
    frameHandle = requestFrame?.(animate) ?? null;
  }

  function start(stream) {
    stop();
    if (!canvas || !drawing || typeof audioContextClass !== "function" || !requestFrame || !stream) {
      return false;
    }
    try {
      audioContext = new audioContextClass();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      samples = new Uint8Array(analyser.fftSize);
      active = true;
      lastDrawAt = -Infinity;
      canvas.classList?.add("is-active");
      const resumeResult = audioContext.resume?.();
      resumeResult?.catch?.(() => {});
      frameHandle = requestFrame(animate);
      return true;
    } catch {
      stop();
      return false;
    }
  }

  function stop() {
    active = false;
    if (frameHandle !== null) cancelFrame?.(frameHandle);
    frameHandle = null;
    try { source?.disconnect?.(); } catch { /* Already disconnected. */ }
    try { analyser?.disconnect?.(); } catch { /* Already disconnected. */ }
    try {
      const closeResult = audioContext?.close?.();
      closeResult?.catch?.(() => {});
    } catch { /* Context is already closed. */ }
    source = null;
    analyser = null;
    samples = null;
    audioContext = null;
    canvas?.classList?.remove("is-active");
    drawIdle();
  }

  drawIdle();
  return {
    start,
    stop,
    destroy: stop,
    isActive: () => active,
  };
}
