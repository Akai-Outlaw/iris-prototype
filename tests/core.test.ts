import { describe, it, expect } from "vitest";
import { deriveOrbState, EventCursor, EnvelopeSchema } from "@iris/contracts";
import { ease, constellation } from "../packages/galaxy-engine/src/math";
import { analyze } from "../apps/desktop/src/audio";
import { stateTargets } from "@iris/design-tokens";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageText } from "../apps/desktop/src/MessageText";
import { Pcm16Decoder } from "../apps/desktop/src/pcm";
describe("truthful state and synchronization", () => {
  const idle = {
    capture: "off" as const,
    generation: false,
    playback: false,
    foregroundTask: false,
    blockingError: false,
  };
  it("requires capture readiness and gives interruption capture precedence", () => {
    expect(deriveOrbState(idle)).toBe("idle");
    expect(deriveOrbState({ ...idle, playback: true })).toBe("speaking");
    expect(
      deriveOrbState({ ...idle, capture: "requested", playback: true }),
    ).toBe("arming");
    expect(deriveOrbState({ ...idle, capture: "ready" })).toBe("listening");
    expect(
      deriveOrbState({ ...idle, blockingError: true, playback: true }),
    ).toBe("error");
  });
  it("detects gaps, duplicates and session changes", () => {
    const c = new EventCursor();
    const e = EnvelopeSchema.parse({
      schemaVersion: 1,
      eventId: "e1",
      sessionId: "s",
      sequence: 1,
      occurredAt: new Date().toISOString(),
      runId: "r",
      event: { type: "turn.started" },
    });
    expect(c.accept(e)).toBe("accept");
    expect(c.accept(e)).toBe("duplicate");
    expect(c.accept({ ...e, sequence: 3 })).toBe("gap");
    expect(c.accept({ ...e, sessionId: "other", sequence: 2 })).toBe("gap");
  });
});
describe("render math", () => {
  it("eases equivalently at 30/60/120 Hz", () => {
    const values = [30, 60, 120].map((hz) => {
      let v = 0;
      for (let i = 0; i < hz; i++) v = ease(v, 1, 5, 1 / hz);
      return v;
    });
    expect(values[0]).toBeCloseTo(values[1], 10);
    expect(values[1]).toBeCloseTo(values[2], 10);
  });
  it("uses a reproducible bounded constellation", () => {
    const a = constellation();
    expect(a).toEqual(constellation());
    expect(a.points.length).toBe(96);
    expect(a.edges.length).toBeGreaterThan(0);
    expect(a.edges.every(([i, j]) => i < j && j < 96)).toBe(true);
  });
  it("keeps silence silent and measures bass/treble separately", () => {
    const silence = analyze(new Uint8Array(256), 0, "playback");
    expect(silence.level).toBe(0);
    expect(silence.bass).toBe(0);
    const bass = new Uint8Array(256);
    bass.fill(255, 0, 6);
    const low = analyze(bass, 1, "playback");
    expect(low.bass).toBe(1);
    expect(low.treble).toBe(0);
    const treble = new Uint8Array(256);
    treble.fill(255, 167);
    expect(analyze(treble, 2, "playback").treble).toBeGreaterThan(0.98);
  });
  it("defines finite targets for all six states", () => {
    expect(Object.keys(stateTargets)).toHaveLength(6);
    for (const target of Object.values(stateTargets)) {
      expect(Number.isFinite(target.speed)).toBe(true);
      expect(target.displacement).toBeGreaterThan(0);
      expect(target.glow).toBeLessThanOrEqual(1);
    }
  });
});
describe("public source links", () => {
  it("renders cited web sources as safe user-operated links", () => {
    const html = renderToStaticMarkup(
      createElement(MessageText, {
        text: "See [Python](https://docs.python.org/3/).",
        onError: () => {},
      }),
    );
    expect(html).toContain('href="https://docs.python.org/3/"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("never executes source HTML or creates javascript links", () => {
    const html = renderToStaticMarkup(
      createElement(MessageText, {
        text: "[bad](javascript:alert(1)) <script>alert(1)</script>",
        onError: () => {},
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;");
  });
});
describe("streamed PCM", () => {
  it("preserves a sample split across transport packets", () => {
    const decoder = new Pcm16Decoder();
    expect([...decoder.decode([0])]).toEqual([]);
    expect([...decoder.decode([128, 255, 127])]).toEqual([-1, 32767 / 32768]);
  });
  it("drops stale partial samples on interruption", () => {
    const decoder = new Pcm16Decoder();
    decoder.decode([255]);
    decoder.reset();
    expect([...decoder.decode([0, 0])]).toEqual([0]);
  });
});
