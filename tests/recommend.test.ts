import { describe, expect, it } from "vitest";
import { dataset } from "@/lib/data";
import { buildComparison, type Comparison } from "@/lib/recommend/compare";
import { decideStatus, type Verdict } from "@/lib/recommend/engine";
import { budgetFit, fairnessWarnings, pickPrice } from "@/lib/rules";
import { buildPack, cacheKey, statusAllowed, validateExplanation, checkNumbers } from "@/lib/recommend/ai-explain";
import { reviewSignal } from "@/lib/recommend/engine";
import { computeStats, compareSamples } from "@/lib/stats";
import type { PhoneRecord, PriceRecord, UserNeeds } from "@/lib/types";

const needs = (n: Partial<UserNeeds>): UserNeeds => ({ budget: null, prefs: ["handling"], device: null, eco: [], ...n });
const cmp = (a: string, b: string, n: Partial<UserNeeds>, w: "90d" | "all" = "90d") => {
  const c = buildComparison(dataset, a, b, needs(n), w);
  if ("error" in c) throw new Error(c.error);
  return c;
};

const v = (side: Verdict["side"], strength: Verdict["strength"] = "strong", basis: Verdict["basis"] = "spec"): Verdict => ({ pref: "handling", side, strength, basis, claims: [], caveat: null });

describe("推荐状态规则", () => {
  it("首要偏好证据不足时返回证据不足", () => {
    expect(decideStatus(v("unknown", null), v("a")).status).toBe("insufficient");
  });
  it("首要由参数给出较明确差异、且其次不反对时才推荐", () => {
    expect(decideStatus(v("a"), undefined).status).toBe("prefer_a");
    expect(decideStatus(v("b"), v("even", null)).status).toBe("prefer_b");
  });
  it("其次方向相反（即使较弱）时为各有取舍，并保留倾向", () => {
    expect(decideStatus(v("a"), v("b"))).toEqual({ status: "tradeoff", lean: "a" });
    expect(decideStatus(v("a"), v("b", "weak", "reviews"))).toEqual({ status: "tradeoff", lean: "a" });
  });
  it("首要优势较弱时不强行选出胜者", () => {
    expect(decideStatus(v("a", "weak"), undefined).status).toBe("tradeoff");
  });
  it("只有口碑信号时，最多给出“各有取舍”的倾向，不给“更值得考虑”", () => {
    expect(decideStatus(v("b", "weak", "reviews"), undefined)).toEqual({ status: "tradeoff", lean: "b" });
    expect(decideStatus(v("b", "strong", "reviews"), v("b", "weak", "reviews")).status).toBe("tradeoff");
    expect(decideStatus(v("even", null), v("a", "strong", "reviews")).status).toBe("tradeoff");
  });
});

describe("口碑只做定性描述，不判定胜负", () => {
  it("不论条数差多少，评论都不给方向（不做显著性检验）", () => {
    for (const p of ["battery", "camera", "gaming", "ecosystem"] as const) {
      const c = cmp("demo-alpha", "demo-beta", { prefs: [p] });
      expect(c.recommendation.verdicts[0].side, p).toBe("unknown");
      expect(c.recommendation.status, p).toBe("insufficient");
    }
  });

  it("口碑说明写出条数与分母，并声明只作定性参考", () => {
    const c = cmp("demo-alpha", "demo-beta", { prefs: ["battery"] });
    const t = c.recommendation.verdicts[0].claims[0].text;
    expect(t).toContain("A 已分析 26 条中提到续航 6 条（正面 1、负面 2、褒贬混合 1）");
    expect(t).toContain("只作定性参考");
    expect(t).not.toMatch(/更正面|占优|反馈相对更多/);
    expect(t).toContain("不据此判断哪款体验更好");
  });

  it("只有参数能给出方向：轻便看重量，续航评论不再构成反方向", () => {
    const c = cmp("demo-alpha", "demo-beta", { prefs: ["handling", "battery"] });
    expect(c.recommendation.verdicts[0].side).toBe("a");
    expect(c.recommendation.verdicts[1].side).toBe("unknown");
    expect(c.recommendation.status).toBe("prefer_a");
  });

  it("没有任何评论时不生成口碑描述的数字", () => {
    const c = cmp("apple-iphone-17-256", "xiaomi-17-256", { prefs: ["battery"] });
    expect(c.recommendation.verdicts[0].claims[0].text).toContain("都还没有已分析的评论");
    expect(c.recommendation.status).toBe("insufficient");
  });

  it("reviewSignal 永远不返回方向", () => {
    const c = cmp("demo-alpha", "demo-beta", { prefs: ["battery"] });
    const sig = reviewSignal(
      {
        names: { a: "A", b: "B" },
        hasSpecs: { a: true, b: true },
        hasReviews: { a: true, b: true },
        specs: { get: () => undefined },
        stats: { a: c.stats.a as never, b: c.stats.b as never },
        comparability: { comparable: true, reasons: [] },
        needs: c.needs,
        budget: { a: { kind: "unknown" }, b: { kind: "unknown" } },
        priceIds: { a: null, b: null },
      },
      "battery",
    );
    expect(sig.side).toBe("unknown");
    expect(sig.strength).toBeNull();
  });
});

describe("演示数据完整流程", () => {
  it("轻便优先、续航其次：重量差异明确时推荐更轻的一款，续航评论不参与判断，每条判断都有有效证据", () => {
    const c = cmp("demo-alpha", "demo-beta", { prefs: ["handling", "battery"], budget: 6000 });
    expect(c.recommendation.status).toBe("prefer_a");
    expect(c.recommendation.lean).toBe("a");
    const claims = [...c.recommendation.summary, ...c.recommendation.reasons, ...c.recommendation.tradeoffs, ...c.recommendation.verdicts.flatMap((x) => x.claims)];
    for (const cl of claims) for (const id of cl.evidence) expect(c.evidence[id], id).toBeDefined();
  });

  it("修改偏好后推荐理由随之变化", () => {
    const a = cmp("demo-alpha", "demo-beta", { prefs: ["handling", "battery"] });
    const b = cmp("demo-alpha", "demo-beta", { prefs: ["battery"] });
    expect(b.recommendation.status).toBe("insufficient");
    expect(b.recommendation.summary[0].text).not.toBe(a.recommendation.summary[0].text);
  });

  it("游戏偏好不从芯片名称推出结论，并写明测试缺口", () => {
    const c = cmp("demo-alpha", "demo-gamma", { prefs: ["gaming"] });
    expect(c.recommendation.status).toBe("insufficient");
    expect(c.recommendation.verdicts[0].caveat).toContain("不足以判断");
  });

  it("只有参数的机型：不生成口碑判断", () => {
    const c = cmp("demo-alpha", "demo-gamma", { prefs: ["camera"] });
    expect(c.b.state).toBe("specs_only");
    expect(c.recommendation.verdicts[0].side).toBe("unknown");
  });

  it("只有评论的机型：硬件判断受限", () => {
    const c = cmp("demo-delta", "demo-alpha", { prefs: ["handling"] }, "all");
    expect(c.a.state).toBe("reviews_only");
    expect(c.specRows.find((r) => r.field === "weight_g")?.a.missing).toBe(true);
    expect(c.recommendation.status).not.toBe("prefer_b");
  });

  it("两者都没有数据：证据不足，并提供下一步", () => {
    const c = cmp("demo-alpha", "vivo-x200-256", { prefs: ["battery"] });
    expect(c.b.state).toBe("none");
    expect(c.recommendation.status).toBe("insufficient");
    expect(c.recommendation.summary.map((s) => s.text).join("")).toContain("导入");
  });

  it("真实机型的每个参数值都有官网来源与核对日期，缺失项保留原因", () => {
    const real = dataset.specs.filter((x) => x.data_kind === "real");
    for (const s of real) {
      if (s.value === null) {
        expect(s.missing_reason, s.id).not.toBeNull();
        continue;
      }
      const src = dataset.sources.find((x) => x.id === s.source_id);
      expect(src?.kind, s.id).toBe("official_spec");
      expect(["official_checked", "human_verified"]).toContain(src?.verification);
      expect(src?.url).toMatch(/^https:\/\/www\.(apple\.com\.cn|mi\.com)\//);
      expect(s.verified_at, s.id).toBe("2026-11-22");
    }
    // 官网未公开的字段保持缺失，不填数字
    const v = (id: string) => real.find((x) => x.id === id);
    expect(v("spec:apple-iphone-17-256:battery_mah")).toMatchObject({ value: null, missing_reason: "官网未列出" });
    expect(v("spec:apple-iphone-17-256:ram_gb")).toMatchObject({ value: null, missing_reason: "官网未列出" });
    expect(v("spec:apple-iphone-17-256:wired_charging_w")).toMatchObject({ value: null, missing_reason: "官网未列出" });
    expect(v("spec:xiaomi-17-256:ram_gb")?.value).toBeNull();
    // 未收录的机型仍然全部为空
    expect(dataset.specs.filter((x) => x.phone_id === "vivo-x200-256" && x.value !== null)).toHaveLength(0);
    // 价格：只有核对到的 iPhone 17 256GB 在线商店标价；小米 17 256GB 价格未核实，不记录
    const realPrices = dataset.prices.filter((p) => p.data_kind === "real");
    expect(realPrices).toHaveLength(1);
    expect(realPrices[0]).toMatchObject({ phone_id: "apple-iphone-17-256", storage: "256GB", amount: 6799, price_type: "official_current" });
    // 真实评论尚未收录
    expect(dataset.reviews.filter((r) => r.data_kind === "real")).toHaveLength(0);
  });

  it("iPhone 17 对比小米 17：只用官网参数，不依据评论判断", () => {
    const c = cmp("apple-iphone-17-256", "xiaomi-17-256", { prefs: ["handling", "camera"] });
    expect(c.a.state).toBe("specs_only");
    expect(c.b.state).toBe("specs_only");
    const w = c.recommendation.verdicts[0];
    expect(w.claims[0].text).toContain("A 177 g，B 191 g");
    expect(w.side).toBe("a");
    expect(c.recommendation.verdicts[1].side).toBe("unknown");
    expect(c.recommendation.verdicts[1].claims.map((x) => x.text).join("")).toContain("长焦配置");
    expect(c.b.price).toBeNull();
    expect(c.b.price_note).toContain("起售价");
    expect(c.warnings.map((x) => x.code)).toContain("price_missing");
  });

  it("同一机型或未知机型返回错误，不做相似名称替换", () => {
    expect(buildComparison(dataset, "demo-alpha", "demo-alpha", needs({}))).toEqual({ error: "same_phone" });
    expect(buildComparison(dataset, "demo-alpha", "iphone-99", needs({}))).toMatchObject({ error: "unknown_phone" });
  });
});

describe("价格口径", () => {
  const ph = (id: string, storage = "256GB"): PhoneRecord => ({ id, brand: "x", model: id, aliases: [], region: "", storage, ram: null, sale_status: "demo", verified_at: null, data_kind: "demo", note: "" });
  const pr = (phone_id: string, amount: number, price_type: PriceRecord["price_type"], storage = "256GB"): PriceRecord => ({
    id: `price:${phone_id}`, phone_id, storage, amount, currency: "CNY", price_type, channel: "", conditions: null, recorded_at: "2026-11-01", source_id: null, data_kind: "demo",
  });
  it("价格类型不同、容量不同、价差大时分别提示", () => {
    const w = fairnessWarnings(ph("a"), ph("b", "512GB"), pr("a", 4000, "official_current"), pr("b", 6000, "official_msrp", "512GB"));
    expect(w.map((x) => x.code).sort()).toEqual(["price_gap", "price_type_mismatch", "storage_mismatch"]);
  });
  it("价差未超过 30% 不提示", () => {
    const w = fairnessWarnings(ph("a"), ph("b"), pr("a", 5000, "official_current"), pr("b", 6400, "official_current"));
    expect(w).toHaveLength(0);
  });
  it("缺少价格时不生成价格结论", () => {
    expect(fairnessWarnings(ph("a"), ph("b"), null, pr("b", 1, "official_current"))[0].code).toBe("price_missing");
    expect(budgetFit(5000, null)).toEqual({ kind: "no_price" });
  });
  it("优先使用当前售价，不把建议零售价改名为现价", () => {
    const p = pickPrice([pr("a", 5000, "official_msrp"), { ...pr("a", 4800, "official_current"), id: "x" }], ph("a"));
    expect(p?.price_type).toBe("official_current");
    const only = pickPrice([pr("a", 5000, "official_msrp")], ph("a"));
    expect(only?.price_type).toBe("official_msrp");
  });
  it("用户填写价格标为未核验", () => {
    expect(pickPrice([], ph("a"), 3999)?.price_type).toBe("user_reported");
  });
  it("推荐的一款超预算而另一款在预算内时降级为各有取舍", () => {
    const c = cmp("demo-alpha", "demo-beta", { prefs: ["handling"], budget: 5000 });
    expect(c.recommendation.status).toBe("tradeoff");
    expect(c.recommendation.lean).toBe("a");
    expect(c.recommendation.tradeoffs[0].text).toContain("超出你的预算");
  });
});

describe("AI 输出校验", () => {
  const c: Comparison = cmp("demo-alpha", "demo-beta", { prefs: ["handling", "battery"], budget: 5000 });
  const pack = buildPack(c);
  const wA = "spec:demo-alpha:weight_g";
  const wB = "spec:demo-beta:weight_g";
  const ok = (cl: { text: string; evidence: string[]; figures: string[] }) => checkNumbers(cl, pack);

  it("材料不包含评论原文（降低注入风险）", () => {
    expect(JSON.stringify(pack)).not.toContain("忽略之前的所有指令");
  });

  it("非法引用编号的句子被删除，不替换为相近引用", () => {
    const out = validateExplanation(
      {
        status: "tradeoff",
        summary: [{ text: "两款各有取舍。", evidence: [], figures: [] }],
        reasons: [
          { text: "A 更轻。", evidence: [wA], figures: [] },
          { text: "B 续航更好。", evidence: ["stat:demo-beta:battery:30d"], figures: [] },
        ],
        tradeoffs: [],
        questions: [],
      },
      pack,
    );
    expect(out.reasons).toHaveLength(1);
    expect(out.issues.some((i) => i.problem === "unknown_evidence")).toBe(true);
    expect(out.usable).toBe(true);
  });

  describe("数字必须对应机型、字段、单位与情境", () => {
    it("正确引用时通过", () => {
      expect(ok({ text: "A 重 178 g，B 重 214 g，A 轻 36 g。", evidence: [wA, wB], figures: ["A.weight_g", "B.weight_g", "diff.weight_g"] })).toEqual([]);
      expect(ok({ text: "A 的价格是 ¥5,999，比你的预算 5000 元多 999 元。", evidence: ["price:demo-alpha:256"], figures: ["A.price", "user.budget", "A.over_budget"] })).toEqual([]);
      expect(
        ok({ text: "已收录样本中提到续航的评论里，B 有 7 条正面、0 条负面（已分析 28 条）。", evidence: ["stat:demo-beta:battery:90d"], figures: ["B.battery.pos", "B.battery.neg", "B.analyzed_n"] }),
      ).toEqual([]);
    });
    it("把 B 的重量写成 A 的：主体不符", () => {
      expect(ok({ text: "A 重 214 g。", evidence: [wB], figures: ["B.weight_g"] })[0].reason).toBe("subject_mismatch");
    });
    it("数字在材料中出现过但字段或单位不同：拒绝", () => {
      // 30 在材料中是 A 的有线充电 30 W，不能写成 30 小时续航
      expect(ok({ text: "A 续航可达 30 小时。", evidence: ["spec:demo-alpha:wired_charging_w"], figures: ["A.wired_charging_w"] })[0].reason).toBe("value_or_unit_mismatch");
      // 178 是重量，不能当作充电功率
      expect(ok({ text: "A 支持 178 W 快充。", evidence: [wA], figures: ["A.weight_g"] })[0].reason).toBe("value_or_unit_mismatch");
    });
    it("单位对但措辞不符：拒绝（重量数字出现在充电语境）", () => {
      const r = ok({ text: "A 的充电速度是 178 g。", evidence: [wA], figures: ["A.weight_g"] });
      expect(r[0].reason).toBe("context_missing");
    });
    it("评论数必须紧跟对应情绪：把负面条数写成正面被拒绝", () => {
      const r = ok({ text: "提到续航的评论中，A 有 2 条正面。", evidence: ["stat:demo-alpha:battery:90d"], figures: ["A.battery.neg"] });
      expect(r[0].reason).toBe("context_missing");
    });
    it("未说明是哪款、未引用事实、引用了不存在的事实、证据缺失：均拒绝", () => {
      expect(ok({ text: "重量是 178 g。", evidence: [wA], figures: ["A.weight_g"] })[0].reason).toBe("subject_missing");
      expect(ok({ text: "A 重 178 g。", evidence: [wA], figures: [] })[0].reason).toBe("no_figure");
      expect(ok({ text: "A 重 178 g。", evidence: [wA], figures: ["A.weight_kg"] }).map((x) => x.reason)).toContain("unknown_figure");
      expect(ok({ text: "A 重 178 g。", evidence: [], figures: ["A.weight_g"] })[0].reason).toBe("evidence_missing");
    });
    it("机型名称、芯片名、日期中的数字不当作数据", () => {
      expect(ok({ text: "A（演示品牌甲 Alpha）使用演示芯片 X1，记录于 2026-11-18。", evidence: [], figures: [] })).toEqual([]);
    });
    it("问题中不允许出现数字", () => {
      const out = validateExplanation(
        { status: "tradeoff", summary: [{ text: "各有取舍。", evidence: [], figures: [] }], reasons: [{ text: "A 更轻。", evidence: [wA], figures: [] }], tradeoffs: [], questions: ["你每天玩 3 小时游戏吗？", "你常用哪些配件？"] },
        pack,
      );
      expect(out.questions).toEqual(["你常用哪些配件？"]);
    });
  });

  it("理由必须带证据", () => {
    const out = validateExplanation({ status: "tradeoff", summary: [{ text: "各有取舍。", evidence: [], figures: [] }], reasons: [{ text: "A 更好。", evidence: [], figures: [] }], tradeoffs: [], questions: [] }, pack);
    expect(out.reasons).toHaveLength(0);
    expect(out.usable).toBe(false);
  });

  it("不得比基础模式更激进或翻转方向", () => {
    expect(statusAllowed("tradeoff", "prefer_a")).toBe(false);
    expect(statusAllowed("prefer_a", "prefer_b")).toBe(false);
    expect(statusAllowed("prefer_a", "insufficient")).toBe(true);
    const out = validateExplanation({ status: "prefer_a", summary: [{ text: "推荐 A。", evidence: [wA], figures: [] }], reasons: [{ text: "A 更轻。", evidence: [wA], figures: [] }], tradeoffs: [], questions: [] }, pack);
    expect(out.status).toBe(pack.baseline.status);
    expect(out.issues[0].problem).toBe("status_upgrade");
  });

  it("结构不合法时不可用", () => {
    expect(validateExplanation({ hello: 1 }, pack).usable).toBe(false);
    expect(validateExplanation("not json", pack).usable).toBe(false);
  });
});

describe("缓存键", () => {
  const base = {
    a: "demo-alpha", b: "demo-beta", storage: ["256GB", "256GB"] as [string, string], priceVersion: "p1", dataVersion: "d1", labelVersion: "l1",
    window: "90d", prefs: ["handling", "battery"], budget: 6000, device: null, eco: ["mac", "ipad"], promptVersion: "r1", model: "m",
  };
  it("偏好、顺序、数据、标签、价格、提示词、模型、样本筛选任一变化都使缓存失效", () => {
    const k = cacheKey(base);
    expect(cacheKey({ ...base, prefs: ["battery", "handling"] })).not.toBe(k);
    expect(cacheKey({ ...base, prefs: ["handling"] })).not.toBe(k);
    expect(cacheKey({ ...base, dataVersion: "d2" })).not.toBe(k);
    expect(cacheKey({ ...base, labelVersion: "l2" })).not.toBe(k);
    expect(cacheKey({ ...base, priceVersion: "p2" })).not.toBe(k);
    expect(cacheKey({ ...base, promptVersion: "r2" })).not.toBe(k);
    expect(cacheKey({ ...base, model: "m2" })).not.toBe(k);
    expect(cacheKey({ ...base, window: "all" })).not.toBe(k);
    expect(cacheKey({ ...base, budget: 5000 })).not.toBe(k);
    expect(cacheKey({ ...base, storage: ["256GB", "512GB"] })).not.toBe(k);
  });
  it("配套设备顺序不影响缓存键", () => {
    expect(cacheKey({ ...base, eco: ["ipad", "mac"] })).toBe(cacheKey(base));
  });
});
