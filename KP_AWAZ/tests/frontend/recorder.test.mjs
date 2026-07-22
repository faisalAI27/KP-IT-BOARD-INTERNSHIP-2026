import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  RECORDING_MIME_TYPE_PREFERENCES,
  createRecorder,
  getRecordingCapability,
  selectSupportedRecordingMimeType,
  stopRecorderIfActive,
  validateMaxDurationSeconds,
} from "../../scripts/modules/recorder.js";


const originalGlobals = {
  document: Object.getOwnPropertyDescriptor(globalThis, "document"),
  mediaRecorder: Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder"),
  navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
  consoleError: console.error,
};


class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}


class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.hidden = true;
    this.listeners = new Map();
    this.loadCalls = 0;
    this.src = "";
    this.textContent = "";
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "src") this.src = "";
  }

  load() {
    this.loadCalls += 1;
  }
}


class FakeTrack {
  constructor() {
    this.stopCalls = 0;
  }

  stop() {
    this.stopCalls += 1;
  }
}


class FakeStream {
  constructor() {
    this.tracks = [new FakeTrack(), new FakeTrack()];
  }

  getTracks() {
    return this.tracks;
  }
}


class FakeMediaRecorder {
  static instances = [];
  static supportedTypes = new Set(["audio/webm;codecs=opus"]);

  static isTypeSupported(mimeType) {
    return this.supportedTypes.has(mimeType);
  }

  constructor(stream, options) {
    if (FakeMediaRecorder.throwOnConstruction) {
      throw new Error("construction failed");
    }
    this.listeners = new Map();
    this.mimeType = options?.mimeType ?? "audio/webm";
    this.options = options;
    this.startCalls = 0;
    this.state = "inactive";
    this.stopCalls = 0;
    this.stream = stream;
    FakeMediaRecorder.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  start() {
    this.startCalls += 1;
    this.state = "recording";
  }

  stop() {
    this.stopCalls += 1;
    this.state = "inactive";
  }
}


function restoreDescriptor(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}


afterEach(() => {
  restoreDescriptor("document", originalGlobals.document);
  restoreDescriptor("MediaRecorder", originalGlobals.mediaRecorder);
  restoreDescriptor("navigator", originalGlobals.navigator);
  restoreDescriptor("window", originalGlobals.window);
  URL.createObjectURL = originalGlobals.createObjectURL;
  URL.revokeObjectURL = originalGlobals.revokeObjectURL;
  console.error = originalGlobals.consoleError;
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supportedTypes = new Set(["audio/webm;codecs=opus"]);
  FakeMediaRecorder.throwOnConstruction = false;
});


function installEnvironment() {
  const elements = new Map();
  const intervals = new Map();
  const streams = [];
  const revokedUrls = [];
  const createdUrls = [];
  let nextIntervalId = 1;
  let microphoneRequests = 0;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          microphoneRequests += 1;
          const stream = new FakeStream();
          streams.push(stream);
          return stream;
        },
      },
    },
  });
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearInterval(id) {
        intervals.delete(id);
      },
      setInterval(callback) {
        const id = nextIntervalId;
        nextIntervalId += 1;
        intervals.set(id, callback);
        return id;
      },
    },
  });
  URL.createObjectURL = (blob) => {
    const url = `blob:fake-${createdUrls.length + 1}`;
    createdUrls.push({ blob, url });
    return url;
  };
  URL.revokeObjectURL = (url) => revokedUrls.push(url);

  return {
    createdUrls,
    elements,
    intervals,
    revokedUrls,
    streams,
    get microphoneRequests() {
      return microphoneRequests;
    },
    tick(times = 1) {
      for (let index = 0; index < times; index += 1) {
        for (const callback of [...intervals.values()]) callback();
      }
    },
  };
}


function createTestRecorder(environment, prefix = "test", overrides = {}) {
  const ids = {
    buttonId: `${prefix}-button`,
    timerId: `${prefix}-timer`,
    statusId: `${prefix}-status`,
    playbackId: `${prefix}-playback`,
    calloutId: `${prefix}-callout`,
  };
  const captures = [];
  let resets = 0;
  let starts = 0;
  const recorder = createRecorder({
    ...ids,
    idleStatus: "Ready to record",
    maxDurationSeconds: 3,
    maxDurationMessage: "Maximum duration reached.",
    onCapture: (capture) => captures.push(capture),
    onReset: () => {
      resets += 1;
    },
    onStart: () => {
      starts += 1;
    },
    ...overrides,
  });

  return {
    captures,
    ids,
    recorder,
    get resets() {
      return resets;
    },
    get starts() {
      return starts;
    },
    element(name) {
      return environment.elements.get(ids[name]);
    },
  };
}


function emitCompletedRecording(instance, content = "audio") {
  instance.emit("dataavailable", {
    data: new Blob([content], { type: instance.mimeType }),
  });
  instance.emit("stop");
}


test("guided and open duration configurations accept 60 and 300 seconds", () => {
  assert.equal(validateMaxDurationSeconds(60), 60);
  assert.equal(validateMaxDurationSeconds(300), 300);
});


test("invalid duration configurations are rejected", async (context) => {
  for (const [label, value] of [
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["nonnumeric", "60"],
  ]) {
    await context.test(label, () => {
      assert.throws(
        () => validateMaxDurationSeconds(value),
        /maxDurationSeconds must be a positive integer/,
      );
    });
  }
});


test("supported recording MIME selection follows the preference order", () => {
  FakeMediaRecorder.supportedTypes = new Set([
    "audio/ogg",
    "audio/webm",
    "audio/webm;codecs=opus",
  ]);

  assert.equal(
    selectSupportedRecordingMimeType(FakeMediaRecorder),
    "audio/webm;codecs=opus",
  );
  assert.deepEqual(RECORDING_MIME_TYPE_PREFERENCES, [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/ogg",
  ]);
});


test("OGG with Opus is selected when WebM is unsupported", () => {
  FakeMediaRecorder.supportedTypes = new Set(["audio/ogg;codecs=opus"]);

  assert.equal(
    selectSupportedRecordingMimeType(FakeMediaRecorder),
    "audio/ogg;codecs=opus",
  );
});


test("MP4 is selected when WebM and OGG Opus are unsupported", () => {
  FakeMediaRecorder.supportedTypes = new Set(["audio/mp4", "audio/ogg"]);

  assert.equal(selectSupportedRecordingMimeType(FakeMediaRecorder), "audio/mp4");
});


test("no reported preferred MIME allows the browser default", () => {
  FakeMediaRecorder.supportedTypes = new Set();

  assert.equal(selectSupportedRecordingMimeType(FakeMediaRecorder), "");
});


test("missing MIME support checker allows the browser default", () => {
  assert.equal(selectSupportedRecordingMimeType({}), "");
});


test("recording capability explains insecure and embedded previews", () => {
  const insecure = getRecordingCapability({
    isSecureContext: false,
    mediaDevices: { getUserMedia() {} },
    mediaRecorderClass: FakeMediaRecorder,
  });
  const embedded = getRecordingCapability({
    isSecureContext: true,
    mediaDevices: undefined,
    mediaRecorderClass: FakeMediaRecorder,
  });

  assert.equal(insecure.supported, false);
  assert.match(insecure.message, /official HTTPS address/);
  assert.doesNotMatch(insecure.message, /localhost|127\.0\.0\.1/);
  assert.equal(embedded.supported, false);
  assert.match(embedded.message, /File and embedded previews/);
});


test("recording capability distinguishes missing MediaRecorder support", () => {
  const capability = getRecordingCapability({
    isSecureContext: true,
    mediaDevices: { getUserMedia() {} },
    mediaRecorderClass: undefined,
  });

  assert.equal(capability.supported, false);
  assert.equal(capability.callout, "Recording unavailable");
  assert.match(capability.message, /current version/);
});


test("recorder construction omits MIME options when support checking is unavailable", async () => {
  const environment = installEnvironment();
  class DefaultMimeRecorder extends FakeMediaRecorder {}
  DefaultMimeRecorder.isTypeSupported = undefined;
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: DefaultMimeRecorder,
  });
  const fixture = createTestRecorder(environment, "default-mime");

  await fixture.recorder.start();

  assert.equal(FakeMediaRecorder.instances[0].options, undefined);
});


test("browser-default MediaRecorder submits its actual Blob MIME", async () => {
  const environment = installEnvironment();
  class DefaultMp4Recorder extends FakeMediaRecorder {
    constructor(stream, options) {
      super(stream, options);
      this.mimeType = "audio/mp4";
    }
  }
  DefaultMp4Recorder.supportedTypes = new Set();
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: DefaultMp4Recorder,
  });
  const fixture = createTestRecorder(environment, "default-mp4");

  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  fixture.recorder.stop();
  emitCompletedRecording(instance, "mp4-audio");

  assert.equal(instance.options, undefined);
  assert.equal(fixture.recorder.getBlob().type, "audio/mp4");
  assert.equal(fixture.captures[0].blob.type, "audio/mp4");
});


test("starting requests microphone, selects MIME, and updates button state", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);

  await fixture.recorder.start();
  await fixture.recorder.start();

  const instance = FakeMediaRecorder.instances[0];
  assert.equal(environment.microphoneRequests, 1);
  assert.equal(FakeMediaRecorder.instances.length, 1);
  assert.equal(instance.options.mimeType, "audio/webm;codecs=opus");
  assert.equal(instance.startCalls, 1);
  assert.equal(fixture.recorder.isRecording(), true);
  assert.equal(fixture.element("buttonId").classList.contains("recording"), true);
  assert.equal(
    fixture.element("buttonId").attributes.get("aria-label"),
    "Stop recording",
  );
  assert.equal(environment.intervals.size, 1);
  assert.equal(fixture.starts, 1);
});


test("recording access guard blocks microphone permission requests", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment, "guarded", {
    canStart: () => false,
  });

  fixture.element("buttonId").dispatch("click");
  await Promise.resolve();

  assert.equal(environment.microphoneRequests, 0);
  assert.equal(FakeMediaRecorder.instances.length, 0);
  assert.equal(fixture.recorder.isRecording(), false);
});


test("a pending microphone request can be cancelled without creating a recorder", async () => {
  const environment = installEnvironment();
  const pendingStream = new FakeStream();
  let resolveMicrophone;
  let requests = 0;
  navigator.mediaDevices.getUserMedia = () => {
    requests += 1;
    return new Promise((resolve) => {
      resolveMicrophone = resolve;
    });
  };
  const fixture = createTestRecorder(environment, "pending");

  const pendingStart = fixture.recorder.start();
  await fixture.recorder.start();
  assert.equal(fixture.recorder.isRecording(), true);
  assert.equal(requests, 1);

  fixture.recorder.stop();
  resolveMicrophone(pendingStream);
  await pendingStart;

  assert.equal(fixture.recorder.isRecording(), false);
  assert.equal(FakeMediaRecorder.instances.length, 0);
  assert.equal(pendingStream.tracks.every((track) => track.stopCalls === 1), true);
});


test("pending microphone permission has a clear cancellable state", async () => {
  const environment = installEnvironment();
  const pendingStream = new FakeStream();
  let resolveMicrophone;
  navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
    resolveMicrophone = resolve;
  });
  const fixture = createTestRecorder(environment, "permission-state");

  const pendingStart = fixture.recorder.start();
  assert.equal(fixture.element("calloutId").textContent, "Requesting microphone");
  assert.equal(fixture.element("buttonId").attributes.get("aria-busy"), "true");
  assert.equal(
    fixture.element("buttonId").attributes.get("aria-label"),
    "Cancel microphone request",
  );

  fixture.recorder.stop();
  resolveMicrophone(pendingStream);
  await pendingStart;
  assert.equal(fixture.element("buttonId").attributes.has("aria-busy"), false);
  assert.equal(pendingStream.tracks.every((track) => track.stopCalls === 1), true);
});


test("manual stop is idempotent, clears timer, and finalizes playback", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  const stream = environment.streams[0];

  fixture.recorder.stop();
  fixture.recorder.stop();

  assert.equal(instance.stopCalls, 1);
  assert.equal(environment.intervals.size, 0);
  assert.equal(fixture.recorder.isRecording(), false);
  assert.equal(stream.tracks.every((track) => track.stopCalls === 0), true);

  emitCompletedRecording(instance);

  assert.equal(fixture.recorder.hasRecording(), true);
  assert.equal(fixture.element("playbackId").hidden, false);
  assert.equal(fixture.captures.length, 1);
  assert.equal(stream.tracks.every((track) => track.stopCalls === 1), true);
});


test("an empty recording is rejected without creating playback", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment, "empty");
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];

  fixture.recorder.stop();
  instance.emit("dataavailable", {
    data: new Blob([], { type: instance.mimeType }),
  });
  instance.emit("stop");

  assert.equal(fixture.recorder.hasRecording(), false);
  assert.equal(fixture.captures.length, 0);
  assert.equal(environment.createdUrls.length, 0);
  assert.equal(fixture.element("playbackId").hidden, true);
});


test("captured duration is retained with the selected recording and cleared on reset", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment, "duration");
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  environment.tick(2);
  fixture.recorder.stop();
  emitCompletedRecording(instance, "duration-audio");

  assert.equal(fixture.recorder.getDurationSeconds(), 2);
  assert.equal(fixture.captures[0].durationSeconds, 2);

  fixture.recorder.reset();
  assert.equal(fixture.recorder.getDurationSeconds(), 0);
});


test("playback failure keeps the original Blob and shows a safe fallback", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment, "playback-error");
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  fixture.recorder.stop();
  emitCompletedRecording(instance, "original-audio");
  const originalBlob = fixture.recorder.getBlob();

  fixture.element("playbackId").dispatch("error");

  assert.equal(fixture.recorder.getBlob(), originalBlob);
  assert.equal(
    fixture.element("statusId").textContent,
    "This browser cannot play the original recording format directly.",
  );
});


test("playback events announce playing and ready states", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment, "playback-state");
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  fixture.recorder.stop();
  emitCompletedRecording(instance, "playable-audio");

  fixture.element("playbackId").dispatch("play");
  assert.equal(fixture.element("calloutId").textContent, "Playing recording");
  assert.match(fixture.element("statusId").textContent, /Listening back/);

  fixture.element("playbackId").dispatch("ended");
  assert.equal(fixture.element("calloutId").textContent, "Recording ready");
  assert.match(fixture.element("statusId").textContent, /record again/);
});


test("automatic stop happens once at the exact maximum and preserves audio", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment, "automatic", {
    maxDurationSeconds: 3,
    maxDurationMessage: "The test limit was reached.",
  });
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  const stream = environment.streams[0];

  environment.tick(5);

  assert.equal(instance.stopCalls, 1);
  assert.equal(environment.intervals.size, 0);
  assert.equal(fixture.element("timerId").textContent, "00:03");
  assert.equal(
    fixture.element("calloutId").textContent,
    "Recording stopped automatically",
  );
  assert.equal(fixture.element("statusId").textContent, "The test limit was reached.");
  assert.equal(stream.tracks.every((track) => track.stopCalls === 0), true);

  emitCompletedRecording(instance, "automatic-audio");

  assert.equal(fixture.recorder.hasRecording(), true);
  assert.equal(fixture.captures.length, 1);
  assert.equal(fixture.element("playbackId").hidden, false);
  assert.equal(stream.tracks.every((track) => track.stopCalls === 1), true);
});


test("the open limit displays exactly 05:00", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment, "open", {
    maxDurationSeconds: 300,
  });
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];

  environment.tick(300);

  assert.equal(instance.stopCalls, 1);
  assert.equal(fixture.element("timerId").textContent, "05:00");
});


test("reset stops an active session, clears timer, and releases tracks", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  const stream = environment.streams[0];

  fixture.recorder.reset();
  fixture.recorder.reset();

  assert.equal(instance.stopCalls, 1);
  assert.equal(environment.intervals.size, 0);
  assert.equal(fixture.recorder.isRecording(), false);
  assert.equal(fixture.recorder.hasRecording(), false);
  assert.equal(fixture.element("timerId").textContent, "00:00");
  assert.equal(fixture.element("playbackId").hidden, true);
  assert.equal(stream.tracks.every((track) => track.stopCalls === 1), true);
});


test("reset revokes completed playback and is repeatedly safe", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  fixture.recorder.stop();
  emitCompletedRecording(instance);
  const playbackUrl = fixture.recorder.getUrl();

  fixture.recorder.reset();
  fixture.recorder.reset();

  assert.deepEqual(environment.revokedUrls, [playbackUrl]);
  assert.equal(fixture.recorder.getBlob(), null);
  assert.equal(fixture.recorder.getUrl(), null);
  assert.equal(fixture.element("playbackId").src, "");
});


test("stale data and stop events after reset are ignored", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);
  await fixture.recorder.start();
  const staleInstance = FakeMediaRecorder.instances[0];

  fixture.recorder.reset();
  emitCompletedRecording(staleInstance, "stale-audio");

  assert.equal(fixture.recorder.hasRecording(), false);
  assert.equal(fixture.element("playbackId").hidden, true);
  assert.equal(environment.createdUrls.length, 0);
  assert.equal(fixture.captures.length, 0);
});


test("MediaRecorder error clears state and releases microphone", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  const stream = environment.streams[0];

  console.error = () => {};
  instance.emit("error", { error: new Error("raw browser failure") });
  instance.emit("dataavailable", {
    data: new Blob(["invalid"], { type: "audio/webm" }),
  });
  instance.emit("stop");

  assert.equal(environment.intervals.size, 0);
  assert.equal(fixture.recorder.isRecording(), false);
  assert.equal(fixture.recorder.hasRecording(), false);
  assert.equal(stream.tracks.every((track) => track.stopCalls === 1), true);
  assert.equal(fixture.element("calloutId").textContent, "Recording failed");
  assert.equal(
    fixture.element("statusId").textContent,
    "The browser could not complete the recording. Please try again.",
  );
});


test("MediaRecorder construction failure releases microphone", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);
  FakeMediaRecorder.throwOnConstruction = true;
  console.error = () => {};

  await fixture.recorder.start();

  assert.equal(
    environment.streams[0].tracks.every((track) => track.stopCalls === 1),
    true,
  );
  assert.equal(fixture.recorder.isRecording(), false);
  assert.equal(environment.intervals.size, 0);
  assert.equal(fixture.element("calloutId").textContent, "Recording failed");
});


test("microphone request failure shows a safe message", async () => {
  const environment = installEnvironment();
  navigator.mediaDevices.getUserMedia = async () => {
    throw new Error("permission details");
  };
  const fixture = createTestRecorder(environment);

  await fixture.recorder.start();

  assert.equal(FakeMediaRecorder.instances.length, 0);
  assert.equal(fixture.element("calloutId").textContent, "Microphone unavailable");
  assert.match(fixture.element("statusId").textContent, /Allow microphone access/);
});


test("destroy clears active resources and is repeatedly safe", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  const stream = environment.streams[0];

  fixture.recorder.destroy();
  fixture.recorder.destroy();
  fixture.element("buttonId").dispatch("click");

  assert.equal(instance.stopCalls, 1);
  assert.equal(environment.intervals.size, 0);
  assert.equal(stream.tracks.every((track) => track.stopCalls === 1), true);
  assert.equal(environment.microphoneRequests, 1);
});


test("destroy revokes a completed object URL", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  fixture.recorder.stop();
  emitCompletedRecording(instance);
  const playbackUrl = fixture.recorder.getUrl();

  fixture.recorder.destroy();

  assert.deepEqual(environment.revokedUrls, [playbackUrl]);
  assert.equal(fixture.recorder.getBlob(), null);
});


test("a new session replaces playback and never reuses old chunks", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);
  await fixture.recorder.start();
  const firstInstance = FakeMediaRecorder.instances[0];
  fixture.recorder.stop();
  emitCompletedRecording(firstInstance, "first-session");
  const firstUrl = fixture.recorder.getUrl();

  await fixture.recorder.start();
  const secondInstance = FakeMediaRecorder.instances[1];
  assert.deepEqual(environment.revokedUrls, [firstUrl]);
  firstInstance.emit("dataavailable", {
    data: new Blob(["stale-first-session"], { type: firstInstance.mimeType }),
  });
  secondInstance.emit("dataavailable", {
    data: new Blob(["second-session"], { type: secondInstance.mimeType }),
  });
  fixture.recorder.stop();
  secondInstance.emit("stop");

  assert.equal(await fixture.recorder.getBlob().text(), "second-session");
  assert.equal(environment.createdUrls.length, 2);
});


test("a failed upload does not alter a completed recording", async () => {
  const environment = installEnvironment();
  const fixture = createTestRecorder(environment);
  await fixture.recorder.start();
  const instance = FakeMediaRecorder.instances[0];
  fixture.recorder.stop();
  emitCompletedRecording(instance, "retry-audio");
  const originalBlob = fixture.recorder.getBlob();
  const originalUrl = fixture.recorder.getUrl();

  await assert.rejects(Promise.reject(new Error("upload failed")));

  assert.equal(fixture.recorder.getBlob(), originalBlob);
  assert.equal(fixture.recorder.getUrl(), originalUrl);
  assert.equal(fixture.element("playbackId").hidden, false);
});


test("starting either recorder stops the other active recorder", async () => {
  const environment = installEnvironment();
  let guided;
  let open;
  guided = createTestRecorder(environment, "guided", {
    onStart: () => stopRecorderIfActive(open.recorder),
  });
  open = createTestRecorder(environment, "open", {
    onStart: () => stopRecorderIfActive(guided.recorder),
  });

  await guided.recorder.start();
  const guidedInstance = FakeMediaRecorder.instances[0];
  await open.recorder.start();
  const openInstance = FakeMediaRecorder.instances[1];

  assert.equal(guidedInstance.stopCalls, 1);
  assert.equal(guided.recorder.isRecording(), false);
  assert.equal(open.recorder.isRecording(), true);
  emitCompletedRecording(guidedInstance, "guided-audio");
  assert.equal(guided.recorder.hasRecording(), true);

  guided.recorder.reset();
  await guided.recorder.start();
  assert.equal(openInstance.stopCalls, 1);
  assert.equal(open.recorder.isRecording(), false);
  emitCompletedRecording(openInstance, "open-audio");
  assert.equal(open.recorder.hasRecording(), true);
});


test("starting another recorder does not discard completed playback", async () => {
  const environment = installEnvironment();
  let guided;
  let open;
  guided = createTestRecorder(environment, "guided-complete", {
    onStart: () => stopRecorderIfActive(open.recorder),
  });
  open = createTestRecorder(environment, "open-new", {
    onStart: () => stopRecorderIfActive(guided.recorder),
  });
  await guided.recorder.start();
  const guidedInstance = FakeMediaRecorder.instances[0];
  guided.recorder.stop();
  emitCompletedRecording(guidedInstance, "completed-guided");
  const guidedBlob = guided.recorder.getBlob();
  const guidedUrl = guided.recorder.getUrl();

  await open.recorder.start();

  assert.equal(guided.recorder.getBlob(), guidedBlob);
  assert.equal(guided.recorder.getUrl(), guidedUrl);
  assert.equal(environment.revokedUrls.includes(guidedUrl), false);
});
