import type { NextConfig } from "next";

/**
 * 两种构建目标：
 * - PHONELENS_TARGET=static：静态导出（GitHub Pages）。所有比较与清洗在浏览器完成，不包含服务端接口。
 * - 默认（server）：带 /api 路由，可单独部署为后端（如 Vercel），供静态前端通过 NEXT_PUBLIC_API_BASE 调用。
 * 服务端接口文件命名为 route.server.ts，只有 server 目标会把它识别为路由。
 */
const isStatic = process.env.PHONELENS_TARGET === "static";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  basePath: basePath || undefined,
  trailingSlash: isStatic,
  pageExtensions: isStatic ? ["tsx", "ts"] : ["server.ts", "tsx", "ts"],
  ...(isStatic
    ? { output: "export" as const, images: { unoptimized: true } }
    : {
        async headers() {
          // 静态前端（如 GitHub Pages）跨域调用本后端时，需要设置 CORS_ALLOW_ORIGIN，例如 https://yuangbai86.github.io
          const origin = process.env.CORS_ALLOW_ORIGIN?.trim();
          const cors = origin
            ? [
                {
                  source: "/api/:path*",
                  headers: [
                    { key: "Access-Control-Allow-Origin", value: origin },
                    { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
                    { key: "Access-Control-Allow-Headers", value: "Content-Type" },
                    { key: "Access-Control-Max-Age", value: "600" },
                    { key: "Vary", value: "Origin" },
                  ],
                },
              ]
            : [];
          return [
            ...cors,
            {
              source: "/(.*)",
              headers: [
                { key: "X-Content-Type-Options", value: "nosniff" },
                { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                { key: "X-Frame-Options", value: "DENY" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
