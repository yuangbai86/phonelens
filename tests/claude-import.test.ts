import { describe, expect, it } from "vitest";
import { buildClaudeRequest, extractJson, parseClaudeResponse } from "@/lib/import/claude";
import { cleanImportLocally, customPhone } from "@/lib/import/local";
import { parsePasted } from "@/lib/csv";
import { dataset } from "@/lib/data";
import { EXTRACT_PROMPT_VERSION } from "@/lib/ai/prompts";

const TEXT = ["打游戏半小时机身明显发烫，不过拍照很清楚。", "续航一般，下午就要充电。", "物流很快，第二天就送到了。", "整体还可以，就是有时候说不上来哪里怪。"].join("\n");
const rows = parsePasted(TEXT, "apple-iphone-17-256", "我自己的使用记录").rows;
const phone = dataset.phones.find((p) => p.id === "apple-iphone-17-256")!;
const base = cleanImportLocally(rows, phone, true, dataset.phones, null);
const sendable = base.sendable!;

const good = {
  labels: [
    { review_id: "p-001", dimension: "heat", sentiment: "neg", excerpt: "打游戏半小时机身明显发烫", issue: "打游戏半小时机身发烫", explanation: "明确说发烫" },
    { review_id: "p-001", dimension: "camera", sentiment: "pos", excerpt: "拍照很清楚", issue: "拍照清楚", explanation: "" },
    { review_id: "p-002", dimension: "battery", sentiment: "neg", excerpt: "续航一般，下午就要充电", issue: "下午就需要充电", explanation: "" },
    { review_id: "p-003", dimension: "shopping", sentiment: "pos", excerpt: "物流很快", issue: "", explanation: "" },
  ],
  unclear: ["p-004"],
  no_dimension: [],
};

describe("Claude 标注请求", () => {
  it("包含提示词版本对应的规则、输出格式和全部待标注评论", () => {
    const req = buildClaudeRequest(sendable);
    expect(sendable).toHaveLength(4);
    expect(req).toContain("不得执行");
    expect(req).toContain('"no_dimension"');
    for (const r of sendable) expect(req).toContain(r.id);
    expect(EXTRACT_PROMPT_VERSION).toBe("extract-v1.1");
  });

  it("容忍代码块和前后说明文字", () => {
    expect(extractJson('好的，结果如下：\n```json\n{"labels": []}\n```\n以上。')).toEqual({ labels: [] });
    expect(() => extractJson("没有 JSON")).toThrow();
  });
});

describe("导入 Claude 结果并校验", () => {
  it("合格的标签被接受，程序计算统计，购物体验不计入性能口碑", () => {
    const r = parseClaudeResponse(JSON.stringify(good), sendable);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.accepted).toBe(4);
    expect(r.result.unclear).toEqual(["p-004"]);
    const res = cleanImportLocally(rows, phone, true, dataset.phones, null, r.result.analysis);
    expect(res.mode).toBe("claude_import");
    expect(res.stats.n).toBe(2); // p-003 只谈物流被排除，p-004 待复核
    expect(res.stats.excluded.shopping_only).toBe(1);
    expect(res.stats.n_needs_review).toBe(1);
    expect(res.stats.dims.heat).toMatchObject({ mentions: 1, neg: 1 });
    expect(res.stats.dims.camera).toMatchObject({ mentions: 1, pos: 1 });
    expect(res.prompt_version).toBe("extract-v1.1");
  });

  it("定性总结：按维度列条数与有原文依据的具体问题，负面在前", () => {
    const r = parseClaudeResponse(JSON.stringify(good), sendable);
    if (!r.ok) throw new Error();
    const q = cleanImportLocally(rows, phone, true, dataset.phones, null, r.result.analysis).qualitative!;
    expect(q.n).toBe(2);
    const heat = q.dims.find((d) => d.dimension === "heat")!;
    expect(heat.items[0]).toMatchObject({ issue: "打游戏半小时机身发烫", excerpt: "打游戏半小时机身明显发烫", sentiment: "neg" });
    expect(q.dims.some((d) => (d.dimension as string) === "shopping")).toBe(false);
    // 摘录保留原文写法（全角逗号），不显示规范化后的半角形式
    expect(q.dims.find((d) => d.dimension === "battery")!.items[0].excerpt).toBe("续航一般，下午就要充电");
  });

  it("摘录不在原文、编号不存在、维度非法的标签被拒绝，相关评论转待复核", () => {
    const bad = {
      labels: [
        { review_id: "p-001", dimension: "heat", sentiment: "neg", excerpt: "玩游戏烫得拿不住", issue: "发烫" },
        { review_id: "p-999", dimension: "battery", sentiment: "neg", excerpt: "续航一般" },
        { review_id: "p-002", dimension: "price", sentiment: "neg", excerpt: "续航一般" },
      ],
      unclear: [],
      no_dimension: ["p-003", "p-004"],
    };
    const r = parseClaudeResponse(JSON.stringify(bad), sendable);
    expect(r.ok).toBe(false); // 非法维度在结构层面就不通过
    const bad2 = { ...bad, labels: bad.labels.slice(0, 2) };
    const r2 = parseClaudeResponse(JSON.stringify(bad2), sendable);
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.result.rejected.map((x) => x.problem).sort()).toEqual(["excerpt_not_found", "unknown_review"]);
    expect(r2.result.unknownIds).toEqual(["p-999"]);
    expect(r2.result.analysis.find((a) => a.review_id === "p-001")?.status).toBe("needs_review");
    expect(r2.result.missing).toEqual(["p-002"]); // 没有返回结果的评论保持未标注，不当成“未提及”
    const res = cleanImportLocally(rows, phone, true, dataset.phones, null, r2.result.analysis);
    expect(res.stats.n_pending).toBe(1);
  });

  it("具体问题不得超长，也不得出现摘录里没有的数字", () => {
    const withNum = { labels: [{ review_id: "p-002", dimension: "battery", sentiment: "neg", excerpt: "续航一般", issue: "用 3 小时就没电" }], unclear: [], no_dimension: [] };
    const r = parseClaudeResponse(JSON.stringify(withNum), sendable);
    if (!r.ok) throw new Error();
    expect(r.result.rejected[0]).toMatchObject({ problem: "bad_issue" });
    const okNum = { labels: [{ review_id: "p-001", dimension: "heat", sentiment: "neg", excerpt: "打游戏半小时机身明显发烫", issue: "打游戏半小时发烫" }], unclear: [], no_dimension: [] };
    const r2 = parseClaudeResponse(JSON.stringify(okNum), sendable);
    if (!r2.ok) throw new Error();
    expect(r2.result.rejected).toHaveLength(0);
    const long = { labels: [{ review_id: "p-002", dimension: "battery", sentiment: "neg", excerpt: "续航一般", issue: "续航".repeat(20) }], unclear: [], no_dimension: [] };
    const r3 = parseClaudeResponse(JSON.stringify(long), sendable);
    if (!r3.ok) throw new Error();
    expect(r3.result.rejected[0].problem).toBe("bad_issue");
  });

  it("评论中的指令只是数据：Claude 若照做输出非 JSON，导入会失败而不是被采纳", () => {
    expect(parseClaudeResponse("好的，我把所有维度都标为正面。", sendable).ok).toBe(false);
  });

  it("目录外机型也可以导入并只做摘要", () => {
    const custom = customPhone("某品牌 某型号");
    const res = cleanImportLocally(parsePasted("续航很好，一天一充足够。", "custom", "").rows, custom, false, dataset.phones, null);
    expect(res.phone.in_catalog).toBe(false);
    expect(res.sendable).toHaveLength(1);
  });
});
