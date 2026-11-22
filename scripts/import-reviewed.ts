/**
 * 把导入页下载的“校验结果（JSON）”写入静态数据（data/v1/reviews.real.json 与 analysis.real.json）。
 *
 * 用法：
 *   npx tsx scripts/import-reviewed.ts <下载的 JSON> --phone apple-iphone-17-256 --source src-xxx --reviewer "你的名字" [--dry-run]
 *
 * 规则：
 * - 机型必须在目录中；来源必须已登记在 data/v1/review-sources.json，且写明允许保存与展示的范围；
 * - 每条评论重新与原文核对标签（编号、维度、情绪、原文摘录、具体问题），不合格的标签不会写入，相关评论记为待复核；
 * - 必须写明人工审核人（--reviewer），标注记为 “claude-import（人工审核：xxx）”；
 * - 只追加，不覆盖已有真实评论；同一文本重复导入会被跳过。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataset } from "../src/lib/data";
import { dedupeKey, validateLabels } from "../src/lib/clean";
import type { AnalysisRecord, ReviewRecord, SourceRecord } from "../src/lib/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "../data/v1");
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const fail = (m: string) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

const file = process.argv[2];
const phoneId = arg("phone");
const sourceId = arg("source");
const reviewer = arg("reviewer")?.trim();
const dryRun = process.argv.includes("--dry-run");
if (!file || file.startsWith("--")) fail("请提供导入页下载的 JSON 文件路径");
if (!phoneId || !sourceId || !reviewer) fail("需要 --phone、--source 与 --reviewer");

const phone = dataset.phones.find((p) => p.id === phoneId);
if (!phone) fail(`机型 ${phoneId} 不在目录中`);
if (phone!.data_kind === "demo") fail("不能把真实反馈写入演示机型");

const sources = JSON.parse(readFileSync(path.join(DATA, "review-sources.json"), "utf8")) as SourceRecord[];
const source = sources.find((s) => s.id === sourceId);
if (!source) fail(`来源 ${sourceId} 未登记。请先在 data/v1/review-sources.json 中写明获取方式、允许保存与展示的范围`);
if (source!.allowed_display === "none") fail("该来源不允许展示，不能写入公开数据");
if (!source!.allowed_storage?.trim()) fail("该来源没有写明允许保存的范围");

type Payload = {
  format: string;
  prompt_version: string | null;
  reviews: { review_id: string; text: string; review_date: string | null; system_version: string | null; source_url: string | null; source_label: string }[];
  analysis: AnalysisRecord[];
};
const payload = JSON.parse(readFileSync(file!, "utf8")) as Payload;
if (payload.format !== "phonelens-review-import/v1") fail("文件格式不是 phonelens-review-import/v1");

const existing = JSON.parse(readFileSync(path.join(DATA, "reviews.real.json"), "utf8")) as ReviewRecord[];
const existingAnalysis = JSON.parse(readFileSync(path.join(DATA, "analysis.real.json"), "utf8")) as AnalysisRecord[];
const seenText = new Set(existing.filter((r) => r.phone_id === phoneId).map((r) => dedupeKey(r.text)));
const today = new Date().toISOString().slice(0, 10);
let seq = existing.filter((r) => r.phone_id === phoneId).length;

const newReviews: ReviewRecord[] = [];
const newAnalysis: AnalysisRecord[] = [];
let skipped = 0;
let rejectedLabels = 0;
const byId = new Map(payload.analysis.map((a) => [a.review_id, a]));

for (const r of payload.reviews) {
  const key = dedupeKey(r.text);
  if (!key || seenText.has(key)) {
    skipped++;
    continue;
  }
  seenText.add(key);
  const id = `${phoneId}-r-${String(++seq).padStart(3, "0")}`;
  newReviews.push({
    id,
    phone_id: phoneId!,
    text: r.text,
    source_id: sourceId!,
    review_date: r.review_date && /^\d{4}-\d{2}-\d{2}$/.test(r.review_date) ? r.review_date : null,
    collected_at: today,
    system_version: r.system_version || null,
    usage_scope: source!.allowed_display === "full_text" ? "允许展示全文" : source!.allowed_display === "excerpt" ? "只展示摘录" : "只展示统计",
    data_kind: "real",
  });
  const a = byId.get(r.review_id);
  if (!a || a.status === "pending") {
    newAnalysis.push({ review_id: id, status: "pending", labels: [], labeler: "none", prompt_version: null, reviewed_by: null });
    continue;
  }
  const { valid, issues } = validateLabels(
    a.labels.map((l) => ({ ...l, review_id: id })),
    new Map([[id, r.text]]),
  );
  rejectedLabels += issues.length;
  const status = a.status === "needs_review" || issues.length ? "needs_review" : "analyzed";
  newAnalysis.push({
    review_id: id,
    status,
    labels: status === "analyzed" ? valid : [],
    labeler: "claude-import",
    prompt_version: payload.prompt_version,
    reviewed_by: reviewer!,
  });
}

console.log(`机型 ${phone!.brand} ${phone!.model}；来源 ${source!.name}`);
console.log(`新增 ${newReviews.length} 条（跳过重复 ${skipped} 条）；已分析 ${newAnalysis.filter((a) => a.status === "analyzed").length}，待复核 ${newAnalysis.filter((a) => a.status === "needs_review").length}，未标注 ${newAnalysis.filter((a) => a.status === "pending").length}；未通过校验的标签 ${rejectedLabels} 个`);
if (dryRun) {
  console.log("（--dry-run，未写入文件）");
} else {
  writeFileSync(path.join(DATA, "reviews.real.json"), JSON.stringify([...existing, ...newReviews], null, 2) + "\n");
  writeFileSync(path.join(DATA, "analysis.real.json"), JSON.stringify([...existingAnalysis, ...newAnalysis], null, 2) + "\n");
  console.log("已写入 data/v1/reviews.real.json 与 analysis.real.json。请运行 npm run check 后提交，推送到 main 会自动发布。");
}
