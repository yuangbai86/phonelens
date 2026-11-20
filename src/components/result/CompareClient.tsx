"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { dataset } from "@/lib/data";
import { buildComparison } from "@/lib/recommend/compare";
import { needsOf, parseCompareParams } from "@/lib/query";
import { AI_DISABLED_TEXT, BACKEND_ENABLED, apiUrl } from "@/lib/runtime";
import { ResultView } from "./ResultView";
import Loading from "@/app/compare/loading";

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <section className="empty-state enter">
      <h1>{title}</h1>
      <p>{body}</p>
      <div className="actions">
        <Link className="btn btn-primary" href="/">
          返回选择机型
        </Link>
        <Link className="btn" href="/data">
          查看已收录目录
        </Link>
      </div>
    </section>
  );
}

const SOURCE_NAMES = Object.fromEntries(dataset.sources.map((s) => [s.id, s.name]));

export function CompareClient() {
  const sp = useSearchParams();
  const params = useMemo(() => Object.fromEntries(sp.entries()), [sp]);
  const parsed = useMemo(() => parseCompareParams(params), [params]);
  const c = useMemo(() => (parsed.ok ? buildComparison(dataset, parsed.input.a, parsed.input.b, needsOf(parsed.input), parsed.input.window) : null), [parsed]);

  // 只有配置了独立后端时才询问 AI 是否可用；静态版本直接显示“暂未启用”
  const [ai, setAi] = useState<{ available: boolean; reason: string | null } | null>(BACKEND_ENABLED ? null : { available: false, reason: AI_DISABLED_TEXT });
  useEffect(() => {
    if (!BACKEND_ENABLED) return;
    fetch(apiUrl("/api/status"))
      .then((r) => r.json())
      .then((d: { ai: boolean }) => setAi({ available: !!d.ai, reason: d.ai ? null : "后端未启用 AI 解释。结论按固定规则得出。" }))
      .catch(() => setAi({ available: false, reason: "暂时连不上后端，结论按固定规则在浏览器中得出。" }));
  }, []);

  if (!parsed.ok) return <Empty title="对比条件不完整" body="需要从目录中选择两款手机。请返回首页重新选择。" />;
  if (!c) return <Loading />;
  if ("error" in c) {
    if (c.error === "same_phone") return <Empty title="两款机型相同" body="请选择两款不同的手机进行对比。" />;
    return <Empty title="暂未收录该机型" body="链接中的机型不在当前目录里。不会自动替换为名称相近的机型，请从目录中重新选择。" />;
  }
  if (!ai) return <Loading />;
  return <ResultView key={`${c.a.id}:${c.b.id}`} initial={c} aiInitial={ai} sourceNames={SOURCE_NAMES} />;
}
