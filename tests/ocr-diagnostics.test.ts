import { describe, expect, it } from "vitest";
import { runOcrDiagnostics } from "../src/line/ocr-diagnostics.js";

describe("OCR diagnostics", () => {
  it("returns which null when tesseract is missing", async () => {
    const diagnostics = await runOcrDiagnostics({
      execFile: (_file, _args, _options, callback) => {
        callback(Object.assign(new Error("not found"), { code: "ENOENT" }), "", "");
      }
    });

    expect(diagnostics.status).toBe("ok");
    expect(diagnostics.tesseract.which).toBeNull();
    expect(diagnostics.tesseract.version).toBeNull();
    expect(diagnostics.tesseract.list_langs).toEqual([]);
    expect(diagnostics.tesseract.has_eng).toBe(false);
    expect(diagnostics.tesseract.has_chi_tra).toBe(false);
    expect(diagnostics.tesseract.error).toContain("not found");
  });
});
