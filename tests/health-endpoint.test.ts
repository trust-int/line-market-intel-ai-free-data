import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/index.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("health endpoints", () => {
  it("/health/live returns 200", async () => {
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/health/live`);
      const body = await response.json() as { status: string };
      expect(response.status).toBe(200);
      expect(body.status).toBe("live");
    } finally {
      close();
    }
  });

  it("/health/ready is not_ready when required env is missing", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.USER_HASH_SECRET;
    delete process.env.GPT_ACTION_BEARER_TOKEN;
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/health/ready`);
      const body = await response.json() as { status: string; db: string; line: string };
      expect(response.status).toBe(503);
      expect(body.status).toBe("not_ready");
      expect(body.db).toBe("missing_database_url");
      expect(body.line).toBe("missing_secrets");
    } finally {
      close();
    }
  });

  it("does not expose secrets", async () => {
    process.env.LINE_CHANNEL_SECRET = "super-secret-line-channel";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "super-secret-line-token";
    process.env.USER_HASH_SECRET = "super-secret-user-hash";
    process.env.GPT_ACTION_BEARER_TOKEN = "super-secret-gpt-token";
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/health`);
      const text = await response.text();
      expect(text).not.toContain("super-secret-line-channel");
      expect(text).not.toContain("super-secret-line-token");
      expect(text).not.toContain("super-secret-user-hash");
      expect(text).not.toContain("super-secret-gpt-token");
    } finally {
      close();
    }
  });
});

async function startApp(): Promise<{ base: string; close: () => void }> {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => server.close()
  };
}
