import type {
  GraphEdge,
  GraphNode,
  HostObservation,
  ServiceGraph,
  ServicePath,
} from "./types";

function nodeId(kind: string, key: string): string {
  return `${kind}:${key.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`;
}

function parseUpstream(upstream: string): { host: string; port?: number } {
  const cleaned = upstream
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  const [hostPart, portPart] = cleaned.split(":");
  const port = portPart ? parseInt(portPart, 10) : undefined;
  return { host: (hostPart || cleaned).toLowerCase(), port: Number.isFinite(port) ? port : undefined };
}

function isHostLoopback(host: string): boolean {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"].includes(host);
}

/**
 * Reconcile a HostObservation into a ServiceGraph.
 * Pure function — no host I/O.
 */
export function reconcileServiceGraph(obs: HostObservation): ServiceGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const at = obs.observedAt;

  const hostNodeId = nodeId("host", obs.hostId);
  nodes.push({
    id: hostNodeId,
    kind: "host",
    label: obs.hostId,
    confidence: 1,
    observedAt: at,
    attributes: { source: obs.source },
  });

  if (obs.proxy) {
    const proxyNodeId = nodeId("proxy", obs.proxy.type);
    nodes.push({
      id: proxyNodeId,
      kind: "proxy",
      label: obs.proxy.type,
      confidence: 1,
      observedAt: at,
      attributes: {
        type: obs.proxy.type,
        fingerprint: obs.proxy.fingerprint,
      },
    });
    edges.push({
      id: `e:${proxyNodeId}->${hostNodeId}`,
      kind: "RUNS_ON",
      from: proxyNodeId,
      to: hostNodeId,
      confidence: 1,
      observedAt: at,
    });

    for (const route of obs.proxy.routes) {
      const domainKey = route.domain.toLowerCase();
      const domainNodeId = nodeId("domain", domainKey);
      if (!nodes.find((n) => n.id === domainNodeId)) {
        nodes.push({
          id: domainNodeId,
          kind: "domain",
          label: route.domain,
          confidence: 0.95,
          observedAt: at,
          attributes: { domain: route.domain },
        });
      }

      const routeNodeId = nodeId("proxy_route", `${domainKey}${route.path || "/"}`);
      nodes.push({
        id: routeNodeId,
        kind: "proxy_route",
        label: `${route.domain}${route.path || ""} → ${route.upstream}`,
        confidence: 0.95,
        observedAt: at,
        attributes: {
          domain: route.domain,
          path: route.path || "/",
          upstream: route.upstream,
          listenPort: route.listenPort,
        },
      });

      edges.push({
        id: `e:${domainNodeId}->${routeNodeId}`,
        kind: "RESOLVES_TO",
        from: domainNodeId,
        to: routeNodeId,
        confidence: 0.9,
        observedAt: at,
      });
      edges.push({
        id: `e:${routeNodeId}->${proxyNodeId}`,
        kind: "RUNS_ON",
        from: routeNodeId,
        to: proxyNodeId,
        confidence: 1,
        observedAt: at,
      });

      const { host: upHost, port: upPort } = parseUpstream(route.upstream);
      // Match Docker-network routes by name/service and host-loopback routes by
      // the published host port. These are separate pieces of observed evidence.
      const namedMatch = obs.containers.find((c) => {
        const name = c.name.toLowerCase().replace(/^\//, "");
        const svc = (c.composeService || "").toLowerCase();
        return name === upHost || svc === upHost;
      });
      const publishedPortMatch = !namedMatch && upPort != null && isHostLoopback(upHost)
        ? obs.containers.find((container) => container.ports?.some((port) => port.host === upPort))
        : undefined;
      const match = namedMatch || publishedPortMatch;
      const linkMethod = publishedPortMatch
        ? "published_port"
        : namedMatch?.composeService?.toLowerCase() === upHost
          ? "compose_service"
          : namedMatch
            ? "container_name"
            : undefined;

      if (match) {
        const cName = match.name.replace(/^\//, "");
        const containerNodeId = nodeId("container", cName);
        if (!nodes.find((n) => n.id === containerNodeId)) {
          nodes.push({
            id: containerNodeId,
            kind: "container",
            label: cName,
            serviceId: match.composeService || cName,
            confidence: 1,
            observedAt: at,
            attributes: {
              name: cName,
              image: match.image,
              state: match.state,
              status: match.status,
              ports: match.ports || [],
              composeProject: match.composeProject,
              composeService: match.composeService,
            },
          });
          edges.push({
            id: `e:${containerNodeId}->${hostNodeId}`,
            kind: "RUNS_ON",
            from: containerNodeId,
            to: hostNodeId,
            confidence: 1,
            observedAt: at,
          });
        }
        edges.push({
          id: `e:${routeNodeId}->${containerNodeId}`,
          kind: "ROUTES_TO",
          from: routeNodeId,
          to: containerNodeId,
          confidence: 0.9,
          observedAt: at,
          attributes: { upstream: route.upstream, upstreamPort: upPort, linkMethod },
        });

        if (upPort != null) {
          const portNodeId = nodeId("port", `${cName}:${upPort}`);
          if (!nodes.find((n) => n.id === portNodeId)) {
            nodes.push({
              id: portNodeId,
              kind: "port",
              label: String(upPort),
              serviceId: match.composeService || cName,
              confidence: 0.85,
              observedAt: at,
              attributes: { port: upPort, container: cName },
            });
          }
          edges.push({
            id: `e:${containerNodeId}->${portNodeId}`,
            kind: "LISTENS_ON",
            from: containerNodeId,
            to: portNodeId,
            confidence: 0.7,
            observedAt: at,
          });
        }
      }
    }
  }

  for (const project of obs.composeProjects) {
    const projectNodeId = nodeId("docker_project", project.name);
    nodes.push({
      id: projectNodeId,
      kind: "docker_project",
      label: project.name,
      confidence: 1,
      observedAt: at,
      attributes: {
        path: project.path,
        fingerprint: project.fingerprint,
        services: project.services,
      },
    });
    edges.push({
      id: `e:${projectNodeId}->${hostNodeId}`,
      kind: "RUNS_ON",
      from: projectNodeId,
      to: hostNodeId,
      confidence: 1,
      observedAt: at,
    });

    for (const svc of project.services) {
      const serviceNodeId = nodeId("service", `${project.name}/${svc}`);
      if (!nodes.find((n) => n.id === serviceNodeId)) {
        nodes.push({
          id: serviceNodeId,
          kind: "service",
          label: svc,
          serviceId: svc,
          confidence: 0.95,
          observedAt: at,
          attributes: { project: project.name, service: svc },
        });
      }
      edges.push({
        id: `e:${projectNodeId}->${serviceNodeId}`,
        kind: "DEPLOYS",
        from: projectNodeId,
        to: serviceNodeId,
        confidence: 1,
        observedAt: at,
      });

      const container = obs.containers.find(
        (c) =>
          (c.composeProject || "").toLowerCase() === project.name.toLowerCase() &&
          (c.composeService || "").toLowerCase() === svc.toLowerCase()
      );
      if (container) {
        const cName = container.name.replace(/^\//, "");
        const containerNodeId = nodeId("container", cName);
        if (!nodes.find((n) => n.id === containerNodeId)) {
          nodes.push({
            id: containerNodeId,
            kind: "container",
            label: cName,
            serviceId: svc,
            confidence: 1,
            observedAt: at,
            attributes: {
              name: cName,
              image: container.image,
              state: container.state,
              status: container.status,
              ports: container.ports || [],
              composeProject: container.composeProject,
              composeService: container.composeService,
            },
          });
        }
        edges.push({
          id: `e:${serviceNodeId}->${containerNodeId}`,
          kind: "DEPLOYS",
          from: serviceNodeId,
          to: containerNodeId,
          confidence: 1,
          observedAt: at,
        });
      }
    }
  }

  // Containers without compose linkage
  for (const c of obs.containers) {
    const cName = c.name.replace(/^\//, "");
    const containerNodeId = nodeId("container", cName);
    if (!nodes.find((n) => n.id === containerNodeId)) {
      nodes.push({
        id: containerNodeId,
        kind: "container",
        label: cName,
        serviceId: c.composeService || cName,
        confidence: 1,
        observedAt: at,
        attributes: {
          name: cName,
          image: c.image,
          state: c.state,
          status: c.status,
          ports: c.ports || [],
          composeProject: c.composeProject,
          composeService: c.composeService,
        },
      });
      edges.push({
        id: `e:${containerNodeId}->${hostNodeId}`,
        kind: "RUNS_ON",
        from: containerNodeId,
        to: hostNodeId,
        confidence: 1,
        observedAt: at,
      });
    }
  }

  return {
    hostId: obs.hostId,
    nodes,
    edges,
    reconciledAt: at,
    source: obs.source,
  };
}

/**
 * Resolve domain → proxy route → container service path.
 */
export function resolveServicePath(graph: ServiceGraph, domain: string): ServicePath | null {
  const domainKey = domain.toLowerCase();
  const domainNode = graph.nodes.find(
    (n) => n.kind === "domain" && String(n.attributes.domain || n.label).toLowerCase() === domainKey
  );
  if (!domainNode) return null;

  const routeEdge = graph.edges.find((e) => e.kind === "RESOLVES_TO" && e.from === domainNode.id);
  const routeNode = routeEdge ? graph.nodes.find((n) => n.id === routeEdge.to) : undefined;
  const proxyNode = graph.nodes.find((n) => n.kind === "proxy");

  let containerNode = undefined as GraphNode | undefined;
  let routesTo = undefined as typeof graph.edges[0] | undefined;
  if (routeNode) {
    routesTo = graph.edges.find((e) => e.kind === "ROUTES_TO" && e.from === routeNode.id);
    if (routesTo) containerNode = graph.nodes.find((n) => n.id === routesTo!.to);
  }

  const upstream = routeNode ? String(routeNode.attributes.upstream || "") : undefined;
  const { port: upstreamPort } = upstream ? parseUpstream(upstream) : { port: undefined as number | undefined };
  const linkMethod = routesTo?.attributes?.linkMethod as ServicePath["linkMethod"] | undefined;
  const containerPorts = (containerNode?.attributes.ports as Array<{ host?: number; container?: number }>) || [];
  const listeningPorts = containerPorts
    .map((p) => linkMethod === "published_port" ? p.host : (p.container ?? p.host))
    .filter((p): p is number => typeof p === "number");

  const issues: string[] = [];
  const containerState = containerNode ? String(containerNode.attributes.state || "") : undefined;
  if (!containerNode) issues.push("no_container_match");
  if (containerState && containerState.toLowerCase() !== "running") {
    issues.push(`container_${containerState.toLowerCase()}`);
  }
  if (upstreamPort != null && listeningPorts.length > 0 && !listeningPorts.includes(upstreamPort)) {
    issues.push("wrong_upstream_port");
  }
  if (containerNode && upstreamPort != null && listeningPorts.length === 0) {
    // Unknown ports — soft issue only if we have no port metadata
    issues.push("unknown_container_ports");
  }

  const healthy =
    issues.filter((i) => i !== "unknown_container_ports").length === 0 &&
    Boolean(containerNode) &&
    (containerState || "").toLowerCase() === "running";

  return {
    domain,
    domainNodeId: domainNode.id,
    proxyNodeId: proxyNode?.id,
    routeNodeId: routeNode?.id,
    containerNodeId: containerNode?.id,
    serviceId: containerNode?.serviceId || (containerNode ? String(containerNode.attributes.composeService || containerNode.label) : undefined),
    upstream,
    listenPort: routeNode?.attributes.listenPort as number | undefined,
    containerPort: linkMethod === "published_port"
      ? containerPorts.find((port) => port.host === upstreamPort)?.container
      : upstreamPort,
    containerName: containerNode ? String(containerNode.attributes.name || containerNode.label) : undefined,
    containerState,
    linkMethod,
    healthy,
    issues,
  };
}

export function listServicePaths(graph: ServiceGraph): ServicePath[] {
  return graph.nodes
    .filter((n) => n.kind === "domain")
    .map((n) => resolveServicePath(graph, String(n.attributes.domain || n.label)))
    .filter((p): p is ServicePath => p != null);
}
