import { describe, it, expect } from "vitest";
import { classifyContainer, summarizeHealth, clampInterval, MIN_INTERVAL_SEC, MAX_INTERVAL_SEC } from "./health-checks";

describe("clampInterval", () => {
  it("clamps below the minimum to MIN_INTERVAL_SEC", () => {
    expect(clampInterval(5)).toBe(MIN_INTERVAL_SEC);
    expect(clampInterval(0)).toBe(MIN_INTERVAL_SEC);
    expect(clampInterval(-10)).toBe(MIN_INTERVAL_SEC);
  });

  it("clamps above the maximum to MAX_INTERVAL_SEC", () => {
    expect(clampInterval(99999)).toBe(MAX_INTERVAL_SEC);
  });

  it("passes through valid values within range", () => {
    expect(clampInterval(60)).toBe(60);
    expect(clampInterval(300)).toBe(300);
  });

  it("handles NaN / non-numeric input", () => {
    expect(clampInterval(Number.NaN)).toBe(MIN_INTERVAL_SEC);
    expect(clampInterval(Number("abc") as unknown as number)).toBe(MIN_INTERVAL_SEC);
  });
});

describe("classifyContainer", () => {
  it("classifies a running container as healthy", () => {
    const result = classifyContainer({ name: "web", state: "running", status: "Up 2 hours" });
    expect(result.status).toBe("healthy");
    expect(result.detail).toBe("");
  });

  it("classifies a running-but-unhealthy container", () => {
    const result = classifyContainer({ name: "db", state: "running", status: "Up 1 hour (unhealthy)" });
    expect(result.status).toBe("unhealthy");
    expect(result.detail).toContain("health checks");
  });

  it("classifies an exited container as down", () => {
    const result = classifyContainer({ name: "worker", state: "exited", status: "Exited (0) 5 minutes ago" });
    expect(result.status).toBe("down");
    expect(result.detail).toContain("exited");
  });

  it("classifies a dead container as down", () => {
    const result = classifyContainer({ name: "dead-app", state: "dead", status: "Dead" });
    expect(result.status).toBe("down");
  });

  it("classifies a stopped container as down", () => {
    const result = classifyContainer({ name: "app", state: "stopped", status: "Stopped" });
    expect(result.status).toBe("down");
  });

  it("classifies a restarting container as unhealthy", () => {
    const result = classifyContainer({ name: "api", state: "restarting", status: "Restarting (1)" });
    expect(result.status).toBe("unhealthy");
    expect(result.detail).toContain("restarting");
  });

  it("classifies a paused container as unhealthy", () => {
    const result = classifyContainer({ name: "paused-app", state: "paused", status: "Paused" });
    expect(result.status).toBe("unhealthy");
  });

  it("classifies a created-but-not-started container as down", () => {
    const result = classifyContainer({ name: "fresh", state: "created", status: "Created" });
    expect(result.status).toBe("down");
  });

  it("classifies an unknown state as unhealthy", () => {
    const result = classifyContainer({ name: "mystery", state: "weird", status: "???" });
    expect(result.status).toBe("unhealthy");
    expect(result.detail).toContain("weird");
  });

  it("handles missing state gracefully", () => {
    const result = classifyContainer({ name: "ghost" });
    expect(result.status).toBe("unhealthy");
    expect(result.name).toBe("ghost");
  });

  it("is case-insensitive for state and status", () => {
    const result = classifyContainer({ name: "web", state: "RUNNING", status: "UP 5 MINUTES (UNHEALTHY)" });
    expect(result.status).toBe("unhealthy");
  });
});

describe("summarizeHealth", () => {
  it("returns ok when all containers are healthy", () => {
    const results = [
      { name: "a", status: "healthy", detail: "" },
      { name: "b", status: "healthy", detail: "" },
    ] as const;
    const summary = summarizeHealth([...results]);
    expect(summary.total).toBe(2);
    expect(summary.healthy).toBe(2);
    expect(summary.unhealthy).toBe(0);
    expect(summary.down).toBe(0);
    expect(summary.overall).toBe("ok");
  });

  it("returns degraded when there are unhealthy containers", () => {
    const summary = summarizeHealth([
      { name: "a", status: "healthy", detail: "" },
      { name: "b", status: "unhealthy", detail: "bad" },
    ]);
    expect(summary.overall).toBe("degraded");
    expect(summary.unhealthy).toBe(1);
  });

  it("returns down when there are down containers (even if some unhealthy)", () => {
    const summary = summarizeHealth([
      { name: "a", status: "healthy", detail: "" },
      { name: "b", status: "unhealthy", detail: "bad" },
      { name: "c", status: "down", detail: "exited" },
    ]);
    expect(summary.overall).toBe("down");
    expect(summary.down).toBe(1);
    expect(summary.unhealthy).toBe(1);
  });

  it("returns ok for empty results", () => {
    const summary = summarizeHealth([]);
    expect(summary.total).toBe(0);
    expect(summary.overall).toBe("ok");
  });
});
