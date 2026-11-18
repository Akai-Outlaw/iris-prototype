import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const bridge = vi.hoisted(() => ({
  listeners: new Map<string, (value: any) => void>(),
  speak: undefined as undefined | (() => void),
  turn: "",
}));
vi.mock("../apps/desktop/src/bridge", () => ({
  subscribe: vi.fn(async (name: string, callback: (value: any) => void) => {
    bridge.listeners.set(name, callback);
    return () => bridge.listeners.delete(name);
  }),
  command: vi.fn(async (name: string, args?: any) => {
    if (name === "stt_start") return "capture-test";
    if (name === "tts_speak") {
      bridge.turn = args.turnId;
      await new Promise<void>((resolve) => {
        bridge.speak = resolve;
      });
    }
  }),
}));
import { Voice } from "../apps/desktop/src/audio";
class FakeSource {
  buffer: any;
  onended: (() => void) | null = null;
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}
class FakeContext {
  state = "running";
  currentTime = 0;
  destination = {};
  sources: FakeSource[] = [];
  audioWorklet = { async addModule() {} };
  createMediaStreamSource() {
    return new FakeSource();
  }
  createGain() {
    return { gain: { value: 0 }, connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return {
      fftSize: 512,
      smoothingTimeConstant: 0,
      connect() {},
      disconnect() {},
      getByteFrequencyData(data: Uint8Array) {
        data.fill(0);
      },
    };
  }
  createBuffer(_: number, length: number, rate: number) {
    return { duration: length / rate, copyToChannel() {} };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  async resume() {}
  async close() {
    this.state = "closed";
  }
}
let context: FakeContext;
beforeEach(() => {
  context = new FakeContext();
  bridge.listeners.clear();
  bridge.turn = "";
  bridge.speak = undefined;
  vi.stubGlobal("AudioContext", function () {
    return context;
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("streamed speech lifecycle", () => {
  it("keeps a speech turn busy between chunks until the provider finishes", async () => {
    const states: string[] = [],
      voice = new Voice(
        () => {},
        (state) => states.push(state),
        () => {},
        (error) => {
          throw error;
        },
      );
    const speaking = voice.speak("hello", "test-voice");
    await vi.waitFor(() => expect(bridge.speak).toBeDefined());
    expect(states.at(-1)).toBe("preparing-speech");
    const emit = bridge.listeners.get("iris:audio")!;
    emit({ turnId: bridge.turn, bytes: [0, 0, 1, 0], sampleRate: 24000 });
    expect(context.sources).toHaveLength(1);
    context.sources[0].onended?.();
    expect(states.at(-1)).toBe("preparing-speech");
    emit({ turnId: bridge.turn, bytes: [0, 0], sampleRate: 24000 });
    bridge.speak!();
    await speaking;
    expect(states.at(-1)).toBe("preparing-speech");
    context.sources[1].onended?.();
    expect(states.at(-1)).toBe("idle");
    await voice.dispose();
  });
  it("rejects late chunks and clears odd trailing bytes after interruption", async () => {
    const voice = new Voice(
      () => {},
      () => {},
      () => {},
      (error) => {
        throw error;
      },
    );
    const pending = voice.speak("first", "test-voice");
    await vi.waitFor(() => expect(bridge.speak).toBeDefined());
    const old = bridge.turn,
      finish = bridge.speak!,
      emit = bridge.listeners.get("iris:audio")!;
    emit({ turnId: old, bytes: [255], sampleRate: 24000 });
    voice.stopSpeech();
    finish();
    await pending;
    emit({ turnId: old, bytes: [127, 0], sampleRate: 24000 });
    expect(context.sources).toHaveLength(0);
    await voice.dispose();
  });
});

class FakeWorklet {
  static current: FakeWorklet;
  port = {
    onmessage: null as null | ((event: any) => void),
    postMessage() {},
    close() {},
  };
  constructor() {
    FakeWorklet.current = this;
  }
  connect() {}
  disconnect() {}
}
function microphone() {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      async getUserMedia() {
        return { getTracks: () => [{ stop() {} }] };
      },
    },
  });
  vi.stubGlobal("AudioWorkletNode", FakeWorklet);
}
describe("automatic voice command endpointing", () => {
  it("submits once on speech_final for every voice capture", async () => {
    microphone();
    for (const captureNumber of [1, 2]) {
      context = new FakeContext();
      const endpoint = vi.fn(),
        voice = new Voice(
          () => {},
          () => {},
          () => {},
          () => {},
          endpoint,
        );
      await voice.startCapture();
      FakeWorklet.current.port.onmessage?.({ data: new ArrayBuffer(1280) });
      for (let i = 0; i < 2; i++)
        bridge.listeners.get("iris:transcript")!({
          captureId: "capture-test",
          text: "Hello Iris",
          final: true,
          speechFinal: true,
        });
      expect(endpoint, `capture ${captureNumber}`).toHaveBeenCalledTimes(1);
      await voice.dispose();
    }
  });
  it("stops after ten silent seconds and caps a continuous command at thirty", async () => {
    microphone();
    vi.useFakeTimers();
    for (const hasSpeech of [false, true]) {
      context = new FakeContext();
      const endpoint = vi.fn(),
        voice = new Voice(
          () => {},
          () => {},
          () => {},
          () => {},
          endpoint,
        );
      await voice.startCapture();
      FakeWorklet.current.port.onmessage?.({ data: new ArrayBuffer(1280) });
      if (hasSpeech)
        bridge.listeners.get("iris:transcript")!({
          captureId: "capture-test",
          text: "ongoing command",
          final: false,
          speechFinal: false,
        });
      await vi.advanceTimersByTimeAsync(10000);
      expect(endpoint).toHaveBeenCalledTimes(hasSpeech ? 0 : 1);
      await vi.advanceTimersByTimeAsync(20000);
      expect(endpoint).toHaveBeenCalledTimes(1);
      await voice.dispose();
    }
  });
});
