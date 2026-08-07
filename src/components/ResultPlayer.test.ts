import { describe, expect, it } from "vitest";
import { formatPlayerTime, parseClipRange } from "./ResultPlayer";

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

  it("rejects reversed and out-of-track ranges", () => {
    expect(parseClipRange("20", "10", 90)).toBeNull();
    expect(parseClipRange("0", "91", 90)).toBeNull();
  });
});
