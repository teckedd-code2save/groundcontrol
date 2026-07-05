export type LifecycleAction = "start" | "stop" | "restart" | "redeploy";

export interface LifecycleScope {
  services?: string[];
  label: string;
  targetName: string;
}

export function resolveLifecycleScope(projectName: string, selectedServices: string[] = []): LifecycleScope {
  const services = selectedServices.filter(Boolean);
  if (services.length === 0) {
    return {
      label: "whole deployment",
      targetName: projectName,
    };
  }

  return {
    services,
    label: services.length === 1 ? services[0] : `${services.length} selected services`,
    targetName: `${projectName} · ${services.join(", ")}`,
  };
}

export function lifecycleActionLabel(action: LifecycleAction): string {
  if (action === "start") return "Start";
  if (action === "stop") return "Stop";
  if (action === "redeploy") return "Redeploy";
  return "Restart";
}
