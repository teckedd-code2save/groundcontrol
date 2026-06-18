/**
 * Minimal Kubernetes resource types for the GroundControl k3s integration.
 * These are intentionally loose so we can parse kubectl JSON output without
 * dragging in the full k8s client types.
 */

export interface K8sMetadata {
  name?: string;
  namespace?: string;
  creationTimestamp?: string;
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface K8sContainerStatus {
  ready?: boolean;
  restartCount?: number;
}

export interface K8sPodStatus {
  phase?: string;
  containerStatuses?: K8sContainerStatus[];
}

export interface K8sPod {
  metadata?: K8sMetadata;
  status?: K8sPodStatus;
}

export interface K8sServicePort {
  port?: number;
  targetPort?: number | string;
  nodePort?: number;
  protocol?: string;
}

export interface K8sServiceSpec {
  type?: string;
  clusterIP?: string;
  ports?: K8sServicePort[];
}

export interface K8sServiceStatus {
  loadBalancer?: {
    ingress?: Array<{ ip?: string; hostname?: string }>;
  };
}

export interface K8sService {
  metadata?: K8sMetadata;
  spec?: K8sServiceSpec;
  status?: K8sServiceStatus;
}

export interface K8sIngressRule {
  host?: string;
  http?: {
    paths?: Array<{
      path?: string;
      backend?: {
        service?: {
          name?: string;
          port?: { number?: number };
        };
      };
    }>;
  };
}

export interface K8sIngressSpec {
  ingressClassName?: string;
  rules?: K8sIngressRule[];
}

export interface K8sIngressStatus {
  loadBalancer?: {
    ingress?: Array<{ ip?: string; hostname?: string }>;
  };
}

export interface K8sIngress {
  metadata?: K8sMetadata;
  spec?: K8sIngressSpec;
  status?: K8sIngressStatus;
}

export interface K8sNamespace {
  metadata?: K8sMetadata;
  status?: { phase?: string };
}

export interface K8sList<T> {
  items?: T[];
}

export interface K8sJson {
  metadata?: K8sMetadata;
  status?: Record<string, unknown>;
  spec?: Record<string, unknown>;
  items?: K8sJson[];
  [key: string]: unknown;
}
