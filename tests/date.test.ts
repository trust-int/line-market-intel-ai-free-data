import { describe, expect, it } from "vitest";
import { manualNewsDateTaipei, manualNewsWindowTaipei } from "../src/utils/date.js";

describe("Taipei manual news window", () => {
  it("keeps pre-15:30 news in the previous manual day", () => {
    const window = manualNewsWindowTaipei(new Date("2026-05-24T07:29:59Z"));
    expect(manualNewsDateTaipei(new Date("2026-05-24T07:29:59Z"))).toBe("2026-05-23");
    expect(window).toEqual({
      date: "2026-05-23",
      start: "2026-05-23T15:30:00+08:00",
      end: "2026-05-24T15:30:00+08:00",
      cutoverTime: "15:30"
    });
  });

  it("opens a new manual day at 15:30 Taipei time", () => {
    const window = manualNewsWindowTaipei(new Date("2026-05-24T07:30:00Z"));
    expect(window).toEqual({
      date: "2026-05-24",
      start: "2026-05-24T15:30:00+08:00",
      end: "2026-05-25T15:30:00+08:00",
      cutoverTime: "15:30"
    });
  });
});
