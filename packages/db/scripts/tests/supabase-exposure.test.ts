// Created by The Angelo Umali.
// The host-side guards behind the compose file: Windows port reservations.
import { describe, expect, it } from "vitest";
import { excludedPortRangeCommand, findReservedPorts, parseExcludedPortRanges } from "../supabase-exposure.ts";

// Shaped like `netsh interface ipv4 show excludedportrange protocol=tcp` on Windows 11, CRLF and all.
const NETSH_OUTPUT = [
  "",
  "Protocol tcp Port Exclusion Ranges",
  "",
  "Start Port    End Port      ",
  "----------    --------      ",
  "      5357        5357      ",
  "     45300       45321     *",
  "     55315       55414      ",
  "",
  "* - Administered port exclusions.",
  "",
].join("\r\n");

describe("parseExcludedPortRanges", () => {
  it("reads every start/end row, administered ones included, and ignores the headings", () => {
    expect(parseExcludedPortRanges(NETSH_OUTPUT)).toEqual([
      { start: 5357, end: 5357 },
      { start: 45300, end: 45321 },
      { start: 55315, end: 55414 },
    ]);
  });
});

describe("findReservedPorts", () => {
  it("returns the ports that fall inside a range, edges included", () => {
    const ranges = parseExcludedPortRanges(NETSH_OUTPUT);

    expect(findReservedPorts(ranges, [45320, 45321, 45322, 45323, 5357])).toEqual([45320, 45321, 5357]);
    expect(findReservedPorts([], [45322])).toEqual([]);
  });
});

describe("excludedPortRangeCommand", () => {
  it.each([
    ["win32", {}, "netsh"],
    ["linux", { WSL_DISTRO_NAME: "Ubuntu" }, "netsh.exe"],
    ["linux", {}, null],
    ["darwin", {}, null],
  ] as const)("on %s %o runs %s", (platform, env, expected) => {
    expect(excludedPortRangeCommand(platform, env)).toBe(expected);
  });
});
