import assert from "node:assert/strict";
import { test } from "node:test";

import { createAudioVisualizer } from "../../scripts/modules/audio-visualizer.js";

function fixture({ reducedMotion = false, withAudioContext = true } = {}) {
  const classes = new Set();
  const calls = [];
  const frames = new Map();
  const cancelled = [];
  let nextFrame = 1;
  const levels = [];
  const drawing = {
    beginPath: () => calls.push("begin"),
    clearRect: () => calls.push("clear"),
    lineTo: () => calls.push("line"),
    moveTo: () => calls.push("move"),
    setLineDash: () => {},
    stroke: () => calls.push("stroke"),
  };
  const canvas = {
    width: 720,
    height: 120,
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
    },
    getBoundingClientRect: () => ({ width: 720, height: 120 }),
    getContext: () => drawing,
  };
  const source = { connectCalls: 0, disconnectCalls: 0, connect() { this.connectCalls += 1; }, disconnect() { this.disconnectCalls += 1; } };
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    disconnectCalls: 0,
    disconnect() { this.disconnectCalls += 1; },
    getByteTimeDomainData(samples) {
      samples.fill(128);
      samples[Math.floor(samples.length / 2)] = 220;
    },
  };
  const contexts = [];
  class FakeAudioContext {
    constructor() {
      this.closeCalls = 0;
      contexts.push(this);
    }
    createAnalyser() { return analyser; }
    createMediaStreamSource() { return source; }
    close() { this.closeCalls += 1; }
    resume() {}
  }
  const visualizer = createAudioVisualizer({
    canvas,
    audioContextClass: withAudioContext ? FakeAudioContext : undefined,
    requestFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      cancelled.push(id);
      frames.delete(id);
    },
    reducedMotion,
    pixelRatio: 1,
    onLevel: (level) => levels.push(level),
  });
  return { analyser, calls, cancelled, classes, contexts, frames, levels, source, visualizer };
}

test("live waveform uses Web Audio samples and releases its graph", () => {
  const view = fixture();
  assert.equal(view.visualizer.start({ getTracks: () => [] }), true);
  assert.equal(view.visualizer.isActive(), true);
  assert.equal(view.classes.has("is-active"), true);
  assert.equal(view.source.connectCalls, 1);
  assert.equal(view.analyser.fftSize, 256);

  const firstFrame = [...view.frames.values()][0];
  firstFrame(16);
  assert.equal(view.calls.includes("stroke"), true);
  assert.equal(view.calls.includes("line"), true);
  assert.equal(view.levels.some((level) => level > 0), true);

  view.visualizer.stop();
  assert.equal(view.visualizer.isActive(), false);
  assert.equal(view.classes.has("is-active"), false);
  assert.equal(view.source.disconnectCalls, 1);
  assert.equal(view.contexts[0].closeCalls, 1);
  assert.equal(view.cancelled.length, 1);
  assert.equal(view.levels.at(-1), 0);
});

test("waveform degrades safely when Web Audio is unavailable", () => {
  const view = fixture({ withAudioContext: false });
  assert.equal(view.visualizer.start({ getTracks: () => [] }), false);
  assert.equal(view.visualizer.isActive(), false);
  assert.equal(view.classes.has("is-active"), false);
});

test("reduced motion throttles drawing while keeping audio response", () => {
  const view = fixture({ reducedMotion: true });
  view.visualizer.start({ getTracks: () => [] });
  const firstFrame = [...view.frames.values()][0];
  firstFrame(10);
  const strokesAfterFirstFrame = view.calls.filter((call) => call === "stroke").length;
  const secondFrame = [...view.frames.values()].at(-1);
  secondFrame(40);
  assert.equal(view.calls.filter((call) => call === "stroke").length, strokesAfterFirstFrame);
  const thirdFrame = [...view.frames.values()].at(-1);
  thirdFrame(120);
  assert.equal(view.calls.filter((call) => call === "stroke").length > strokesAfterFirstFrame, true);
});
