/**
 * The two fingerprints (spec §9). `planStateHash` decides when the plan and
 * review loops have converged, and `repoState` decides whether a build
 * iteration did anything at all — so a fingerprint that misses a change ends a
 * run that was still making progress. Every case below is a change that must
 * register, or a non-change that must not.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planStateHash, repoState } from "../template/scripts/lib/ralph.ts";
import { withTempRepo } from "./helpers.ts";

// `withTempRepo` leaves no identity in its repository, and the developer's
// global config may turn on `commit.gpgsign`, so every fixture git call carries
// its own settings rather than inheriting whatever the host has.
function git(...args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=ralph",
      "-c",
      "user.email=ralph@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { stdio: "ignore" },
  );
}

function initRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  git("init", "--quiet", path);
}

function commit(repo: string): void {
  git("-C", repo, "commit", "--allow-empty", "--quiet", "-m", "fixture");
}

/** A directory outside the temp root, for the symlink case. */
function outsideRoot(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "archon-ralph-outside-")));
}

describe("planStateHash", () => {
  test("is stable across two calls with no change", async () => {
    await withTempRepo(() => {
      writeFileSync("IMPLEMENTATION_PLAN.md", "## Items\n- [ ] **Open**\n");
      mkdirSync("specs");
      writeFileSync("specs/one.md", "the decision record\n");

      expect(planStateHash()).toBe(planStateHash());
    });
  });

  test("changes when the plan changes", async () => {
    await withTempRepo(() => {
      writeFileSync("IMPLEMENTATION_PLAN.md", "## Items\n- [ ] **Open**\n");
      const before = planStateHash();

      writeFileSync("IMPLEMENTATION_PLAN.md", "## Items\n- [x] **Open**\n");

      expect(planStateHash()).not.toBe(before);
    });
  });

  test("changes when a spec changes", async () => {
    await withTempRepo(() => {
      mkdirSync("specs");
      writeFileSync("specs/one.md", "before\n");
      const before = planStateHash();

      writeFileSync("specs/one.md", "after\n");

      expect(planStateHash()).not.toBe(before);
    });
  });

  test("changes when a spec is added", async () => {
    await withTempRepo(() => {
      mkdirSync("specs");
      writeFileSync("specs/one.md", "one\n");
      const before = planStateHash();

      // Names are hashed as well as contents, so a spec whose contents match an
      // existing one still registers.
      writeFileSync("specs/two.md", "one\n");

      expect(planStateHash()).not.toBe(before);
    });
  });

  test("changes when a spec is removed", async () => {
    await withTempRepo(() => {
      mkdirSync("specs/nested", { recursive: true });
      writeFileSync("specs/one.md", "one\n");
      writeFileSync("specs/nested/two.md", "two\n");
      const before = planStateHash();

      rmSync("specs/nested", { recursive: true });

      expect(planStateHash()).not.toBe(before);
    });
  });

  test("changes when a symlinked spec's target changes", async () => {
    await withTempRepo(() => {
      const target = join(outsideRoot(), "shared.md");
      writeFileSync(target, "before\n");
      mkdirSync("specs");
      symlinkSync(target, "specs/shared.md");
      const before = planStateHash();

      // A meta repository shares specs by symlink, so the hash has to read
      // through the link rather than fingerprint the link itself.
      writeFileSync(target, "after\n");

      expect(planStateHash()).not.toBe(before);
    });
  });
});

describe("repoState", () => {
  test("lists the root repository with its HEAD", async () => {
    await withTempRepo(() => {
      commit(".");

      expect(repoState()).toMatch(/^\. [0-9a-f]{40}\n$/);
    });
  });

  test("records - for a repository with no commit", async () => {
    await withTempRepo(() => {
      initRepo("source/svc");

      // The sentinel keeps a commitless repository in the listing, so its first
      // commit reads as a change instead of appearing from nowhere.
      expect(repoState()).toBe(". -\n./source/svc -\n");
    });
  });

  test("lists a nested repository", async () => {
    await withTempRepo(() => {
      initRepo("source/svc");
      commit("source/svc");

      expect(repoState()).toMatch(/^\. -\n\.\/source\/svc [0-9a-f]{40}\n$/);
    });
  });

  test("follows a symlinked directory to a repository outside the root", async () => {
    await withTempRepo(() => {
      const outside = outsideRoot();
      initRepo(outside);
      commit(outside);
      symlinkSync(outside, "linked");

      expect(repoState()).toMatch(/\n\.\/linked [0-9a-f]{40}\n/);
    });
  });

  test("lists a .git at depth 6 and not one at depth 7", async () => {
    await withTempRepo(() => {
      mkdirSync("a/b/c/d/e/.git", { recursive: true });
      mkdirSync("deep/b/c/d/e/f/.git", { recursive: true });

      const state = repoState();

      expect(state).toContain("./a/b/c/d/e -\n");
      expect(state).not.toContain("./deep/b/c/d/e/f");
    });
  });

  test("is unchanged by a dirty worktree", async () => {
    await withTempRepo(() => {
      writeFileSync("tracked.txt", "before\n");
      git("add", "--", "tracked.txt");
      commit(".");
      const before = repoState();

      writeFileSync("tracked.txt", "after\n");
      writeFileSync("untracked.txt", "new\n");

      // An iteration that edits files and commits nothing is a noop. Counting a
      // stray edit would mean the noop exit never fires again.
      expect(repoState()).toBe(before);
    });
  });

  test("changes when a nested repository commits", async () => {
    await withTempRepo(() => {
      initRepo("source/svc");
      commit("source/svc");
      const before = repoState();

      // The workspace HEAD does not move here. This is the whole reason the
      // build verdict compares listings instead of one HEAD.
      commit("source/svc");

      expect(repoState()).not.toBe(before);
    });
  });

  test("changes when a nested repository appears", async () => {
    await withTempRepo(() => {
      const before = repoState();

      initRepo("source/svc");

      expect(repoState()).not.toBe(before);
      expect(repoState()).toContain("./source/svc -\n");
    });
  });

  test("changes when a nested repository vanishes", async () => {
    await withTempRepo(() => {
      initRepo("source/svc");
      const before = repoState();

      rmSync("source", { recursive: true });

      expect(repoState()).not.toBe(before);
      expect(repoState()).not.toContain("svc");
    });
  });
});
