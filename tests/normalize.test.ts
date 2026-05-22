import { describe, expect, it } from "vitest";
import { extractTickers } from "../src/normalize/ticker.js";
import { classifyTopics } from "../src/normalize/topic.js";

describe("normalizers", () => {
  it("extracts Taiwan tickers", () => {
    expect(extractTickers("2330 台積電與 2317 鴻海，2330 再次提到")).toEqual(["2330", "2317"]);
  });

  it("classifies topics", () => {
    expect(classifyTopics("AI 伺服器與 CoWoS 需求強")).toContain("AI");
  });
});
