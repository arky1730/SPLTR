import { describe, expect, it } from "vitest";
import { formatPlayerTime } from "./ResultPlayer";

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
