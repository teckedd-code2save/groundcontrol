// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({
  exec: vi.fn(),
}));

vi.mock("@/lib/terminal-execution", () => ({
  requireTerminalAdmin: async () => ({ id: 1 }),
  resolveTerminalTarget: async () => ({
    id: 7,
    host: "pinned.example",
    port: 22,
    username: "ops",
    isLocal: false,
  }),
}));

vi.mock("@/lib/host-exec", () => ({
  execOnTargetStrict: mock.exec,
}));

vi.mock("@/lib/vps", () => ({
  getDockerContainers: async () => [],
  shQuote: (value: string) => `'${String(value).replace(/'/g, "'\\''")}'`,
}));

import { POST } from "./route";

function request(input: string, cwd: string) {
  return new NextRequest("http://localhost/api/terminal/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, cwd, history: [], vpsId: 7 }),
  });
}

beforeEach(() => {
  mock.exec.mockReset();
});

it("completes cd entries from the current remote cwd instead of the global project root", async () => {
  mock.exec.mockImplementation(async (command: string) => {
    expect(command).toContain("'/root'");
    return { stdout: "graphs/\nground-notes/\n", stderr: "", code: 0 };
  });

  const response = await POST(request("cd gr", "/root"));
  const data = await response.json();

  expect(data.suggestions.map((s: { value: string }) => s.value)).toEqual([
    "graphs/",
    "ground-notes/",
  ]);
});

it("lists the current directory when tab completion follows a bare cd plus space", async () => {
  mock.exec.mockImplementation(async (command: string) => {
    expect(command).toContain("'/opt'");
    return { stdout: "groundcontrol/\nrentaweekend/\n", stderr: "", code: 0 };
  });

  const response = await POST(request("cd ", "/opt"));
  const data = await response.json();

  expect(data.suggestions.map((s: { value: string }) => s.value)).toContain("groundcontrol/");
});

it("preserves nested relative paths for file completion", async () => {
  mock.exec.mockImplementation(async (command: string) => {
    expect(command).toContain("'/opt/groundcontrol/src/lib/'");
    return {
      stdout: "terminal-execution.ts\nterminal-state.ts\n",
      stderr: "",
      code: 0,
    };
  });

  const response = await POST(request("cat src/lib/term", "/opt/groundcontrol"));
  const data = await response.json();

  expect(data.suggestions.map((s: { value: string }) => s.value)).toEqual([
    "src/lib/terminal-execution.ts",
    "src/lib/terminal-state.ts",
  ]);
});
