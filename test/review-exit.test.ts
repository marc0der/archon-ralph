/**
 * `ralph-review-exit`'s un-tick abort and its exit line (spec §4.4, §9).
 *
 * The un-tick tests assert `abort.txt`, which is the only thing that fails the
 * run: the node exits 0 either way, so a missing marker means the review
 * destroyed shipped work and the lifecycle reported success (§4.3).
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../template/scripts/ralph-review-exit.ts";
import { writeCounter, writeCycleBase } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

const CITATION = "  Spec: `specs/mock.md` §1";

/**
 * A plan whose `## Items` body holds `items`, each under its citation line.
 *
 * The `## Entry Format` exemplar is included, and cites `specs/file.md`, so a
 * script that counted the whole file would be off by one item and one spec.
 */
function writePlan(items: string[], citations: string[] = []): void {
  writeFileSync(
    "IMPLEMENTATION_PLAN.md",
    [
      "# Implementation Plan",
      "",
      "## Entry Format",
      "",
      "- [ ] **Short imperative title**",
      "  Spec: `specs/file.md` item N",
      "",
      "## Items",
      "",
      ...items.flatMap((item, i) => [item, citations[i] ?? CITATION]),
      "",
    ].join("\n"),
  );
}

/** Commit `names` in the current repository, one file each. */
function commit(...names: string[]): void {
  const git = (...args: string[]) => execFileSync("git", args, { stdio: "ignore" });
  for (const name of names) writeFileSync(name, `${name}\n`);
  git("add", "--", ...names);
  git("-c", "user.email=t@t", "-c", "user.name=T", "commit", "--quiet", "-m", names.join(" "));
}

/** `main()` with `env`, and stdout and stderr captured. */
function runMain(env: Record<string, string | undefined>): {
  code: number;
  stdout: string[];
  stderr: string[];
} {
  const { log, error } = console;
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (line: string) => stdout.push(line);
  console.error = (line: string) => stderr.push(line);
  try {
    return { code: main(env), stdout, stderr };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function outcome(artifactsDir: string): string[] {
  const file = join(artifactsDir, "outcome.log");
  return existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : [];
}

const UN_TICK =
  "review: reduced the shipped item count from 2 to 1; review may never un-tick an item. " +
  "Restore IMPLEMENTATION_PLAN.md before re-running.";

describe("ralph-review-exit", () => {
  test("aborts when the shipped count drops, and exits 0 for guard to fail", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writeCounter(join(artifactsDir, "shipped-before.txt"), 2);
      writePlan(["- [x] **One**", "- [ ] **Two**"]);

      const { code, stdout } = runMain({ ARTIFACTS_DIR: artifactsDir });

      expect(code).toBe(0);
      expect(readFileSync(join(artifactsDir, "abort.txt"), "utf8")).toBe(`${UN_TICK}\n`);
      expect(outcome(artifactsDir)).toEqual([UN_TICK]);
      expect(stdout).toEqual([]);
    });
  });

  test("does not read a missing baseline as a drop", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writePlan(["- [x] **One**"]);

      expect(runMain({ ARTIFACTS_DIR: artifactsDir }).code).toBe(0);

      expect(existsSync(join(artifactsDir, "abort.txt"))).toBe(false);
    });
  });

  test("throws on a missing plan and writes nothing", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writePlan(["- [x] **One**"]);
      unlinkSync("IMPLEMENTATION_PLAN.md");

      expect(() => main({ ARTIFACTS_DIR: artifactsDir })).toThrow();

      expect(existsSync(join(artifactsDir, "abort.txt"))).toBe(false);
      expect(outcome(artifactsDir)).toEqual([]);
    });
  });

  test("appends the exit line with the open, cited-spec and changed-file counts", async () => {
    await withTempRepo(({ artifactsDir }) => {
      commit("seed.txt");
      writeCycleBase();
      commit("a.ts", "b.ts", "c.ts");
      writeCounter(join(artifactsDir, "shipped-before.txt"), 1);
      writePlan(
        ["- [x] **Shipped**", "- [ ] **Finding one**", "- [ ] **Finding two**"],
        ["  Spec: `specs/alpha.md` §1", "  Spec: `specs/beta.md` §2", CITATION],
      );

      const { code, stdout } = runMain({ ARTIFACTS_DIR: artifactsDir });

      expect(code).toBe(0);
      const exitLine = "Review filed 2 findings. Reviewed 3 specs and 3 changed files.";
      expect(stdout).toEqual([exitLine]);
      expect(outcome(artifactsDir)).toEqual([`review: ${exitLine}`]);
      expect(existsSync(join(artifactsDir, "abort.txt"))).toBe(false);
    });
  });

  test("counts no changed files without a cycle base", async () => {
    await withTempRepo(({ artifactsDir }) => {
      commit("a.ts");
      writePlan(["- [x] **Shipped**"]);

      expect(runMain({ ARTIFACTS_DIR: artifactsDir }).stdout).toEqual([
        "Review filed 0 findings. Reviewed 1 specs and 0 changed files.",
      ]);
    });
  });

  test("reads ARTIFACTS_DIR from the environment", async () => {
    await withTempRepo(({ root }) => {
      writePlan(["- [x] **Shipped**"]);
      const envArtifactsDir = join(root, "env-artifacts");
      mkdirSync(envArtifactsDir);
      const previous = process.env.ARTIFACTS_DIR;
      process.env.ARTIFACTS_DIR = envArtifactsDir;
      try {
        const { log } = console;
        console.log = () => {};
        try {
          expect(main()).toBe(0);
        } finally {
          console.log = log;
        }
      } finally {
        if (previous === undefined) delete process.env.ARTIFACTS_DIR;
        else process.env.ARTIFACTS_DIR = previous;
      }

      expect(outcome(envArtifactsDir)).toHaveLength(1);
    });
  });

  test("exits 1 naming ARTIFACTS_DIR when it is unset or empty, and writes nothing", async () => {
    await withTempRepo(({ artifactsDir }) => {
      writePlan(["- [x] **Shipped**"]);

      for (const value of [undefined, ""]) {
        const { code, stderr } = runMain({ ARTIFACTS_DIR: value });
        expect(code).toBe(1);
        expect(stderr.join("\n")).toContain("ARTIFACTS_DIR");
      }
      expect(existsSync(join(artifactsDir, "outcome.log"))).toBe(false);
    });
  });
});
