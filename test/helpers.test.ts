/**
 * The fixture is the one thing no other test can wrap in the fixture, so it is
 * tested directly. A leaked `process.chdir` or a leaked `ARTIFACTS_DIR` would
 * make every later test depend on the order `bun test` happens to pick, so the
 * throwing case matters more than the happy one.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { withTempRepo } from "./helpers.ts";

describe("withTempRepo", () => {
  test("chdirs into a fresh git repository and exposes artifactsDir", async () => {
    const outerCwd = process.cwd();

    const seen = await withTempRepo(({ root, artifactsDir }) => {
      expect(process.cwd()).toBe(root);
      expect(root).not.toBe(outerCwd);
      expect(statSync(join(root, ".git")).isDirectory()).toBe(true);
      expect(process.env.ARTIFACTS_DIR).toBe(artifactsDir);
      expect(statSync(artifactsDir).isDirectory()).toBe(true);
      return root;
    });

    expect(process.cwd()).toBe(outerCwd);
    expect(existsSync(seen)).toBe(true);
  });

  test("returns the body's value and awaits an async body", async () => {
    await expect(withTempRepo(async () => "value")).resolves.toBe("value");
  });

  test("mints a different directory per call", async () => {
    const first = await withTempRepo(({ root }) => root);
    const second = await withTempRepo(({ root }) => root);
    expect(first).not.toBe(second);
  });

  test("restores the working directory and ARTIFACTS_DIR when the body throws", async () => {
    const outerCwd = process.cwd();
    process.env.ARTIFACTS_DIR = "/sentinel";

    await expect(
      withTempRepo(() => {
        throw new Error("body failed");
      }),
    ).rejects.toThrow("body failed");

    expect(process.cwd()).toBe(outerCwd);
    expect(process.env.ARTIFACTS_DIR).toBe("/sentinel");
    delete process.env.ARTIFACTS_DIR;
  });

  test("unsets ARTIFACTS_DIR again when it was unset before the call", async () => {
    delete process.env.ARTIFACTS_DIR;
    await withTempRepo(() => {
      expect(process.env.ARTIFACTS_DIR).toBeString();
    });
    expect("ARTIFACTS_DIR" in process.env).toBe(false);
  });
});
