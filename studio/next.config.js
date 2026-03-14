/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  turbopack: {
    root: __dirname,
  },
  webpack: (config) => {
    // pdfjs-dist optionally requires 'canvas' (a Node.js native module).
    // Alias it to false so webpack doesn't try to bundle it in the browser.
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;

