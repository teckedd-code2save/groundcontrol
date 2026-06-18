export interface DeploymentManifestParams {
  name: string;
  namespace: string;
  image: string;
  replicas?: number;
  port?: number;
  env?: Record<string, string>;
}

export function generateDeploymentYaml(params: DeploymentManifestParams): string {
  const {
    name,
    namespace,
    image,
    replicas = 1,
    port = 80,
    env = {},
  } = params;

  const envEntries = Object.entries(env);
  const envYaml = envEntries.length
    ? `        env:\n${envEntries
        .map(
          ([key, value]) =>
            `        - name: ${key}\n          value: ${JSON.stringify(String(value))}`
        )
        .join("\n")}\n`
    : "";

  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${namespace}
  labels:
    app: ${name}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      containers:
      - name: ${name}
        image: ${image}
        ports:
        - containerPort: ${port}
${envYaml}`;
}

export interface ServiceManifestParams {
  name: string;
  namespace: string;
  port?: number;
  serviceType?: "ClusterIP" | "LoadBalancer";
}

export function generateServiceYaml(params: ServiceManifestParams): string {
  const { name, namespace, port = 80, serviceType = "ClusterIP" } = params;

  return `apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${namespace}
  labels:
    app: ${name}
spec:
  type: ${serviceType}
  selector:
    app: ${name}
  ports:
  - port: ${port}
    targetPort: ${port}
    protocol: TCP
`;
}

export interface IngressManifestParams {
  name: string;
  namespace: string;
  host: string;
  serviceName: string;
  port?: number;
  ingressClass?: string;
}

export function generateIngressYaml(params: IngressManifestParams): string {
  const {
    name,
    namespace,
    host,
    serviceName,
    port = 80,
    ingressClass = "traefik",
  } = params;

  const classLine = ingressClass ? `  ingressClassName: ${ingressClass}\n` : "";

  return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${name}
  namespace: ${namespace}
  labels:
    app: ${name}
spec:
${classLine}  rules:
  - host: ${host}
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: ${serviceName}
            port:
              number: ${port}
`;
}
