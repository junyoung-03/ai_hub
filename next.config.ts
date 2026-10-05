import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the repository's existing development instructions unchanged.
  agentRules: false,
  // Authorization codes arrive in callback URLs; do not log those requests.
  logging: { incomingRequests: { ignore: [/^\/auth\/callback(?:\?|$)/, /^\/api\/v1\/connections\/google\/callback(?:\?|$)/] } },
};

export default nextConfig;
