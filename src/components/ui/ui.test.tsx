import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, Notice, StatusBadge, Surface } from "@/components/ui";
import { cn } from "@/lib/ui";

describe("interface primitives", () => {
  it("composes class names without leaking false values", () => {
    expect(cn("one", false, undefined, "two")).toBe("one two");
  });

  it("renders explicit action hierarchy and native disabled behavior", () => {
    const html = renderToStaticMarkup(<Button variant="danger" disabled>Delete</Button>);
    expect(html).toContain("gc-button--danger");
    expect(html).toContain("disabled");
    expect(html).toContain("Delete");
  });

  it("maps operational tones to notices and compact status", () => {
    const notice = renderToStaticMarkup(<Notice tone="danger">Verification failed.</Notice>);
    const badge = renderToStaticMarkup(<StatusBadge tone="success">Verified</StatusBadge>);
    expect(notice).toContain('role="alert"');
    expect(notice).toContain("gc-notice--danger");
    expect(badge).toContain("gc-badge--success");
  });

  it("keeps surface hierarchy semantic", () => {
    const html = renderToStaticMarkup(<Surface raised>Operational state</Surface>);
    expect(html).toContain("<section");
    expect(html).toContain("gc-panel--raised");
  });
});

