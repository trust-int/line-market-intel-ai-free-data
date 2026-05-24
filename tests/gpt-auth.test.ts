import { describe, expect, it, vi } from "vitest";
import { requireGptActionAuth } from "../src/api/auth.js";

describe("GPT Action auth", () => {
  it("requires bearer token", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const next = vi.fn();
    requireGptActionAuth(
      { header: () => "Bearer wrong" } as never,
      { status, json } as never,
      next
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts configured default bearer token", () => {
    const next = vi.fn();
    requireGptActionAuth(
      { header: () => "Bearer change-me-too" } as never,
      { status: vi.fn().mockReturnThis(), json: vi.fn() } as never,
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it("accepts lowercase bearer scheme", () => {
    const next = vi.fn();
    requireGptActionAuth(
      { header: () => "bearer change-me-too" } as never,
      { status: vi.fn().mockReturnThis(), json: vi.fn() } as never,
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it("accepts pasted bearer prefix in the key value", () => {
    const next = vi.fn();
    requireGptActionAuth(
      { header: () => "Bearer Bearer change-me-too" } as never,
      { status: vi.fn().mockReturnThis(), json: vi.fn() } as never,
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it("accepts x-api-key fallback", () => {
    const next = vi.fn();
    requireGptActionAuth(
      { header: (name: string) => name === "x-api-key" ? "change-me-too" : "" } as never,
      { status: vi.fn().mockReturnThis(), json: vi.fn() } as never,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
