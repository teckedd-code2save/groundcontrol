import { spawn } from "node:child_process";

/** Drain both streams without exec's 1 MiB maxBuffer killing a verbose build. */
export function captureCommand(
  command: string,
  options: { timeout?: number; cwd?: string; stdin?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const timer = options.timeout ? setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); }
        catch { child.kill("SIGKILL"); }
      }
    }, options.timeout) : undefined;
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const output = { stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
      if (code === 0 && !timedOut) return resolve(output);
      reject(Object.assign(new Error(timedOut ? "Command timed out" : `Command exited ${code ?? signal}`), {
        ...output, code: timedOut ? 124 : code || 1,
      }));
    });
    child.stdin.on("error", () => { /* An early command exit may close stdin. */ });
    child.stdin.end(options.stdin);
  });
}
