import { describe, expect, it } from "vitest";
import { parseDomainInput, renderCaddySiteBlock } from "./domain-switch";

describe("parseDomainInput", () => {
  it("accepts bare domains and strips schemes/paths", () => {
    expect(parseDomainInput("app.example.com")).toEqual({ domain: "app.example.com" });
    expect(parseDomainInput("https://app.example.com/")).toEqual({ domain: "app.example.com" });
    expect(parseDomainInput("APP.Example.COM/path")).toEqual({ domain: "app.example.com" });
  });

  it("rejects invalid hostnames", () => {
    expect(parseDomainInput("not a domain").error).toBeTruthy();
    expect(parseDomainInput("").error).toBeTruthy();
    expect(parseDomainInput("http://").error).toBeTruthy();
  });
});

describe("renderCaddySiteBlock", () => {
  it("renders an http redirect and reverse_proxy block", () => {
    const block = renderCaddySiteBlock("app.example.com", "127.0.0.1:8080");
    expect(block).toContain("http://app.example.com {");
    expect(block).toContain("redir https://app.example.com{uri}");
    expect(block).toContain("reverse_proxy 127.0.0.1:8080");
  });
});
