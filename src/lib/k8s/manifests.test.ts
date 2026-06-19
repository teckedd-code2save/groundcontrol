import { describe, it, expect } from "vitest";
import {
  generateDeploymentYaml,
  generateServiceYaml,
  generateIngressYaml,
} from "./manifests";

describe("k8s manifests", () => {
  describe("generateDeploymentYaml", () => {
    it("generates a Deployment manifest with required fields", () => {
      const yaml = generateDeploymentYaml({
        name: "my-app",
        namespace: "gc-my-app",
        image: "my-app:latest",
        replicas: 3,
        port: 8080,
      });

      expect(yaml).toContain("apiVersion: apps/v1");
      expect(yaml).toContain("kind: Deployment");
      expect(yaml).toContain("name: my-app");
      expect(yaml).toContain("namespace: gc-my-app");
      expect(yaml).toContain("replicas: 3");
      expect(yaml).toContain("image: my-app:latest");
      expect(yaml).toContain("containerPort: 8080");
      expect(yaml).toContain("matchLabels:\n      app: my-app");
    });

    it("includes environment variables when provided", () => {
      const yaml = generateDeploymentYaml({
        name: "my-app",
        namespace: "default",
        image: "my-app:v1",
        env: { NODE_ENV: "production", PORT: "3000" },
      });

      expect(yaml).toContain("env:");
      expect(yaml).toContain('- name: NODE_ENV');
      expect(yaml).toContain('value: "production"');
      expect(yaml).toContain('- name: PORT');
      expect(yaml).toContain('value: "3000"');
    });

    it("uses sensible defaults", () => {
      const yaml = generateDeploymentYaml({
        name: "app",
        namespace: "default",
        image: "app:latest",
      });

      expect(yaml).toContain("replicas: 1");
      expect(yaml).toContain("containerPort: 80");
      expect(yaml).not.toContain("env:");
    });
  });

  describe("generateServiceYaml", () => {
    it("generates a ClusterIP Service manifest", () => {
      const yaml = generateServiceYaml({
        name: "my-app",
        namespace: "gc-my-app",
        port: 8080,
      });

      expect(yaml).toContain("apiVersion: v1");
      expect(yaml).toContain("kind: Service");
      expect(yaml).toContain("name: my-app");
      expect(yaml).toContain("namespace: gc-my-app");
      expect(yaml).toContain("type: ClusterIP");
      expect(yaml).toContain("port: 8080");
      expect(yaml).toContain("targetPort: 8080");
    });

    it("supports LoadBalancer service type", () => {
      const yaml = generateServiceYaml({
        name: "my-app",
        namespace: "default",
        serviceType: "LoadBalancer",
      });

      expect(yaml).toContain("type: LoadBalancer");
    });
  });

  describe("generateIngressYaml", () => {
    it("generates an Ingress manifest with the traefik class", () => {
      const yaml = generateIngressYaml({
        name: "my-app",
        namespace: "gc-my-app",
        host: "my-app.example.com",
        serviceName: "my-app",
        port: 8080,
      });

      expect(yaml).toContain("apiVersion: networking.k8s.io/v1");
      expect(yaml).toContain("kind: Ingress");
      expect(yaml).toContain("name: my-app");
      expect(yaml).toContain("namespace: gc-my-app");
      expect(yaml).toContain("ingressClassName: traefik");
      expect(yaml).toContain("host: my-app.example.com");
      expect(yaml).toContain("service:\n            name: my-app");
      expect(yaml).toContain("number: 8080");
      expect(yaml).toContain("pathType: Prefix");
    });

    it("supports a custom ingress class", () => {
      const yaml = generateIngressYaml({
        name: "my-app",
        namespace: "default",
        host: "app.local",
        serviceName: "my-app",
        ingressClass: "caddy",
      });

      expect(yaml).toContain("ingressClassName: caddy");
    });
  });
});
