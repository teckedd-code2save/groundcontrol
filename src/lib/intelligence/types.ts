/**
 * GroundControl intelligence / Loop shared types.
 * See docs/LOOP.md for the product contract.
 */

export type OperationalEventKind =
  | "artifact_changed"
  | "container_replaced"
  | "compose_changed"
  | "proxy_changed"
  | "environment_schema_changed"
  | "network_changed"
  | "certificate_changed"
  | "resource_threshold_crossed"
  | "external_probe_failed"
  | "manual_action";

export type OperationalEventSource = "agent" | "github" | "probe" | "groundcontrol" | "fixture";

export interface OperationalEvent {
  id: string;
  hostId: string;
  serviceIds: string[];
  kind: OperationalEventKind;
  observedAt: string;
  source: OperationalEventSource;
  beforeRef?: string;
  afterRef?: string;
  evidenceArtifactIds: string[];
  /** Free-form structured payload (never secrets). */
  meta?: Record<string, unknown>;
}

export interface ChangeSet {
  id: string;
  hostId: string;
  serviceIds: string[];
  eventIds: string[];
  kinds: OperationalEventKind[];
  firstObservedAt: string;
  lastObservedAt: string;
  stabilizedAt?: string;
}

export type GraphNodeKind =
  | "host"
  | "docker_project"
  | "service"
  | "container"
  | "domain"
  | "certificate"
  | "proxy"
  | "proxy_route"
  | "network"
  | "port"
  | "dependency"
  | "journey";

export type GraphEdgeKind =
  | "RUNS_ON"
  | "DEPLOYS"
  | "ROUTES_TO"
  | "RESOLVES_TO"
  | "TERMINATES_TLS_FOR"
  | "LISTENS_ON"
  | "PUBLISHES"
  | "JOINS_NETWORK"
  | "DEPENDS_ON"
  | "VERIFIED_BY"
  | "CHANGED_BY";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  serviceId?: string;
  /** Observation confidence 0–1 */
  confidence: number;
  observedAt: string;
  attributes: Record<string, unknown>;
  lastHealthyValue?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  from: string;
  to: string;
  confidence: number;
  observedAt: string;
  attributes?: Record<string, unknown>;
}

export interface ServiceGraph {
  hostId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  reconciledAt: string;
  source: "live" | "fixture" | "snapshot";
}

export interface ServicePath {
  domain: string;
  domainNodeId?: string;
  proxyNodeId?: string;
  routeNodeId?: string;
  containerNodeId?: string;
  serviceId?: string;
  upstream?: string;
  listenPort?: number;
  containerPort?: number;
  containerName?: string;
  containerState?: string;
  linkMethod?: "container_name" | "compose_service" | "published_port";
  healthy: boolean;
  issues: string[];
}

export type ProbeKind = "internal" | "external";

export interface ProbeResult {
  id: string;
  kind: ProbeKind;
  target: string;
  serviceId?: string;
  ok: boolean;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
  observedAt: string;
}

export interface LastKnownHealthy {
  hostId: string;
  serviceId: string;
  capturedAt: string;
  graphPath: ServicePath;
  probeResults: ProbeResult[];
  proxyRevisionId?: string;
  artifactRef?: string;
  snapshot: Record<string, unknown>;
}

export type JourneyCriticality = "critical" | "high" | "medium" | "low";

export interface JourneyStep {
  action: "open" | "expect_status" | "expect_body";
  url?: string;
  status?: number;
  bodyIncludes?: string;
}

export interface CustomerJourney {
  id: string;
  name: string;
  serviceIds: string[];
  criticality: JourneyCriticality;
  triggers: string[];
  steps: JourneyStep[];
  confirmed: boolean;
  publicUrl?: string;
}

export interface JourneyRunResult {
  journeyId: string;
  ok: boolean;
  stepResults: Array<{ stepIndex: number; ok: boolean; detail: string; statusCode?: number }>;
  observedAt: string;
}

export type LoopRunState =
  | "observed"
  | "correlating"
  | "stabilized"
  | "exercising"
  | "verified_healthy"
  | "investigating"
  | "guided"
  | "planning"
  | "awaiting_approval"
  | "applying"
  | "verifying"
  | "rolling_back"
  | "recovered"
  | "remembered"
  | "failed"
  | "cancelled";

export type AllowlistedActionKind =
  | "restore_proxy_revision"
  | "reload_validated_proxy"
  | "restart_stateless_service"
  | "redeploy_previous_healthy_artifact"
  | "noop_guided";

export type ActionRisk = "low" | "medium" | "high" | "destructive";

export interface ActionPlan {
  id: string;
  kind: AllowlistedActionKind;
  title: string;
  description: string;
  risk: ActionRisk;
  preconditions: string[];
  affectedNodeIds: string[];
  supportingEvidenceIds: string[];
  expectedResult: string;
  verificationJourneyIds: string[];
  rollbackKind?: AllowlistedActionKind;
  approvalRequired: boolean;
  /** Deterministic params — never freeform shell. */
  params: Record<string, unknown>;
  executed?: boolean;
  executedAt?: string;
  result?: string;
  rolledBack?: boolean;
  rolledBackAt?: string;
}

export interface Hypothesis {
  id: string;
  statement: string;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  confidence: number;
  status: "open" | "confirmed" | "rejected";
  /** Machine concept tag for fixture evaluation, e.g. wrong_upstream_port */
  concept?: string;
}

export interface Investigation {
  symptom: string;
  customerImpact: string;
  hypotheses: Hypothesis[];
  confirmedCause?: string;
  confirmedConcept?: string;
  uncertainty: string[];
  recommendedAction?: ActionPlan;
  evidence: EvidenceArtifact[];
  provider: "deterministic" | "llm" | "hybrid";
}

export interface EvidenceArtifact {
  id: string;
  kind: string;
  summary: string;
  /** Sanitized detail — never secrets */
  detail?: string;
  observedAt: string;
  serviceIds?: string[];
}

export interface LoopRun {
  id: string;
  hostId: string;
  state: LoopRunState;
  changeSetId?: string;
  serviceIds: string[];
  eventIds: string[];
  journeyResults: JourneyRunResult[];
  investigation?: Investigation;
  actionPlan?: ActionPlan;
  approvedAt?: string;
  approvedBy?: string;
  verification?: JourneyRunResult[];
  createdAt: string;
  updatedAt: string;
  /** Idempotency markers so restarts do not re-fire side effects */
  sideEffects: {
    journeysRun: boolean;
    investigationDone: boolean;
    mutationApplied: boolean;
    verificationDone: boolean;
    rollbackDone: boolean;
    memoryRecorded: boolean;
  };
  auditLog: Array<{ at: string; action: string; detail?: string }>;
  label?: string;
  isFixture?: boolean;
  /**
   * Snapshot of host-facing config before the approved mutation,
   * used for real rollback if verification fails.
   */
  preMutation?: {
    proxyRevisionId?: string;
    proxyContent?: string;
    proxyType?: "caddy" | "nginx" | "unknown";
    containerName?: string;
    containerState?: string;
  };
}

export interface ProxyRevision {
  id: string;
  hostId: string;
  proxyType: "caddy" | "nginx" | "unknown";
  content: string;
  fingerprint: string;
  capturedAt: string;
  serviceIds: string[];
  validated: boolean;
  label?: string;
}

/** Host observation input used by pure reconciler (live adapters map into this). */
export interface HostObservation {
  hostId: string;
  observedAt: string;
  source: "live" | "fixture";
  containers: Array<{
    name: string;
    image: string;
    state: string;
    status: string;
    composeProject?: string;
    composeService?: string;
    ports?: Array<{ host?: number; container?: number; protocol?: string }>;
    networks?: string[];
  }>;
  composeProjects: Array<{
    name: string;
    path?: string;
    services: string[];
    fingerprint?: string;
  }>;
  proxy?: {
    type: "caddy" | "nginx" | "unknown";
    configContent: string;
    fingerprint: string;
    routes: Array<{
      domain: string;
      path?: string;
      upstream: string;
      listenPort?: number;
    }>;
  };
  domains?: Array<{ domain: string; resolvesTo?: string; tlsValid?: boolean }>;
}
