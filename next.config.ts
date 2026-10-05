import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The development badge overlaps the mobile Today navigation target.
  devIndicators: false,
  // Keep the repository's existing development instructions unchanged.
  agentRules: false,
  serverExternalPackages: ['sharp','@napi-rs/canvas','pdfjs-dist'],
  outputFileTracingIncludes: {
    '/api/v1/uploads/*/prepare': ['./workers/upload/{child,parser}.mjs','./node_modules/{sharp,@img,@napi-rs,pdfjs-dist}/**/*'],
    '/api/v1/uploads/*/complete': ['./workers/upload/{child,parser}.mjs','./node_modules/{sharp,@img,@napi-rs,pdfjs-dist}/**/*'],
  },
  async headers(){return [
    {source:'/library',headers:[{key:'Content-Security-Policy',value:"worker-src 'self'; object-src 'none'; base-uri 'self'"}]},
    {source:'/ocr/:path*',headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'},{key:'Content-Security-Policy',value:"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'"},{key:'X-Content-Type-Options',value:'nosniff'}]},
  ];},
  // Authorization codes arrive in callback URLs; do not log those requests.
  logging: { incomingRequests: { ignore: [/^\/auth\/callback(?:\?|$)/, /^\/api\/v1\/connections\/google\/callback(?:\?|$)/] } },
};

export default nextConfig;
