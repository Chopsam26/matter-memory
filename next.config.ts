import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse wraps pdfjs-dist, which loads its worker by resolving a path at
  // runtime. Bundled into the server build that path no longer exists, and
  // every PDF upload fails with:
  //
  //   Setting up fake worker failed: "Cannot find module
  //   '.next/dev/server/chunks/pdf.worker.mjs'"
  //
  // Listing them here leaves both to Node's own resolution. Text uploads work
  // either way, so this only shows up on the PDF path.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
