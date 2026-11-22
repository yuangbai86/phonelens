/**
 * 评论维度标注的输出结构（浏览器与服务端共用）。
 * 不论来自 API、本地脚本还是用户从 Claude 对话中复制回来的 JSON，都先按这个结构解析，再由 validateLabels 逐条校验。
 */
import { z } from "zod";

export const ExtractSchema = z.object({
  labels: z
    .array(
      z.object({
        review_id: z.string().max(60),
        dimension: z.enum(["battery", "heat", "camera", "smoothness", "stability", "handling", "shopping"]),
        sentiment: z.enum(["pos", "neg", "neu", "mixed"]),
        excerpt: z.string().max(400),
        issue: z.string().max(60).optional().default(""),
        explanation: z.string().max(120).optional().default(""),
      }),
    )
    .max(400),
  unclear: z.array(z.string().max(60)).max(200).optional().default([]),
  no_dimension: z.array(z.string().max(60)).max(200).optional().default([]),
});
export type ExtractOutput = z.infer<typeof ExtractSchema>;
