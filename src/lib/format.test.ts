import { describe, expect, it } from "vitest";
import { fileName, formatDuration } from "./format";

describe("formatDuration", () => {
  it("formats seconds as minutes and seconds", () => expect(formatDuration(125)).toBe("2:05"));
  it("handles missing values", () => expect(formatDuration()).toBe("—"));
});

describe("fileName", () => {
  it("supports Windows paths", () => expect(fileName("C:\\Music\\track.wav")).toBe("track.wav"));
});
