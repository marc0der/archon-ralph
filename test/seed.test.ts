/**
 * `ralph-seed`'s archive, scaffold and `.gitignore` behaviour (spec §9).
 *
 * This is the one destructive node in the workflow: it moves the previous
 * cycle's plan and progress log out of the tree before anything else runs. The
 * cases below pin that the move happens first and loses nothing, that the fresh
 * pair really comes from the checked-in templates, and that `.gitignore` grows
 * by three lines once and never again — a second copy of an entry per run would
 * be the visible symptom of a node that stopped being idempotent.
 *
 * That destructiveness is exactly what `INPUTS_MODE=init` withholds (§12.4).
 * Every phase workflow opens with it, and composed into `ralph-wiggum` it runs
 * again on the plan the cycle is building against, so the last describe pins
 * the three things it must never do: archive, overwrite, or guess at a mode.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { archive, main } from "../template/scripts/ralph-seed.ts";
import { withTempRepo } from "./helpers.ts";

/** The real templates, at the path an installed `.archon/` puts them. */
const SOURCE_TEMPLATES = join(import.meta.dir, "../template/ralph/templates");
const TEMPLATE_DIR = ".archon/ralph/templates";

/**
 * `bin/cli.ts init`'s outcome, as far as this node cares. The tests copy the
 * repository's own templates rather than writing fixtures, so a template that
 * stops satisfying the plan prompt fails here.
 */
function installTemplates(): void {
  mkdirSync(TEMPLATE_DIR, { recursive: true });
  cpSync(SOURCE_TEMPLATES, TEMPLATE_DIR, { recursive: true });
}

/**
 * `main()` with stdout captured: its contract is that stdout is one JSON object.
 *
 * The default keeps every pre-mode test reading `process.env`, which
 * `withTempRepo` owns: it sets `ARTIFACTS_DIR` there per test, so a snapshot
 * taken once at definition time would point every test at the first fixture.
 */
function runMain(env: NodeJS.ProcessEnv = process.env): {
  code: number;
  out: string;
  err: string;
} {
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...args: unknown[]) => void out.push(args.join(" "));
  console.error = (...args: unknown[]) => void err.push(args.join(" "));
  try {
    return { code: main(env), out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** The single archive directory under `.ralph/`, or `undefined`. */
function archiveDir(): string | undefined {
  return existsSync(".ralph") ? readdirSync(".ralph")[0] : undefined;
}

describe("ralph-seed archive", () => {
  test("moves both artifacts into .ralph/<timestamp>/", async () => {
    await withTempRepo(() => {
      writeFileSync("IMPLEMENTATION_PLAN.md", "old plan\n");
      writeFileSync("PROGRESS.md", "old progress\n");

      const dest = archive();

      expect(dest).toMatch(/^\.ralph\/\d{8}-\d{6}$/);
      // A move, not a copy: leaving the old plan behind would make `scaffold`
      // overwrite the record the run was supposed to preserve.
      expect(existsSync("IMPLEMENTATION_PLAN.md")).toBe(false);
      expect(existsSync("PROGRESS.md")).toBe(false);
      expect(readFileSync(`${dest}/IMPLEMENTATION_PLAN.md`, "utf8")).toBe("old plan\n");
      expect(readFileSync(`${dest}/PROGRESS.md`, "utf8")).toBe("old progress\n");
    });
  });

  test("archives whichever artifact is present alone", async () => {
    await withTempRepo(() => {
      writeFileSync("PROGRESS.md", "orphan\n");

      const dest = archive();

      expect(readdirSync(dest as string)).toEqual(["PROGRESS.md"]);
    });
  });

  // Lazily: an empty `.ralph/<timestamp>/` would read as a cycle that shipped
  // nothing, and `ralph-report` lists the archive directory to the operator.
  test("creates no directory when there is nothing to archive", async () => {
    await withTempRepo(() => {
      expect(archive()).toBeNull();
      expect(existsSync(".ralph")).toBe(false);
    });
  });
});

describe("ralph-seed scaffold", () => {
  test("copies both artifacts from the template directory", async () => {
    await withTempRepo(() => {
      installTemplates();

      expect(runMain().code).toBe(0);

      for (const name of ["IMPLEMENTATION_PLAN.md", "PROGRESS.md"]) {
        expect(readFileSync(name, "utf8")).toBe(
          readFileSync(join(SOURCE_TEMPLATES, name), "utf8"),
        );
      }
    });
  });

  test("archives the old pair before scaffolding the new one", async () => {
    await withTempRepo(() => {
      installTemplates();
      writeFileSync("IMPLEMENTATION_PLAN.md", "old plan\n");

      expect(runMain().code).toBe(0);

      expect(readFileSync(`.ralph/${archiveDir()}/IMPLEMENTATION_PLAN.md`, "utf8")).toBe(
        "old plan\n",
      );
      expect(readFileSync("IMPLEMENTATION_PLAN.md", "utf8")).toContain("## Items");
    });
  });

  test("fails naming a missing template", async () => {
    await withTempRepo(() => {
      installTemplates();
      rmSync(join(TEMPLATE_DIR, "PROGRESS.md"));

      const { code, err, out } = runMain();

      expect(code).toBe(1);
      expect(err).toContain(`${TEMPLATE_DIR}/PROGRESS.md`);
      // Nothing on stdout: a downstream node parsing this would otherwise read
      // a success object out of a failed run.
      expect(out).toBe("");
    });
  });

  test("creates specs/ when absent and leaves an existing one alone", async () => {
    await withTempRepo(() => {
      installTemplates();

      expect(runMain().code).toBe(0);
      expect(statSync("specs").isDirectory()).toBe(true);

      writeFileSync("specs/keep.md", "spec\n");
      expect(runMain().code).toBe(0);
      expect(existsSync("specs/keep.md")).toBe(true);
    });
  });
});

describe("ralph-seed .gitignore", () => {
  const ENTRIES = ["IMPLEMENTATION_PLAN.md", "PROGRESS.md", ".ralph/"];

  /** Every entry, counted as a whole line — ralph's `grep -qxF`. */
  function counts(): number[] {
    const lines = readFileSync(".gitignore", "utf8").split("\n");
    return ENTRIES.map((entry) => lines.filter((line) => line === entry).length);
  }

  test("creates the file with the three entries", async () => {
    await withTempRepo(() => {
      installTemplates();

      expect(runMain().code).toBe(0);

      expect(counts()).toEqual([1, 1, 1]);
      expect(readFileSync(".gitignore", "utf8").endsWith("\n")).toBe(true);
    });
  });

  test("adds no entry twice across two runs", async () => {
    await withTempRepo(() => {
      installTemplates();

      expect(runMain().code).toBe(0);
      expect(runMain().code).toBe(0);

      expect(counts()).toEqual([1, 1, 1]);
    });
  });

  // The case a naive append gets wrong: `node_modules/IMPLEMENTATION_PLAN.md`
  // instead of two lines, which git then ignores nothing for.
  test("terminates an unterminated last line before appending", async () => {
    await withTempRepo(() => {
      installTemplates();
      writeFileSync(".gitignore", "node_modules/");

      expect(runMain().code).toBe(0);

      expect(readFileSync(".gitignore", "utf8")).toBe(
        "node_modules/\nIMPLEMENTATION_PLAN.md\nPROGRESS.md\n.ralph/\n",
      );
    });
  });

  test("keeps existing entries and adds only the missing ones", async () => {
    await withTempRepo(() => {
      installTemplates();
      writeFileSync(".gitignore", "*.log\n.ralph/\n");

      expect(runMain().code).toBe(0);

      expect(readFileSync(".gitignore", "utf8")).toBe(
        "*.log\n.ralph/\nIMPLEMENTATION_PLAN.md\nPROGRESS.md\n",
      );
    });
  });

  // git really has to ignore the artifacts, which is the point of the entries:
  // the loop commits from the checkout and must never commit its own plan.
  test("makes git ignore the artifacts it scaffolded", async () => {
    await withTempRepo(() => {
      installTemplates();

      expect(runMain().code).toBe(0);

      const untracked = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
        encoding: "utf8",
      });
      expect(untracked).not.toContain("IMPLEMENTATION_PLAN.md");
      expect(untracked).not.toContain("PROGRESS.md");
    });
  });
});

describe("ralph-seed output", () => {
  test("prints one JSON object with root, archived and branch", async () => {
    await withTempRepo(({ root }) => {
      installTemplates();
      writeFileSync("PROGRESS.md", "old\n");

      const { out } = runMain();

      expect(out.split("\n")).toHaveLength(1);
      expect(JSON.parse(out)).toEqual({
        root,
        archived: `.ralph/${archiveDir()}`,
        branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
      });
    });
  });

  test("reports nothing to archive as archived: null", async () => {
    await withTempRepo(() => {
      installTemplates();

      expect(JSON.parse(runMain().out).archived).toBeNull();
    });
  });
});

describe("ralph-seed init mode", () => {
  /**
   * The plan a phase workflow finds in the tree, in a shape `init` must not
   * touch. The item carries a `Spec:` citation (spec-anchored-review §7), so
   * the fixture satisfies the contract a real plan now carries.
   */
  const PLAN =
    "# Implementation Plan\n\n## Items\n\n- [ ] **Ship the thing**\n  Spec: `specs/mock.md` §1\n";

  // The whole reason `init` exists: `ralph-build` runs it on the plan it is
  // about to build, and an unconditional scaffold would replace that plan with
  // the empty template between the precondition and the build agent.
  test("leaves an existing IMPLEMENTATION_PLAN.md byte-identical", async () => {
    await withTempRepo(() => {
      installTemplates();
      writeFileSync("IMPLEMENTATION_PLAN.md", PLAN);

      expect(runMain({ ...process.env, INPUTS_MODE: "init" }).code).toBe(0);

      expect(readFileSync("IMPLEMENTATION_PLAN.md", "utf8")).toBe(PLAN);
    });
  });

  // Only-when-absent is per artifact, not per pair: `ralph-plan` on a fresh
  // checkout still needs both, and a half-seeded tree still needs the half.
  test("scaffolds a missing PROGRESS.md from the template", async () => {
    await withTempRepo(() => {
      installTemplates();
      writeFileSync("IMPLEMENTATION_PLAN.md", PLAN);

      expect(runMain({ ...process.env, INPUTS_MODE: "init" }).code).toBe(0);

      expect(readFileSync("PROGRESS.md", "utf8")).toBe(
        readFileSync(join(SOURCE_TEMPLATES, "PROGRESS.md"), "utf8"),
      );
      expect(readFileSync("IMPLEMENTATION_PLAN.md", "utf8")).toBe(PLAN);
    });
  });

  // Archiving is `seed`'s alone. A block that archived would file away the
  // plan the cycle is mid-way through, once per phase.
  test("creates no directory under .ralph/", async () => {
    await withTempRepo(() => {
      installTemplates();
      writeFileSync("IMPLEMENTATION_PLAN.md", PLAN);
      writeFileSync("PROGRESS.md", "old progress\n");

      const { code, out } = runMain({ ...process.env, INPUTS_MODE: "init" });

      expect(code).toBe(0);
      expect(existsSync(".ralph")).toBe(false);
      expect(JSON.parse(out).archived).toBeNull();
    });
  });

  // A typo in `with: {mode: …}` must not fall back to `archive`: that mode
  // moves the plan the block was about to build. The message names both modes
  // so the operator can correct the workflow file from it.
  test("fails an unrecognised INPUTS_MODE and names both modes", async () => {
    await withTempRepo(() => {
      installTemplates();
      writeFileSync("IMPLEMENTATION_PLAN.md", PLAN);

      const { code, err } = runMain({ ...process.env, INPUTS_MODE: "innit" });

      expect(code).toBe(1);
      expect(err).toContain("INPUTS_MODE must be archive, init");
      expect(err).toContain('got "innit"');
      expect(readFileSync("IMPLEMENTATION_PLAN.md", "utf8")).toBe(PLAN);
    });
  });
});
