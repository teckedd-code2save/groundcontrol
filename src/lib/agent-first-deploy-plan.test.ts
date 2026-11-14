import { describe, expect, it } from "vitest";
import { planAgentFirstDeploy, type FirstDeployPlanInput } from "./agent-first-deploy-plan";
const base: FirstDeployPlanInput = { proposalId: "proposal_123456", repositoryUrl: "https://github.com/example/app.git", commitSha: "a".repeat(40), composeFile: "docker-compose.yml", composeYaml: "services:\n  app:\n    build: .\n    ports: ['127.0.0.1:8080:80']\n    volumes: ['data:/data']\nvolumes:\n  data: {}\n" };
const review = (yaml: string) => planAgentFirstDeploy({ ...base, composeYaml: yaml });
const service = (config: string) => review(`services:\n  app:\n${config.split('\n').map(line => `    ${line}`).join('\n')}\n`);
describe("agent first-deploy static planner", () => {
  it("normalizes source and produces a deterministic exclusive-path candidate without executing", () => {
    const result = planAgentFirstDeploy(base);
    expect(result.readyForOwnerReview).toBe(true);
    expect(result.source.repositoryUrl).toBe("https://github.com/example/app");
    expect(result.deploymentPath).toMatch(/^\/srv\/groundcontrol\/deployments\/proposal-[a-f0-9]{64}$/);
    expect(result).toEqual(planAgentFirstDeploy(base));
    expect(result.limitations.join(" ")).toContain("not a sandbox");
    expect(planAgentFirstDeploy({ ...base, proposalId: "proposal_different" }).deploymentPath).not.toBe(result.deploymentPath);
    expect(planAgentFirstDeploy({ ...base, commitSha: "b".repeat(40) }).recipeHash).not.toBe(result.recipeHash);
  });
  it.each(["main", "a".repeat(39), "z".repeat(40)])("rejects mutable/invalid revision %s", commitSha => expect(planAgentFirstDeploy({ ...base, commitSha }).readyForOwnerReview).toBe(false));
  it.each(["https://user:pass@github.com/example/app", "https://evil.test/example/app", "https://github.com/example/app/tree/main", "file:///tmp/app", "https://github.com/example/app?token=x"])("rejects repository identity %s", repositoryUrl => expect(planAgentFirstDeploy({ ...base, repositoryUrl }).readyForOwnerReview).toBe(false));
  it.each(["../compose.yml", "/tmp/compose.yml", "${FILE}.yml", "sub/../../compose.yml", "sub\\compose.yml"])("rejects compose path %s", composeFile => expect(planAgentFirstDeploy({ ...base, composeFile }).readyForOwnerReview).toBe(false));
  it.each(["profiles: [debug]", "scale: 20", "privileged: true", "privileged: '${PRIVILEGED}'", "network_mode: host", "pid: host", "ipc: host", "devices: ['/dev/sda']", "cap_add: [SYS_ADMIN]", "extra_hosts: ['host:host-gateway']", "use_api_socket: true", "extends: {file: other.yml, service: app}", "security_opt: [seccomp:unconfined]", "volumes_from: [another]", "post_start: [{command: dangerous}]", "env_file: /etc/environment"])("blocks privileged/unreviewed feature %s", config => expect(service(config).readyForOwnerReview).toBe(false));
  it.each(["volumes: ['/var/run/docker.sock:/var/run/docker.sock']", "volumes: ['./data:/data']", "volumes: ['${SOURCE}:/data']", "volumes: [{type: bind, source: /etc, target: /host}]", "volumes: ['undeclared:/data']"])("blocks host or ambiguous mounts %s", config => expect(service(config).readyForOwnerReview).toBe(false));
  it.each(["build: {context: ., args: [JWT_SECRET]}", "build: {context: ., args: {JWT_SECRET: null}}", "build: {context: ., cache_to: [type=local,dest=/etc]}", "build: {context: ., cache_from: [type=local,src=/etc]}", "build: {context: ., tags: [other:latest]}", "build: ../other", "build: https://evil.test/repo.git", "build: {context: ., dockerfile: ../../Dockerfile}", "build: {context: '${CONTEXT}'}", "build: {context: ., additional_contexts: {host: /etc}}", "build: {context: ., ssh: [default]}", "build: {context: ., network: host}"])("blocks build escape %s", config => expect(service(config).readyForOwnerReview).toBe(false));
  it.each(["volumes:\n  data:\n    external: true", "volumes:\n  data:\n    driver_opts: {type: none, o: bind, device: /}", "networks:\n  default:\n    name: host", "include: other.yml", "secrets: {password: {file: /etc/shadow}}"])("blocks top-level bypass %s", config => expect(review(`services:\n  app:\n    image: example/app\n${config}`).readyForOwnerReview).toBe(false));
  it("rejects duplicate keys, invalid documents and missing services", () => {
    for (const yaml of ["[]", "services: {}", "services: {app: {image: x, image: y}}", "services: [app]"]) expect(review(yaml).readyForOwnerReview).toBe(false);
  });
  it("allows repository-local build and anonymous volumes but retains execution caveats", () => {
    expect(service("build: {context: ./app, dockerfile: Dockerfile}\nvolumes: ['/data']").readyForOwnerReview).toBe(true);
  });
  it("bounds YAML input", () => expect(review("#".repeat(256 * 1024 + 1)).blockers.some(b => b.field === "composeYaml")).toBe(true));
});
