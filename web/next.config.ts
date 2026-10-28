import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle a self-contained server so the container image doesn't need node_modules. Vercel
  // (which sets VERCEL during its builds) packages its own functions and needs no such bundle.
  output: process.env.VERCEL ? undefined : "standalone",

  // The prototype moved to /demo when the landing page took over /. Old links still land on the
  // same page. Temporary, so browsers don't cache them and the paths stay free for the product.
  async redirects() {
    return [
      { source: "/study", destination: "/demo/study", permanent: false },
      { source: "/questions/:id", destination: "/demo/questions/:id", permanent: false },
    ];
  },
};

export default nextConfig;
