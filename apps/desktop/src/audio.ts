import type { AudioFeatures } from "@iris/contracts";
import { command, subscribe } from "./bridge";
import { Pcm16Decoder } from "./pcm";
export function analyze(
  data: Uint8Array,
  timestampMs: number,
  source: AudioFeatures["source"],
): AudioFeatures {
  const average = (start: number, end: number) => {
    const part = data.subarray(start, Math.max(start + 1, end));
    return part.reduce((sum, value) => sum + value, 0) / (part.length * 255);
  };
  return {
    source,
    level: Math.min(
      1,
      average(Math.floor(data.length * 0.1), Math.floor(data.length * 0.6)) *
        (source === "microphone" ? 2.4 : 1),
    ),
    bass: average(0, 6),
    treble: average(Math.floor(data.length * 0.65), data.length),
    timestampMs,
    available: true,
  };
}
export class Voice {
  private context?: AudioContext;
  private stream?: MediaStream;
  private worklet?: AudioWorkletNode;
  private micSource?: MediaStreamAudioSourceNode;
  private micAnalyzer?: AnalyserNode;
  private playbackAnalyzer?: AnalyserNode;
  private muted?: GainNode;
  private captureId = "";
  private turnId = "";
  private generation = 0;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private frame = 0;
  private speaking = false;
  private playingAt = Infinity;
  private disposed = false;
  private unlisten: (() => void)[] = [];
  private capturing = false;
  private pendingFrames = 0;
  private captureQueue: Promise<unknown> = Promise.resolve();
  private flushed?: () => void;
  private initializing?: Promise<void>;
  private pcm = new Pcm16Decoder();
  private receiving = false;
  private awaitingEndpoint = false;
  private captureTimer?: ReturnType<typeof setTimeout>;
  private limitTimer?: ReturnType<typeof setTimeout>;
  private endpoint() {
    if (!this.awaitingEndpoint) return;
    this.awaitingEndpoint = false;
    this.onEndpoint();
  }
  constructor(
    private features: (f: AudioFeatures) => void,
    private state: (
      state: "arming" | "listening" | "preparing-speech" | "speaking" | "idle",
    ) => void,
    private transcript: (text: string) => void,
    private error: (error: unknown) => void,
    private onEndpoint: () => void = () => {},
  ) {}
  async initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      const unlisten = await Promise.all([
        subscribe<{
          captureId: string;
          text: string;
          final: boolean;
          speechFinal: boolean;
        }>("iris:transcript", (event) => {
          if (event.captureId === this.captureId) {
            this.transcript(event.text);
            if (event.text.trim()) clearTimeout(this.captureTimer);
            if (event.speechFinal && event.text.trim()) this.endpoint();
          }
        }),
        subscribe<{ turnId: string; bytes: number[]; sampleRate: number }>(
          "iris:audio",
          (event) => {
            if (event.turnId === this.turnId) {
              try {
                this.enqueue(event.bytes, event.sampleRate);
              } catch (error) {
                this.stopSpeech();
                this.error(error);
              }
            }
          },
        ),
        subscribe<{ captureId: string }>("iris:capture-ended", (event) => {
          if (event.captureId === this.captureId) {
            this.stopMic();
            this.captureId = "";
            this.capturing = false;
            this.state("idle");
            this.error(
              new Error(
                "Speech transport closed. Review your transcript or try again.",
              ),
            );
          }
        }),
      ]);
      if (this.disposed) unlisten.forEach((off) => off());
      else this.unlisten.push(...unlisten);
    })();
    return this.initializing;
  }
  async activate() {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext();
      this.playbackAnalyzer = this.context.createAnalyser();
      this.playbackAnalyzer.fftSize = 512;
      this.playbackAnalyzer.smoothingTimeConstant = 0;
      this.playbackAnalyzer.connect(this.context.destination);
    }
    if (this.context.state !== "running") await this.context.resume();
    if (this.context.state !== "running")
      throw new Error("Enable audio playback and try again.");
    this.startAnalysis();
  }
  async startCapture() {
    if (this.capturing) return;
    this.capturing = true;
    this.awaitingEndpoint = true;
    const generation = ++this.generation;
    this.stopSpeech();
    this.state("arming");
    try {
      await this.initialize();
      await this.activate();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (this.disposed || generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.captureId = await command<string>("stt_start");
      if (this.disposed || generation !== this.generation) {
        await command("stt_cancel");
        this.stopMic();
        return;
      }
      this.micAnalyzer = this.context!.createAnalyser();
      this.micAnalyzer.fftSize = 512;
      this.micAnalyzer.smoothingTimeConstant = 0;
      this.micSource = this.context!.createMediaStreamSource(this.stream);
      this.micSource.connect(this.micAnalyzer);
      await this.context!.audioWorklet.addModule(
        new URL("./capture-worklet.js", import.meta.url),
      );
      if (this.disposed || generation !== this.generation) return;
      this.worklet = new AudioWorkletNode(this.context!, "iris-capture");
      this.muted = this.context!.createGain();
      this.muted.gain.value = 0;
      this.micSource.connect(this.worklet);
      this.worklet.connect(this.muted);
      this.muted.connect(this.context!.destination);
      let frames = false;
      this.worklet.port.onmessage = (event) => {
        if (event.data?.type === "flushed") {
          this.flushed?.();
          this.flushed = undefined;
          return;
        }
        if (
          generation !== this.generation ||
          !this.captureId ||
          !(event.data instanceof ArrayBuffer)
        )
          return;
        if (!frames) {
          frames = true;
          this.state("listening");
          if (this.awaitingEndpoint) {
            this.captureTimer = setTimeout(() => this.endpoint(), 10000);
            this.limitTimer = setTimeout(() => this.endpoint(), 30000);
          }
        }
        if (++this.pendingFrames > 16) {
          this.cancelCapture();
          this.error(new Error("Speech transport is congested. Try again."));
          return;
        }
        const id = this.captureId,
          bytes = Array.from(new Uint8Array(event.data));
        this.captureQueue = this.captureQueue
          .then(() => command("stt_write", { captureId: id, bytes }))
          .catch((error) => {
            if (generation === this.generation) {
              this.cancelCapture();
              this.error(error);
            }
          })
          .finally(() => {
            this.pendingFrames = Math.max(0, this.pendingFrames - 1);
          });
      };
    } catch (error) {
      if (generation === this.generation) this.cancelCapture();
      throw error;
    }
  }
  async finishCapture() {
    const id = this.captureId;
    if (!id) return "";
    if (this.worklet)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 250);
        this.flushed = () => {
          clearTimeout(timeout);
          resolve();
        };
        this.worklet!.port.postMessage("flush");
      });
    await this.captureQueue;
    this.captureId = "";
    this.capturing = false;
    this.stopMic();
    this.state("idle");
    return command<string>("stt_stop", { captureId: id });
  }
  cancelCapture() {
    this.generation++;
    this.captureId = "";
    this.capturing = false;
    this.flushed?.();
    this.flushed = undefined;
    this.stopMic();
    this.state("idle");
    void command("stt_cancel").catch(() => {});
  }
  private stopMic() {
    this.awaitingEndpoint = false;
    clearTimeout(this.captureTimer);
    clearTimeout(this.limitTimer);
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet.port.close();
    }
    this.worklet = undefined;
    this.micSource?.disconnect();
    this.micSource = undefined;
    this.micAnalyzer?.disconnect();
    this.micAnalyzer = undefined;
    this.muted?.disconnect();
    this.muted = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
  async speak(text: string, voiceId: string) {
    await this.initialize();
    await this.activate();
    if (this.capturing || this.disposed) return;
    this.stopSpeech();
    this.turnId = crypto.randomUUID();
    this.receiving = true;
    this.state("preparing-speech");
    const id = this.turnId;
    try {
      await command("tts_speak", { text, voiceId, turnId: id });
      if (this.turnId === id) {
        this.receiving = false;
        if (!this.sources.size) {
          this.turnId = "";
          this.state("idle");
        }
      }
    } catch (error) {
      if (this.turnId === id) {
        this.stopSpeech();
        throw error;
      }
    }
  }
  private enqueue(bytes: number[], sampleRate: number) {
    if (
      !this.context ||
      this.context.state !== "running" ||
      !this.turnId ||
      sampleRate !== 24000
    )
      return;
    if (this.nextTime - this.context.currentTime > 20) {
      this.stopSpeech();
      this.error(
        new Error("Voice queue reached its limit. Text remains available."),
      );
      return;
    }
    const samples = this.pcm.decode(bytes);
    if (!samples.length) return;
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playbackAnalyzer!);
    this.nextTime = Math.max(this.context.currentTime + 0.04, this.nextTime);
    this.playingAt = Math.min(this.playingAt, this.nextTime);
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      if (!this.sources.size) {
        this.speaking = false;
        this.playingAt = Infinity;
        if (this.receiving) this.state("preparing-speech");
        else {
          this.turnId = "";
          this.state("idle");
        }
      }
    };
  }
  stopSpeech() {
    const hadSpeech = !!this.turnId || this.speaking;
    this.turnId = "";
    this.pcm.reset();
    this.receiving = false;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
    this.playingAt = Infinity;
    this.speaking = false;
    if (hadSpeech) this.state("idle");
    void command("tts_cancel").catch(() => {});
  }
  private startAnalysis() {
    if (this.frame) return;
    const tick = () => {
      if (this.disposed) return;
      const context = this.context;
      if (
        context?.state === "running" &&
        this.sources.size &&
        context.currentTime >= this.playingAt &&
        !this.speaking
      ) {
        this.speaking = true;
        this.state("speaking");
      }
      const source =
        this.captureId && this.micAnalyzer
          ? "microphone"
          : this.speaking
            ? "playback"
            : undefined;
      const analyzer =
        source === "microphone" ? this.micAnalyzer : this.playbackAnalyzer;
      if (source && analyzer) {
        const bins = new Uint8Array(analyzer.frequencyBinCount);
        analyzer.getByteFrequencyData(bins);
        this.features(analyze(bins, performance.now(), source));
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  async dispose() {
    this.disposed = true;
    this.cancelCapture();
    this.stopSpeech();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.unlisten.forEach((fn) => fn());
    this.unlisten = [];
    this.playbackAnalyzer?.disconnect();
    await this.context?.close();
  }
}
