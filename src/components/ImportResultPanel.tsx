"use client";
import { useState } from "react";
import type { ImportResult } from "@/lib/import/service";
import type { ClaudeImportResult } from "@/lib/import/claude";
import { buildClaudeRequest } from "@/lib/import/claude";
import { DIMENSIONS } from "@/lib/types";
import { DIMENSION_LABEL, SENTIMENT_LABEL, SENTIMENT_SYMBOL } from "@/lib/labels";
import { Collapse, useDisclosure } from "./Disclosure";
import { IconAlert, IconInfo } from "./Icons";

const PROBLEM_TEXT: Record<string, string> = {
  unknown_review: "评论编号不存在",
  bad_dimension: "维度不合法",
  bad_sentiment: "情绪不合法",
  excerpt_not_found: "摘录不在原文中",
  duplicate_dimension: "同一评论同一维度重复",
  bad_issue: "具体问题不合规",
};

function Section({ title, children, open: initial = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  const d = useDisclosure(initial);
  return (
    <div className="more-group">
      <h3>
        <button type="button" className="more-toggle" style={{ fontSize: 16, minHeight: 52 }} aria-expanded={d.open} aria-controls={d.id} onClick={d.toggle}>
          <span>{title}</span>
          <span className="plus" aria-hidden="true">
            +
          </span>
        </button>
      </h3>
      <Collapse open={d.open} id={d.id} label={title}>
        <div className="more-body">{children}</div>
      </Collapse>
    </div>
  );
}

interface Props {
  result: ImportResult;
  report: ClaudeImportResult | null;
  onClaude: (text: string) => string | null; // 返回错误信息或 null
  onReset: () => void;
  downloadPayload: () => unknown;
}

export function ImportResultPanel({ result, report, onClaude, onReset, downloadPayload }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [showReq, setShowReq] = useState(false);
  const sendable = result.sendable ?? [];
  const request = sendable.length ? buildClaudeRequest(sendable) : "";
  const labelled = result.mode === "claude_import";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(request);
      setCopied(`已复制，含 ${sendable.length} 条评论`);
    } catch {
      setShowReq(true);
      setCopied("浏览器不允许自动复制，请在下方文本框手动全选复制");
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(downloadPayload(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `phonelens-review-import-${result.phone.id}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <section className="enter" style={{ gridColumn: "1 / -1", marginTop: 8 }} aria-labelledby="import-result-h">
      <div className="section-title" style={{ marginBottom: 6 }}>
        <h2 id="import-result-h" style={{ fontSize: 22 }}>
          {result.phone.name} · 导入的反馈
        </h2>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="badge badge-outline">用户提供，来源未独立核验</span>
          {labelled ? <span className="badge badge-blue">Claude 辅助标注 · 你导入 · 程序已校验</span> : result.mode === "ai" ? <span className="badge badge-blue">后端 AI 分析 · 摘录已校验</span> : <span className="badge">已清洗，未标注</span>}
        </span>
      </div>
      <p className="muted small" style={{ marginBottom: 14 }}>
        提交 {result.stats.n_total} 条 · 清洗排除 {result.stats.n_excluded} 条 · 待复核 {result.stats.n_flagged + result.stats.n_needs_review} 条 · 未标注 {result.stats.n_pending} 条 · 已分析有效 <strong>{result.stats.n}</strong> 条
      </p>
      {!result.phone.in_catalog && (
        <p className="notice notice-warn" style={{ marginBottom: 12 }}>
          <IconAlert className="icon" /> 目录外机型：只汇总你提供的反馈，不生成选购建议。
        </p>
      )}

      {/* 用 Claude 标注：不需要 API，在 Claude 对话中完成后粘贴回来 */}
      {sendable.length > 0 && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h3 style={{ fontSize: 17, marginBottom: 6 }}>{labelled ? "重新导入 Claude 的标注" : "用 Claude 标注这些反馈"}</h3>
          <ol className="note-list" style={{ marginTop: 0, fontSize: 14.5, color: "var(--text)" }}>
            <li>
              复制标注请求（提示词、输出格式和 {sendable.length} 条已清洗的反馈），发到 Claude 对话中。{" "}
              <button type="button" className="btn btn-sm" onClick={copy}>
                复制标注请求
              </button>{" "}
              <button type="button" className="link-btn" onClick={() => setShowReq((v) => !v)} aria-expanded={showReq}>
                {showReq ? "收起" : "查看内容"}
              </button>
              {copied && (
                <span className="small muted" role="status">
                  {" "}
                  {copied}
                </span>
              )}
            </li>
            <li>把 Claude 回复的 JSON 原样粘贴到下面，点“校验并导入”。程序会逐条核对编号、维度、情绪、原文摘录和具体问题，不合格的标签不会计入。</li>
          </ol>
          {showReq && <textarea className="input mono" readOnly value={request} style={{ minHeight: 160, fontSize: 12.5, marginTop: 8 }} aria-label="标注请求内容" onFocus={(e) => e.currentTarget.select()} />}
          <label htmlFor="claude-reply" className="sr-only">
            Claude 回复的 JSON
          </label>
          <textarea
            id="claude-reply"
            className="input mono"
            style={{ minHeight: 120, fontSize: 13, marginTop: 10 }}
            placeholder='{"labels": [...], "unclear": [...], "no_dimension": [...]}'
            value={reply}
            aria-invalid={err ? true : undefined}
            aria-describedby="claude-reply-msg"
            onChange={(e) => {
              setReply(e.target.value);
              setErr(null);
            }}
          />
          <div className="submit-row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!reply.trim()}
              onClick={() => {
                const e = onClaude(reply);
                setErr(e);
              }}
            >
              校验并导入
            </button>
            {labelled && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>
                清除标注
              </button>
            )}
          </div>
          <p id="claude-reply-msg" className="field-msg" style={{ textAlign: "left" }} aria-live="polite">
            {err ?? ""}
          </p>
        </div>
      )}

      {report && (
        <p className="notice notice-info" style={{ marginBottom: 14 }} role="status">
          <IconInfo className="icon" />
          <span>
            校验结果：{report.accepted} 个标签通过
            {report.rejected.length > 0 && `，${report.rejected.length} 个未通过（相关反馈已转待复核）`}
            {report.unclear.length > 0 && `，${report.unclear.length} 条 Claude 标为无法确定`}
            {report.missing.length > 0 && `，${report.missing.length} 条 Claude 未返回结果（保持未标注）`}
            {report.unknownIds.length > 0 && `，忽略了 ${report.unknownIds.length} 个不存在的编号`}。
          </span>
        </p>
      )}

      {/* 定性总结：只列条数和有原文依据的具体问题，不比较优劣 */}
      {labelled && result.qualitative && (
        <div style={{ marginBottom: 18 }}>
          <h3 style={{ fontSize: 17, marginBottom: 4 }}>定性总结</h3>
          <p className="small muted" style={{ marginBottom: 10 }}>
            基于 {result.qualitative.n} 条已分析的反馈。样本量小，只描述这些反馈说了什么，不推断普遍体验，也不比较机型优劣。
          </p>
          {result.qualitative.dims.length === 0 ? (
            <p className="muted">这些反馈没有涉及续航、发热、影像、流畅度、系统稳定性或手感。</p>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {result.qualitative.dims.map((d) => (
                <div key={d.dimension}>
                  <p style={{ fontWeight: 600 }}>
                    {DIMENSION_LABEL[d.dimension]}{" "}
                    <span className="small muted" style={{ fontWeight: 400 }}>
                      {d.mentions} / {result.qualitative!.n} 条提到 · 负面 {d.neg} · 褒贬混合 {d.mixed} · 正面 {d.pos}
                      {d.neu ? ` · 中性 ${d.neu}` : ""}
                    </span>
                  </p>
                  <ul className="note-list" style={{ marginTop: 4, fontSize: 14.5, color: "var(--text)" }}>
                    {d.items.map((it) => (
                      <li key={it.review_id}>
                        <span className={`sym ${it.sentiment}`} aria-label={SENTIMENT_LABEL[it.sentiment]}>
                          {SENTIMENT_SYMBOL[it.sentiment]}
                        </span>{" "}
                        {it.issue ? `${it.issue} · ` : ""}
                        <span className="muted">原文「{it.excerpt}」</span> <span className="ev-id">{it.review_id}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="more-groups" style={{ maxWidth: "none" }}>
        {report && report.rejected.length > 0 && (
          <Section title={`未通过校验的标签（${report.rejected.length}）`}>
            <ul className="note-list" style={{ marginTop: 0 }}>
              {report.rejected.map((r, i) => (
                <li key={i}>
                  <span className="mono">{r.review_id || "（无编号）"}</span> · {r.detail.startsWith(PROBLEM_TEXT[r.problem] ?? "\u0000") ? r.detail : `${PROBLEM_TEXT[r.problem] ?? r.problem}：${r.detail}`}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {result.stats.n > 0 && (
          <Section title="维度统计（分母为已分析有效反馈）">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">维度</th>
                    <th scope="col">提及 / N</th>
                    <th scope="col">{SENTIMENT_SYMBOL.pos} 正面</th>
                    <th scope="col">{SENTIMENT_SYMBOL.neg} 负面</th>
                    <th scope="col">{SENTIMENT_SYMBOL.mixed} 褒贬混合</th>
                    <th scope="col">{SENTIMENT_SYMBOL.neu} 中性</th>
                  </tr>
                </thead>
                <tbody>
                  {DIMENSIONS.map((d) => {
                    const x = result.stats.dims[d];
                    return (
                      <tr key={d}>
                        <th scope="row">{DIMENSION_LABEL[d]}</th>
                        <td>
                          {x.mentions} / {result.stats.n}
                        </td>
                        <td>{x.pos}</td>
                        <td>{x.neg}</td>
                        <td>{x.mixed}</td>
                        <td>{x.neu}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}
        <Section title={`逐条结果（${result.reviews.length}）`}>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">行</th>
                  <th scope="col">反馈</th>
                  <th scope="col">状态</th>
                  <th scope="col">标签与具体问题</th>
                </tr>
              </thead>
              <tbody>
                {result.reviews.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.line}</td>
                    <td style={{ minWidth: 200 }}>{r.text}</td>
                    <td style={{ minWidth: 110 }}>{r.status}</td>
                    <td style={{ minWidth: 160 }}>
                      {r.labels.length
                        ? r.labels.map((l, i) => (
                            <div key={i}>
                              {l.dimension}·{l.sentiment}
                              {l.issue ? `：${l.issue}` : ""}
                            </div>
                          ))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <div className="submit-row" style={{ marginTop: 14 }}>
        {labelled && (
          <button type="button" className="btn btn-sm" onClick={download}>
            下载校验结果（JSON）
          </button>
        )}
        <span className="small muted">
          结果只保存在本页，关闭后不保留。{labelled ? "下载的文件可交给项目维护者，经人工审核后作为静态数据发布。" : ""}
        </span>
      </div>
    </section>
  );
}
