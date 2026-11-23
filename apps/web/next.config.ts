import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kontener na AWS albo serwer Node: jeden katalog z serwerem i zależnościami (miejsce działania: ADR-0088)
  output: "standalone",
  // Biblioteki z połączeniami sieciowymi i WebAssembly zostają w node_modules, poza paczką serwera
  serverExternalPackages: ["@electric-sql/pglite", "imapflow", "mailparser", "nodemailer", "postgres"],
  experimental: { globalNotFound: true },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
