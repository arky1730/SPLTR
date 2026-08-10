import { describe, expect, it } from "vitest";
import { adjustWaveformPeaks, clipRangeForPreset, fixedOutputDuration, formatPlayerTime, parseClipRange } from "./ResultPlayer";

describe("formatPlayerTime", () => {
  it("formats transport time without decimals", () => {
    expect(formatPlayerTime(0)).toBe("0:00");
    expect(formatPlayerTime(65.9)).toBe("1:05");
  });

  it("handles invalid metadata safely", () => {
    expect(formatPlayerTime(Number.NaN)).toBe("0:00");
    expect(formatPlayerTime(-1)).toBe("0:00");
  });
});

describe("parseClipRange", () => {
  it("accepts a valid range in seconds", () => {
    expect(parseClipRange("12.5", "42", 90)).toEqual({ start: 12.5, end: 42 });
  });

  it("keeps hundredth-second precision", () => {
    expect(parseClipRange("12.34", "15.67", 90)).toEqual({ start: 12.34, end: 15.67 });
  });

  it("rejects reversed and out-of-track ranges", () => {
    expect(parseClipRange("20", "10", 90)).toBeNull();
    expect(parseClipRange("0", "91", 90)).toBeNull();
  });
});

describe("adjustWaveformPeaks", () => {
  it("boosts quiet display peaks without changing or exceeding normalized bounds", () => {
    const source = [0.01, 0.25, 1];
    const adjusted = adjustWaveformPeaks(source, "auto");
    expect(adjusted[0]).toBeGreaterThan(source[0]);
    expect(adjusted[1]).toBeGreaterThan(source[1]);
    expect(adjusted[2]).toBe(1);
    expect(source).toEqual([0.01, 0.25, 1]);
  });

  it("supports fixed display gain with clipping", () => {
    expect(adjustWaveformPeaks([0.1, 0.4], 4)).toEqual([0.4, 1]);
  });
});

describe("clipRangeForPreset", () => {
  it("keeps the start anchor when the preset fits", () => {
    expect(clipRangeForPreset(5, 10, 30)).toEqual({ start: 5, end: 15 });
  });

  it("shifts left near the track end to preserve the preset length", () => {
    expect(clipRangeForPreset(25, 10, 30)).toEqual({ start: 20, end: 30 });
  });
});

describe("fixedOutputDuration", () => {
  it("keeps trimmed audio and visible silence inside one fixed frame", () => {
    expect(fixedOutputDuration({
      sourceStart: 10,
      sourceEnd: 24.4,
      silenceBefore: 0.1,
      silenceAfter: 0.5,
    })).toBeCloseTo(15, 6);
  });
});
