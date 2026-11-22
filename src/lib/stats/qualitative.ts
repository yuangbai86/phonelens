/**
 * 小样本的定性总结：按维度列出提及条数（带分母）和有原文依据的具体问题。
 * 不计算比例差异、不做显著性检验、不比较两款优劣。
 */
import type { Dimension, Sentiment } from "../types";
import { DIMENSIONS } from "../types";
import type { ReviewView, SampleStats } from "./index";

export interface QualItem {
  review_id: string;
  sentiment: Sentiment;
  issue: string | null;
  excerpt: string;
}

export interface QualDim {
  dimension: Dimension;
  mentions: number;
  pos: number;
  neg: number;
  mixed: number;
  neu: number;
  items: QualItem[];
}

export interface QualSummary {
  n: number;
  dims: QualDim[];
}

const ORDER: Record<Sentiment, number> = { neg: 0, mixed: 1, pos: 2, neu: 3 };

export function qualitativeSummary(stats: Pick<SampleStats, "n" | "dims">, views: Pick<ReviewView, "status" | "labels">[], maxItems = 4): QualSummary {
  const counted = views.filter((v) => v.status.kind === "counted");
  const dims: QualDim[] = [];
  for (const d of DIMENSIONS) {
    const s = stats.dims[d];
    if (s.mentions === 0) continue;
    const items: QualItem[] = [];
    for (const v of counted) {
      const l = v.labels.find((x) => x.dimension === d);
      if (l) items.push({ review_id: l.review_id, sentiment: l.sentiment, issue: l.issue ?? null, excerpt: l.excerpt });
    }
    items.sort((x, y) => ORDER[x.sentiment] - ORDER[y.sentiment]);
    dims.push({ dimension: d, mentions: s.mentions, pos: s.pos, neg: s.neg, mixed: s.mixed, neu: s.neu, items: items.slice(0, maxItems) });
  }
  dims.sort((a, b) => b.mentions - a.mentions);
  return { n: stats.n, dims };
}
