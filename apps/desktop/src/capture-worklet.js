class IrisCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.buffer = new Int16Array(1280);
    this.offset = 0;
    this.stopping = false;
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        this.stopping = true;
        if (this.offset) {
          const remainder = this.buffer.slice(0, this.offset);
          this.port.postMessage(remainder.buffer, [remainder.buffer]);
        }
        this.port.postMessage({ type: "flushed" });
      }
    };
  }
  process(inputs) {
    if (this.stopping) return false;
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const value of samples) {
      this.sum += value;
      this.count++;
      this.phase++;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.buffer[this.offset++] = Math.round(
          sample * (sample < 0 ? 32768 : 32767),
        );
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
          this.buffer = new Int16Array(1280);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("iris-capture", IrisCapture);
