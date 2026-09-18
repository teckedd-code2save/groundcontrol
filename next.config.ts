import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["ssh2", "node-ssh"],
  async rewrites() {
    return [
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata/authorization-server" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/metadata/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/mcp", destination: "/api/oauth/metadata/protected-resource" },
    ];
  },
};

export default nextConfig;
