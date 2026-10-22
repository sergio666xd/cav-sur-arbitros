import type { NextConfig } from "next";

// En Vercel, /api/* lo atiende la función de Python (api/index.py, ver vercel.json).
// En local, Next reenvía /api/* al servidor de FastAPI que corre con `npm run dev:api`.
const nextConfig: NextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" }];
  },
};

export default nextConfig;
