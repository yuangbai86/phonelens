"use client";
import { useEffect, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CatalogItem } from "@/lib/data";
import { IMPORT_LIMITS, parseImportCsv, parsePasted, type ImportError } from "@/lib/csv";
import type { ImportResult } from "@/lib/import/service";
import { DIMENSIONS } from "@/lib/types";
import { DIMENSION_LABEL, SENTIMENT_LABEL, SENTIMENT_SYMBOL } from "@/lib/labels";
import { IconAlert, IconCheck, IconFlask, IconInfo } from "./Icons";
import { dataset } from "@/lib/data";
import { cleanImportLocally, customPhone } from "@/lib/import/local";
import { CLAUDE_LABELER, parseClaudeResponse, type ClaudeImportResult } from "@/lib/import/claude";
import type { ImportRow } from "@/lib/csv";
import type { AnalysisRecord, PhoneRecord } from "@/lib/types";
import { ImportResultPanel } from "./ImportResultPanel";
import { BACKEND_ENABLED, apiUrl, withBase } from "@/lib/runtime";

const CUSTOM = "__custom__";
const LOCAL_MESSAGE = null;

export function ImportForm({ catalog }: { catalog: CatalogItem[] }) {
  const initialName = (useSearchParams().get("name") ?? "").replace(/[\u0000-\u001f<>]/g, "").slice(0, 40);
  const [phone, setPhone] = useState<string>(initialName ? CUSTOM : catalog[0]?.id ?? CUSTOM);
  const [outside, setOutside] = useState(initialName);
  const [format, setFormat] = useState<"paste" | "csv">("paste");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [consentErr, setConsentErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [lastInput, setLastInput] = useState<{ rows: ImportRow[]; rec: PhoneRecord; inCatalog: boolean } | null>(null);
  const [report, setReport] = useState<ClaudeImportResult | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState<AnalysisRecord[]>([]);

  // 粘贴 Claude 的回复：校验后在本机重新计算统计；任何不合格的标签都不计入
  const applyClaude = (text: string): string | null => {
    if (!lastInput || !result?.sendable?.length) return "请先完成导入与清洗。";
    const r = parseClaudeResponse(text, result.sendable);
    if (!r.ok) return r.error;
    setReport(r.result);
    setLastAnalysis(r.result.analysis);
    setResult(cleanImportLocally(lastInput.rows, lastInput.rec, lastInput.inCatalog, dataset.phones, null, r.result.analysis));
    return null;
  };
  const [aiStatus, setAiStatus] = useState<{ ai: boolean; fixture: boolean } | null>(null);
  const ids = { phone: useId(), outside: useId(), text: useId(), file: useId(), source: useId(), consent: useId(), err: useId() };

  useEffect(() => {
    if (!BACKEND_ENABLED) {
      setAiStatus({ ai: false, fixture: false });
      return;
    }
    fetch(apiUrl("/api/status"))
      .then((r) => r.json())
      .then((d) => setAiStatus({ ai: !!d.ai, fixture: !!d.fixture }))
      .catch(() => setAiStatus({ ai: false, fixture: false }));
  }, []);
  const remote = !!aiStatus?.ai;

  const phoneId = phone === CUSTOM ? "custom" : phone;

  const precheck = (): ImportError[] => {
    if (phone === CUSTOM && !outside.trim()) return [{ line: null, message: "请填写目录外机型的名称。" }];
    if (!content.trim()) return [{ line: null, message: format === "csv" ? "请选择 CSV 文件。" : "请粘贴至少一条评论。" }];
    const r = format === "csv" ? parseImportCsv(content, new Set([phoneId])) : parsePasted(content, phoneId, source);
    return r.errors;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs = precheck();
    setErrors(errs);
    setConsentErr(!consent);
    if (errs.length || !consent) {
      document.getElementById(errs.length ? ids.err : ids.consent)?.focus();
      return;
    }
    setBusy(true);
    setResult(null);
    if (!remote) {
      // 静态版本：解析、去重与可疑项标记在本机浏览器完成，不上传
      await new Promise((r) => setTimeout(r, 120));
      const parsed = format === "csv" ? parseImportCsv(content, new Set([phoneId])) : parsePasted(content, phoneId, source);
      const rec = phone === CUSTOM ? customPhone(outside) : dataset.phones.find((p) => p.id === phone)!;
      setLastInput({ rows: parsed.rows, rec, inCatalog: phone !== CUSTOM });
      setReport(null);
      setLastAnalysis([]);
      setResult(cleanImportLocally(parsed.rows, rec, phone !== CUSTOM, dataset.phones, LOCAL_MESSAGE));
      setBusy(false);
      return;
    }
    try {
      const r = await fetch(apiUrl("/api/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          content,
          phone_id: phone === CUSTOM ? null : phone,
          outside_name: phone === CUSTOM ? outside.trim() : null,
          source_label: source.trim() || null,
          consent: true,
        }),
      });
      const data = await r.json();
      if (!r.ok) setErrors(data.errors ?? [{ line: null, message: "导入失败，请稍后重试。" }]);
      else setResult(data as ImportResult);
    } catch {
      setErrors([{ line: null, message: "网络错误，内容没有提交成功，可以直接重试。" }]);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    setErrors([]);
    if (!f) return;
    if (f.size > 40000) {
      setErrors([{ line: null, message: `文件有 ${Math.round(f.size / 1024)} KB，超过 40 KB，请分批导入。` }]);
      return;
    }
    setFileName(f.name);
    setContent(await f.text());
  };

  return (
    <div className="import-grid">
      <form className="card import-form" onSubmit={submit} noValidate aria-label="导入评论">
        <div className="form-section">
          <label className="legend" htmlFor={ids.phone}>
            评论对应的机型
          </label>
          <select id={ids.phone} className="input select" value={phone} onChange={(e) => setPhone(e.target.value)}>
            {catalog.map((p) => (
              <option key={p.id} value={p.id}>
                {p.brand} {p.model}（{p.storage}）{p.data_kind === "demo" ? " · 演示" : ""}
              </option>
            ))}
            <option value={CUSTOM}>目录外机型（只生成口碑摘要）</option>
          </select>
          {phone === CUSTOM && (
            <div style={{ marginTop: 10 }}>
              <label htmlFor={ids.outside} className="small muted">
                机型名称
              </label>
              <input id={ids.outside} className="input" maxLength={40} value={outside} onChange={(e) => setOutside(e.target.value)} placeholder="例如：某品牌 某型号 256GB" />
              <p className="field-hint">目录外机型没有已核验参数，只展示你提供的评论的口碑摘要，不生成完整选购建议。</p>
            </div>
          )}
        </div>

        <div className="form-section">
          <div className="legend">导入方式</div>
          <div className="window-switch" role="group" aria-label="导入方式">
            <button type="button" aria-pressed={format === "paste"} onClick={() => { setFormat("paste"); setContent(""); setFileName(null); setErrors([]); }}>
              粘贴文本
            </button>
            <button type="button" aria-pressed={format === "csv"} onClick={() => { setFormat("csv"); setContent(""); setErrors([]); }}>
              上传 CSV
            </button>
          </div>
          <div key={format} className="fade-swap" style={{ marginTop: 12 }}>
            {format === "paste" ? (
              <>
                <label htmlFor={ids.text} className="small muted">
                  每行一条评论
                </label>
                <textarea id={ids.text} className="input" value={content} onChange={(e) => setContent(e.target.value)} placeholder={"拍照很好，但玩游戏容易热。\n续航一般，下午需要充电。"} />
                <label htmlFor={ids.source} className="small muted" style={{ display: "block", marginTop: 10 }}>
                  来源说明（选填）
                </label>
                <input id={ids.source} className="input" maxLength={60} value={source} onChange={(e) => setSource(e.target.value)} placeholder="例如：我自己的使用记录" />
              </>
            ) : (
              <>
                <label htmlFor={ids.file} className="small muted">
                  CSV 文件（UTF-8）
                </label>
                <input id={ids.file} className="input" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
                <p className="field-hint">
                  必填列 phone_id、text、source_label；可选 review_id、review_date、system_version、source_url。phone_id 需填
                  <code className="mono"> {phoneId} </code>。
                  <a href={withBase("/templates/reviews_template.csv")} download>
                    下载模板
                  </a>
                  {fileName ? ` · 已读取 ${fileName}` : ""}
                </p>
              </>
            )}
          </div>
          <p className="field-hint">
            单次最多 {IMPORT_LIMITS.maxRows} 条、每条最多 {IMPORT_LIMITS.maxChars} 字符、合计最多 {IMPORT_LIMITS.maxTotal} 字符。超出时会提示，不会悄悄截断。
          </p>
        </div>

        <div id={ids.err} tabIndex={-1} aria-live="polite">
          {errors.length > 0 && (
            <div className="notice notice-error" role="alert">
              <IconAlert className="icon" />
              <div>
                <strong>需要修改后再提交：</strong>
                <ul className="error-list">
                  {errors.slice(0, 12).map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                  {errors.length > 12 && <li>另有 {errors.length - 12} 处问题。</li>}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="form-section">
          <label className="check-pill" style={{ alignItems: "flex-start" }}>
            <input id={ids.consent} type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setConsentErr(false); }} aria-describedby={`${ids.consent}-msg`} />
            <span className="box" aria-hidden="true" style={{ marginTop: 4 }}>
              <IconCheck size={11} />
            </span>
            <span>{remote ? "我确认有权提交这些文本，并知道它们会发送给已配置的模型服务做维度分析。" : "我确认有权使用这些文本，并清楚来源与使用范围（网站只在本机浏览器处理，不会上传）。"}</span>
          </label>
          <div id={`${ids.consent}-msg`}>
            {consentErr && (
              <p className="field-error">
                <IconAlert /> 请先勾选确认，再提交。
              </p>
            )}
          </div>
        </div>

        <div className="submit-row">
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
            <span className="btn-stack">
              <span style={{ visibility: busy ? "hidden" : "visible" }}>分析这些评论</span>
              <span style={{ visibility: busy ? "visible" : "hidden" }} aria-hidden={!busy}>
                <span className="spinner" aria-hidden="true" /> 正在清洗与分析
              </span>
            </span>
          </button>
        </div>
      </form>

      <aside className="stack">
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ fontSize: 16, marginBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
            <IconInfo /> 你的文本会怎样处理
          </h2>
          <ul className="note-list" style={{ marginTop: 0 }}>
            {remote ? (
              <>
                <li>先在服务端去重、识别广告与机型混入，再把通过清洗的文本发送给已配置的模型服务，按六个固定维度提取标签。</li>
                <li>只用于本次分析：不写入公共目录，不进入公共缓存，应用日志不保存原文。</li>
                <li>模型服务商自身的数据保留规则需要以其公开政策为准。</li>
              </>
            ) : (
              <>
                <li>解析、去重、广告与机型混入识别都在你的浏览器中完成，网站不会上传文本。</li>
                <li>维度标注可以在你自己的 Claude 对话中完成：复制标注请求，把 Claude 回复的 JSON 粘贴回来，程序逐条核对编号、原文摘录和具体问题后再计数。是否把文本发给 Claude 由你决定。</li>
                <li>样本量小时只给定性总结，不做显著性检验，也不据此判断哪款体验更好。</li>
              </>
            )}
            <li>导入样本与内置样本分开统计，不混在一起计算比例；关闭页面后不保留。</li>
            <li>没有日期或链接的样本标为“用户提供，来源未独立核验”。评论里的链接不会被打开。</li>
          </ul>
          <p className="small" style={{ marginTop: 10 }}>
            当前状态：
            {aiStatus === null
              ? "检查中…"
              : aiStatus.ai
                ? aiStatus.fixture
                  ? "本地测试夹具（不是真实模型）"
                  : "模型分析可用"
                : "可用 Claude 对话完成标注（无需 API），程序在本机校验"}
          </p>
        </div>
      </aside>

      {result && (
        <ImportResultPanel
          result={result}
          report={report}
          onClaude={applyClaude}
          onReset={() => {
            if (!lastInput) return;
            setReport(null);
            setResult(cleanImportLocally(lastInput.rows, lastInput.rec, lastInput.inCatalog, dataset.phones, LOCAL_MESSAGE));
          }}
          downloadPayload={() => ({
            format: "phonelens-review-import/v1",
            created_at: new Date().toISOString(),
            phone_id: lastInput?.rec.id ?? null,
            phone_name: result.phone.name,
            prompt_version: result.prompt_version,
            labeler: CLAUDE_LABELER,
            note: "用户提供的反馈与 Claude 辅助标注，经 PhoneLens 程序校验；发布前需人工审核来源授权与标注。",
            reviews: lastInput?.rows ?? [],
            analysis: lastAnalysis,
            validation: report,
          })}
        />
      )}
    </div>
  );
}
