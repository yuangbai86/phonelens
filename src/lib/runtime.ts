/**
 * 浏览器端运行配置（只含公开信息，绝不放密钥）。
 * - NEXT_PUBLIC_BASE_PATH：站点子路径，如 GitHub Pages 的 /phonelens
 * - NEXT_PUBLIC_API_BASE：可选的独立后端地址（如 https://phonelens-api.example.com）；
 *   填 "same-origin" 表示与前端同域。未设置时 AI 相关功能显示“暂未启用”。
 *   模型密钥只配置在后端的服务端环境变量里。
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const rawApi = (process.env.NEXT_PUBLIC_API_BASE ?? "").trim();
export const API_BASE: string | null = rawApi === "" ? null : rawApi === "same-origin" ? "" : rawApi.replace(/\/$/, "");

export const BACKEND_ENABLED = API_BASE !== null;

export function apiUrl(path: string): string {
  return `${API_BASE ?? ""}${path}`;
}

/** 静态资源与地址栏路径需要手动加上子路径（next/link 与 router 会自动处理） */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

export const AI_DISABLED_TEXT = "AI 个性化解释暂未启用：当前是静态版本，没有连接后端。结论按固定规则在浏览器中得出。";
