// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertCreationGrant, normalizeCreationSpec, validateCreationCompose } from "./agent-creation";
import { validateScope } from "./oauth";
const scopes = "deployment:create deployment:read deployment:redeploy operation:read";
const spec = normalizeCreationSpec({ hostId: 1, repositoryUrl: "https://github.com/team/app", name: "review", branch: "main", commitSha: "a".repeat(40), composeFile: "compose.yml", domain: "review.example.com", publicService: "web", publicPort: "8098", executor: "actions", workflowName: "Publish", generatedEnvironmentKeys: ["POSTGRES_PASSWORD"] });
const compose = `services:
  web:
    build: .
    image: ghcr.io/team/app:latest
    ports: ["127.0.0.1:8098:3000"]
    environment:
      DATABASE_URL: postgres://app:\${POSTGRES_PASSWORD:?required}@db:5432/app
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?required}
    volumes: ["data:/var/lib/postgresql/data"]
volumes:
  data:
`;
it("requires opt-in creation scope and a selected host, never inferring it from workload access", () => {
  expect(() => assertCreationGrant({ scope: "deployment:read deployment:redeploy", creationHosts: "[1]" }, { role: "admin" }, 1)).toThrow(/explicit/);
  expect(() => assertCreationGrant({ scope: scopes, creationHosts: "[]" }, { role: "admin" }, 1)).toThrow(/not approved/);
  expect(() => assertCreationGrant({ scope: scopes, creationHosts: "[1]", revokedAt: new Date() }, { role: "admin" }, 1)).toThrow(/explicit/);
  expect(() => assertCreationGrant({ scope: scopes, creationHosts: "[1]" }, { role: "viewer" }, 1)).toThrow(/explicit/);
  expect(() => validateScope("deployment:create", "admin")).toThrow(/requires/);
  expect(() => validateScope(scopes, "viewer")).toThrow(/Administrator/);
  expect(() => assertCreationGrant({ scope: scopes, creationHosts: "[1]" }, { role: "admin" }, 1)).not.toThrow();
});
it("accepts an isolated app/database recipe with new generated credentials", () => {
  expect(validateCreationCompose(compose, spec)).toMatchObject({ services: ["web", "db"], environment: [{ key: "POSTGRES_PASSWORD", required: true }] });
});
describe("refuses recipes that can adopt unrelated host resources", () => {
  it.each([
    compose.replace('build: .', 'build: .\n    privileged: true'),
    compose.replace('build: .', 'build: .\n    container_name: existing-app'),
    compose.replace('build: .', 'build: .\n    network_mode: host'),
    compose.replace('data:/var/lib/postgresql/data', '/opt/existing:/var/lib/postgresql/data'),
    compose.replace('  data:\n', '  data:\n    external: true\n'),
    compose.replace('  data:\n', '  data:\n    name: production-data\n'),
    compose.replace('127.0.0.1:8098', '0.0.0.0:8098'),
    compose.replace('127.0.0.1:8098', '127.0.0.1:3003'),
  ])("rejects unsafe Compose before execution", content => expect(() => validateCreationCompose(content, spec)).toThrow());
});
it("does not invent missing external credentials", () => {
  expect(() => validateCreationCompose(compose + '\n# ${EXTERNAL_API_KEY:?required}\n', spec)).toThrow(/EXTERNAL_API_KEY/);
  expect(() => normalizeCreationSpec({ ...spec, domain: 'app.example.com {\nrespond hacked\n}' })).toThrow(/hostname/);
  expect(() => normalizeCreationSpec({ ...spec, repositoryUrl: 'https://token@github.com/team/app' })).toThrow(/GitHub/);
});

it("does not require container-expanded healthcheck variables as host secrets", () => {
  const content = compose.replace("    image: postgres:17-alpine", () => '    image: postgres:17-alpine\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]');
  expect(validateCreationCompose(content, spec).environment.map(item => item.key)).toEqual(["POSTGRES_PASSWORD"]);
});
