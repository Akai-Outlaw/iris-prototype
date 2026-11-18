/** PCM packets need not end on a sample boundary. Preserve the trailing byte. */
export class Pcm16Decoder {
  private trailing: number | undefined;
  reset() {
    this.trailing = undefined;
  }
  decode(bytes: readonly number[]): Float32Array<ArrayBuffer> {
    if (
      bytes.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 255,
      )
    )
      throw new Error("Invalid PCM packet");
    const data =
      this.trailing === undefined
        ? Uint8Array.from(bytes)
        : Uint8Array.from([this.trailing, ...bytes]);
    this.trailing = data.length % 2 ? data[data.length - 1] : undefined;
    const result = new Float32Array(Math.floor(data.length / 2)),
      view = new DataView(data.buffer);
    for (let i = 0; i < result.length; i++)
      result[i] = view.getInt16(i * 2, true) / 32768;
    return result;
  }
}
