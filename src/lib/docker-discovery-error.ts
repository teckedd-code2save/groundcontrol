import { HttpError } from "./errors";

export function assertDockerDiscovery(result: { code: number; stderr: string }) {
  if (result.code !== 0) {
    const detail = result.stderr.toLowerCase();
    if (/permission denied|access is denied/.test(detail)) {
      throw new HttpError("Docker discovery could not access the selected host's Docker socket. Check the connection user's Docker permissions, then retry. No deployments were changed.", 503);
    }
    if (/not found|not recognized/.test(detail) || result.code === 127) {
      throw new HttpError("Docker is missing on the selected host. On a Linux server, finish setup in Services → Install; on your computer, install and start Docker Desktop/Engine. Then retry discovery.", 503);
    }
    if (/cannot connect|is the docker daemon running|connection refused/.test(detail)) {
      throw new HttpError("Docker is not reachable on the selected host. Start Docker Desktop/Engine or check the host connection, then retry discovery. On a Linux server, Services → Install can check Docker's status.", 503);
    }
    throw new HttpError("Docker discovery failed on the selected host. Check its connection and Docker status in Services → Install (or Docker Desktop), then retry. An empty app list has not been verified.", 503);
  }
}
