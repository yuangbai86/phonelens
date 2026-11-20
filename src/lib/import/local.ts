/**
 * 浏览器本地的评论导入：只做解析、格式统一、去重与可疑项标记，不发送到任何服务器。
 * 维度分析需要模型，静态版本不进行，界面会说明“暂未启用”。
 */
import { computeStats } from "../stats";
import type { PhoneRecord, ReviewRecord } from "../types";
import type { ImportRow } from "../csv";
import { DIMENSION_LABEL, SENTIMENT_LABEL } from "../labels";
import type { ImportResult } from "./service";

const STATUS_TEXT: Record<string, string> = {
  counted: "已分析",
  pending: "未分析",
  needs_review: "待复核",
  flagged: "待复核（疑似问题）",
  excluded: "已排除",
};

export function customPhone(name: string): PhoneRecord {
  return {
    id: "custom",
    brand: "",
    model: name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40),
    aliases: [],
    region: "未知",
    storage: "未知",
    ram: null,
    sale_status: "unverified",
    verified_at: null,
    data_kind: "user",
    note: "目录外机型，只生成口碑摘要",
  };
}

export function cleanImportLocally(rows: ImportRow[], phone: PhoneRecord, inCatalog: boolean, catalog: PhoneRecord[], message: string): ImportResult {
  const today = new Date().toISOString().slice(0, 10);
  const reviews: ReviewRecord[] = rows.map((r) => ({
    id: r.review_id,
    phone_id: phone.id,
    text: r.text,
    source_id: "user-import",
    review_date: r.review_date,
    collected_at: today,
    system_version: r.system_version,
    usage_scope: "用户提交，仅在本机浏览器处理",
    data_kind: "user",
  }));
  const stats = computeStats({ phone, catalog, reviews, analysis: [], audit: [], asOf: today, window: "all" });
  const { views, ...summary } = stats;
  const rowById = new Map(rows.map((r) => [r.review_id, r]));
  return {
    mode: "baseline",
    fixture: false,
    message,
    phone: { id: phone.id, name: `${phone.brand} ${phone.model}`.trim(), in_catalog: inCatalog },
    stats: summary,
    reviews: views.map((v) => {
      const row = rowById.get(v.review.id)!;
      return {
        id: v.review.id,
        line: row.line,
        text: v.review.text,
        source_label: row.source_label,
        review_date: row.review_date,
        system_version: row.system_version,
        source_url: row.source_url,
        status:
          v.status.kind === "excluded" || v.status.kind === "flagged" ? `${STATUS_TEXT[v.status.kind]}：${v.status.note}` : STATUS_TEXT[v.status.kind] ?? v.status.kind,
        labels: v.labels.map((l) => ({ dimension: DIMENSION_LABEL[l.dimension], sentiment: SENTIMENT_LABEL[l.sentiment], excerpt: l.excerpt })),
      };
    }),
    removed_labels: 0,
    prompt_version: null,
  };
}
