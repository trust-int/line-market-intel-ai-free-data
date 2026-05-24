import { execFile as nodeExecFile } from "node:child_process";
import os from "node:os";
import { resolveOcrConfig, safeOcrErrorSummary } from "./ocr-service.js";

type ExecFileLike = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
  callback: (error: unknown, stdout: string | Buffer, stderr: string | Buffer) => void
) => unknown;

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
};

export type OcrDiagnostics = {
  status: "ok";
  env: {
    OCR_ENABLED: boolean;
    OCR_PROVIDER: "tesseract";
    OCR_LANG: string;
    OCR_MIN_TEXT_LENGTH: number;
    OCR_MAX_IMAGE_BYTES: number;
  };
  runtime: {
    platform: string;
    node_version: string;
    cwd: string;
    tmpdir: string;
  };
  tesseract: {
    which: string | null;
    version: string | null;
    list_langs: string[];
    has_eng: boolean;
    has_chi_tra: boolean;
    error: string | null;
  };
};

export async function runOcrDiagnostics(deps: { execFile?: ExecFileLike } = {}): Promise<OcrDiagnostics> {
  const execFile = deps.execFile ?? (nodeExecFile as ExecFileLike);
  const ocrConfig = resolveOcrConfig();
  const [whichResult, versionResult, langsResult] = await Promise.all([
    runCommand(execFile, "which", ["tesseract"]),
    runCommand(execFile, "tesseract", ["--version"]),
    runCommand(execFile, "tesseract", ["--list-langs"])
  ]);
  const listLangs = langsResult.ok ? parseTesseractLangs(langsResult.stdout) : [];
  const errors = [
    whichResult.ok ? undefined : `which: ${whichResult.error}`,
    versionResult.ok ? undefined : `version: ${versionResult.error}`,
    langsResult.ok ? undefined : `list-langs: ${langsResult.error}`
  ].filter((error): error is string => Boolean(error));

  return {
    status: "ok",
    env: {
      OCR_ENABLED: ocrConfig.enabled,
      OCR_PROVIDER: ocrConfig.provider,
      OCR_LANG: ocrConfig.lang,
      OCR_MIN_TEXT_LENGTH: ocrConfig.minTextLength,
      OCR_MAX_IMAGE_BYTES: ocrConfig.maxImageBytes
    },
    runtime: {
      platform: process.platform,
      node_version: process.version,
      cwd: process.cwd(),
      tmpdir: os.tmpdir()
    },
    tesseract: {
      which: whichResult.ok ? firstLine(whichResult.stdout) : null,
      version: versionResult.ok ? firstLine(versionResult.stdout) : null,
      list_langs: listLangs,
      has_eng: listLangs.includes("eng"),
      has_chi_tra: listLangs.includes("chi_tra"),
      error: errors.length ? errors.join("; ").slice(0, 300) : null
    }
  };
}

async function runCommand(execFile: ExecFileLike, file: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        const stdoutText = toText(stdout);
        const stderrText = toText(stderr);
        if (error) {
          resolve({
            ok: false,
            stdout: stdoutText,
            stderr: stderrText,
            error: safeOcrErrorSummary({ error, message: String(error), stdout: stdoutText, stderr: stderrText })
          });
          return;
        }
        resolve({ ok: true, stdout: stdoutText, stderr: stderrText, error: null });
      });
    } catch (error) {
      resolve({ ok: false, stdout: "", stderr: "", error: safeOcrErrorSummary(error) });
    }
  });
}

function parseTesseractLangs(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !/^list of available languages/i.test(line))
    .sort();
}

function firstLine(text: string): string | null {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function toText(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}
