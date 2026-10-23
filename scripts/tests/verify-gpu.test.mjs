// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { candidateHomes, engineCommand, engineEnv, hygieneRefusal, treeRefusal } from "../verify-gpu.mjs";

describe("verify:gpu hygiene (§10.3)", () => {
  const absent = () => false;

  it("refuses while the agent's config directory is visible", () => {
    const refusal = hygieneRefusal({}, ["/home/maintainer"], (path) => path === "/home/maintainer/.claude");
    expect(refusal).toMatch(/\.claude is visible/);
  });

  it("refuses an SSH key directory and gh auth", () => {
    expect(hygieneRefusal({}, ["/home/gpu"], (path) => path === "/home/gpu/.ssh")).toMatch(/\.ssh is visible/);
    expect(hygieneRefusal({}, ["/home/gpu"], (path) => path === "/home/gpu/.config/gh/hosts.yml")).toMatch(/hosts\.yml is visible/);
  });

  it("still refuses when HOME points at a scratch dir but the passwd home holds .claude", () => {
    const homes = candidateHomes({ HOME: "/tmp/scratch" }, "/tmp/scratch", "/home/maintainer");
    expect(homes).toEqual(["/tmp/scratch", "/home/maintainer"]);
    expect(hygieneRefusal({ HOME: "/tmp/scratch" }, homes, (path) => path === "/home/maintainer/.claude")).toMatch(/maintainer\/\.claude/);
  });

  it("checks USERPROFILE on Windows too", () => {
    expect(candidateHomes({ USERPROFILE: "C:\\Users\\maint" }, "D:\\scratch", "D:\\scratch")).toEqual(["D:\\scratch", "C:\\Users\\maint"]);
  });

  it("refuses while an SSH agent socket is exported", () => {
    expect(hygieneRefusal({ SSH_AUTH_SOCK: "/run/agent.sock" }, ["/home/gpu"], absent)).toMatch(/SSH_AUTH_SOCK/);
  });

  it.each(["GH_TOKEN", "GITHUB_TOKEN", "ANTHROPIC_API_KEY"])("refuses while %s is set", (name) => {
    expect(hygieneRefusal({ [name]: "x" }, ["/home/gpu"], absent)).toMatch(name);
  });

  it("runs under a clean user", () => {
    expect(hygieneRefusal({}, ["/home/gpu"], absent)).toBeNull();
  });
});

describe("checkout hygiene", () => {
  it("refuses a dirty tree", () => {
    expect(treeRefusal(" M packages/engine/zks_engine/cli.py\n", "origin/phase/3\n")).toMatch(/uncommitted/);
  });

  it("refuses a commit that is on no remote branch", () => {
    expect(treeRefusal("", "")).toMatch(/not on any remote branch/);
  });

  it("passes a clean, pushed commit", () => {
    expect(treeRefusal("", "  origin/phase/3\n")).toBeNull();
  });
});

describe("engine command", () => {
  it("runs the parity module through the engine's own project", () => {
    expect(engineCommand()).toEqual(["uv", ["run", "--project", "packages/engine", "python", "-m", "zks_engine.backends.parity"]]);
  });

  it("passes only an allowlisted environment, never tokens", () => {
    const env = engineEnv({ PATH: "/usr/bin", HOME: "/home/gpu", ZKS_HOME: "/z", ZKS_FFMPEG: "/f", NPM_TOKEN: "s", AWS_SECRET_ACCESS_KEY: "s" });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/gpu", ZKS_HOME: "/z", ZKS_FFMPEG: "/f" });
  });
});
