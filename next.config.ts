import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A lockfile in a parent directory makes Turbopack guess the workspace root
  // and warn about it. Pin it — the console must be clean during the demo.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
