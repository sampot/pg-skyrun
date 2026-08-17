import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForPg } from "../pg.js";

describe("waitForPg", () => {
  afterEach(() => {
    delete globalThis.PG;
    vi.useRealTimers();
  });

  it("returns existing PG immediately", async () => {
    globalThis.PG = { version: "1" };
    await expect(waitForPg(100)).resolves.toBe(globalThis.PG);
  });

  it("resolves when PG appears after a tick", async () => {
    vi.useFakeTimers();
    const pending = waitForPg(1000);
    queueMicrotask(() => {
      globalThis.PG = { version: "late" };
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ version: "late" });
  });

  it("returns null after timeout when PG never appears", async () => {
    vi.useFakeTimers();
    const pending = waitForPg(50);
    await vi.advanceTimersByTimeAsync(80);
    await expect(pending).resolves.toBeNull();
  });
});
