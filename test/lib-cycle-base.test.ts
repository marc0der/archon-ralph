/**
 * The cycle base (spec §4.2): the `repoState()` listing review diffs the
 * cycle's changes against. A base rewritten by the second build would hide
 * the first build's commits from review, so the write-once rule is the case
 * that matters. `cycleChangedFiles` reads it to count what the cycle changed.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CYCLE_BASE,
  cycleChangedFiles,
  repoState,
  writeCycleBase,
} from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

/** Commit `names` in `repo`, one file each, which is what a build iteration leaves behind. */
function commit(repo: string, ...names: string[]): void {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  for (const name of names) writeFileSync(join(repo, name), `${name}\n`);
  git("add", "--", ...names);
  git("-c", "user.email=t@t", "-c", "user.name=T", "commit", "--quiet", "-m", names.join(" "));
}

/** A nested repository at `<root>/<path>`. */
function nestedRepo(root: string, path: string): string {
  const repo = join(root, path);
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: repo, stdio: "ignore" });
  return repo;
}

describe("writeCycleBase", () => {
  test("writes repoState() and creates .ralph/ when the base is absent", async () => {
    await withTempRepo(() => {
      expect(existsSync(".ralph")).toBe(false);

      expect(writeCycleBase()).toBe(true);

      expect(CYCLE_BASE).toBe(".ralph/cycle-base");
      expect(readFileSync(CYCLE_BASE, "utf8")).toBe(repoState());
      expect(repoState()).toBe(". -\n");
    });
  });

  test("a second call returns false and leaves the base byte for byte", async () => {
    await withTempRepo(() => {
      const handWritten = "./svc 0123456789abcdef0123456789abcdef01234567\n";
      expect(writeCycleBase()).toBe(true);
      writeFileSync(CYCLE_BASE, handWritten);

      expect(writeCycleBase()).toBe(false);

      expect(readFileSync(CYCLE_BASE, "utf8")).toBe(handWritten);
    });
  });
});

describe("cycleChangedFiles", () => {
  test("lists a file committed after the base", async () => {
    await withTempRepo(({ root }) => {
      commit(root, "before");
      writeCycleBase();
      commit(root, "after");

      expect(cycleChangedFiles()).toEqual(["after"]);
    });
  });

  test("lists nothing for an unchanged tree", async () => {
    await withTempRepo(({ root }) => {
      commit(root, "before");
      writeCycleBase();

      expect(cycleChangedFiles()).toEqual([]);
    });
  });

  test("lists every tracked file of a repository recorded as -", async () => {
    await withTempRepo(({ root }) => {
      writeCycleBase();
      expect(readFileSync(CYCLE_BASE, "utf8")).toBe(". -\n");
      commit(root, "one", "two");

      expect(cycleChangedFiles()).toEqual(["one", "two"]);
    });
  });

  test("lists every tracked file of a nested repository created after the base", async () => {
    await withTempRepo(({ root }) => {
      commit(root, "before");
      writeCycleBase();
      const svc = nestedRepo(root, "svc");
      commit(svc, "a", "b");

      expect(cycleChangedFiles()).toEqual(["svc/a", "svc/b"]);
    });
  });

  test("prefixes the paths of a nested repository with its path", async () => {
    await withTempRepo(({ root }) => {
      const svc = nestedRepo(root, "source/svc");
      commit(svc, "before");
      writeCycleBase();
      commit(svc, "after");

      expect(cycleChangedFiles()).toEqual(["source/svc/after"]);
    });
  });

  test("returns the paths in byte order without duplicates", async () => {
    await withTempRepo(({ root }) => {
      const svc = nestedRepo(root, "svc");
      commit(root, "before");
      commit(svc, "before");
      writeCycleBase();
      const base = readFileSync(CYCLE_BASE, "utf8");
      writeFileSync(CYCLE_BASE, base + base);
      commit(root, "z", "B", "a", "Z");
      commit(svc, "a");

      // The root's paths are collected first; byte order puts upper case before lower case and `B` before `svc/`.
      expect(cycleChangedFiles()).toEqual(["B", "Z", "a", "svc/a", "z"]);
    });
  });

  test("returns [] without a base", async () => {
    await withTempRepo(({ root }) => {
      commit(root, "one");

      expect(existsSync(CYCLE_BASE)).toBe(false);
      expect(cycleChangedFiles()).toEqual([]);
    });
  });

  test("a sha git cannot resolve contributes nothing", async () => {
    await withTempRepo(({ root }) => {
      commit(root, "one");
      mkdirSync(".ralph");
      writeFileSync(CYCLE_BASE, ". 0123456789abcdef0123456789abcdef01234567\n");

      expect(cycleChangedFiles()).toEqual([]);
    });
  });
});
