"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ClipboardCheck, Download, FileSearch, FlaskConical, Info, LoaderCircle, ScanEye, ShieldCheck, TriangleAlert } from "lucide-react";
import { DIMENSIONS, STATUS_LABELS, type Evaluation, type Finding, type Sample } from "@/lib/domain";
import type { ValidationAttempt, ValidationReport } from "@/lib/validation";
import "./validation.css";

type Case = ValidationReport["cases"][number];
type Improvement = ValidationReport["improvements"][number];
type Outcome = "TP" | "FP" | "FN" | "TN" | "pending" | "excluded";
type AdjudicationReport = {
  schemaVersion: 1;
  sourceRunId: string;
  reviewer: { kind: "ai_assistant"; method: "ai_tool_verification"; human: false; reviewedOn: string };
  summary: { reviewedModelFindingCount: number; supportedConcernCount: number; falsePositiveCount: number; unresolvedCount: number };
  findingReviews: { attemptKey: string; findingId: string; sampleId: string; model: string; group: string; originalTitle: string; originalQuote: string; verdict: "supported_concern" | "false_positive" | "unresolved"; verdictLabel: string; reason: string; issueGroupId: string; evidenceRefs: { sourceId: string; locator: string; detail: string }[] }[];
  limitations: string[];
};
type RegressionReport = {
  schemaVersion: 1; generatedAt: string;
  baseline: { version: string; metrics: ValidationReport["ruleMetrics"] };
  current: { version: string; metrics: ValidationReport["ruleMetrics"] };
  cases: { id: string; expectedReview: boolean; beforeFlag: boolean; afterFlag: boolean; beforeFindings: Finding[]; afterFindings: Finding[] }[];
  challenges: { sample: Sample; reference: { needsReview: boolean; reason: string }; evaluation: Evaluation; flag: boolean; localizationNote?: string | null }[];
  limits: string[];
};
const REPORT_URL = "/evidence/quality-validation-20261025.json";
const FROZEN_URL = "/evidence/quality-validation-frozen.json";
const ADJUDICATION_URL = "/evidence/quality-adjudication-20261025.json";
const REGRESSION_URL = "/evidence/quality-regression-20261025.json";
const OUTCOMES: Record<Outcome, string> = { TP: "TP · 命中问题", FP: "FP · 误报", FN: "FN · 漏报", TN: "TN · 无告警一致", pending: "无有效结果", excluded: "未纳入模型集" };
const COVERAGE_TITLES = ["没有可直接核验的财务断言", "还有数字未完成核验"];
const cost = (value: number) => `$${value.toFixed(5)}`;
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const date = (value: string) => new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value));
const actionable = (evaluation: Evaluation) => evaluation.findings.filter(f => f.status !== "supported" && !COVERAGE_TITLES.includes(f.title));

function getAttempt(report: ValidationReport, sampleId: string, model: string) {
  return report.attempts.find(a => a.sampleId === sampleId && a.model === model);
}
function outcome(item: Case, engine: string, report: ValidationReport): Outcome {
  const attempt = engine === "rules" ? undefined : getAttempt(report, item.sample.id, engine);
  if (engine !== "rules" && !item.modelSelected) return "excluded";
  if (engine !== "rules" && attempt?.state !== "success") return "pending";
  const predicted = engine === "rules" ? item.ruleFlag : Boolean(attempt?.findings?.length);
  return item.label.needsReview ? predicted ? "TP" : "FN" : predicted ? "FP" : "TN";
}
function OutcomeBadge({ value }: { value: Outcome }) {
  return <span className={`v-outcome v-${value.toLowerCase()}`}>{OUTCOMES[value]}</span>;
}
function FindingList({ findings, empty }: { findings: Finding[]; empty: string }) {
  return findings.length ? <div className="v-findings">{findings.map(f => <article className="v-finding" key={f.id}>
    <div><span>{DIMENSIONS[f.dimension]}</span><small>{STATUS_LABELS[f.status]}</small></div><h4>{f.title}</h4>
    {f.quote && <blockquote>{f.quote}</blockquote>}<p>{f.detail}</p>
    {(f.expected || f.observed) && <dl>{f.expected && <div><dt>证据值</dt><dd>{f.expected}</dd></div>}{f.observed && <div><dt>回答值</dt><dd>{f.observed}</dd></div>}</dl>}
  </article>)}</div> : <p className="v-quiet-empty">{empty}</p>;
}
function AttemptDetail({ attempt, model, selected = true }: { attempt?: ValidationAttempt; model: string; selected?: boolean }) {
  return <div className="v-attempt">
    <div className="v-engine-title"><FlaskConical size={15} /><strong>{model}</strong><span className={attempt?.state === "failed" ? "v-error-text" : ""}>{!selected ? "未纳入模型集" : !attempt ? "未调用" : attempt.state === "success" ? "调用成功" : attempt.state === "failed" ? "调用失败" : "已开始 · 未完成"}</span></div>
    {!selected ? <p className="v-quiet-empty">这条样本不在预先选定的模型比较集合中。</p> : !attempt ? <p className="v-quiet-empty">尚无调用记录，不计作通过或无问题。</p> : attempt.state === "success" ? <FindingList findings={attempt.findings ?? []} empty="本次未提出质量疑点；这不代表整篇回答已经核验正确。" /> : <div className="v-failure"><TriangleAlert size={16} /><div><strong>{attempt.state === "started" ? "未取得最终结果" : attempt.error?.code ?? "未提供错误代码"}</strong><p>{attempt.error?.diagnosis ?? "本次没有形成有效模型判定，已从有效结果分母中排除。"}{attempt.error?.status ? ` HTTP ${attempt.error.status}。` : ""}</p></div></div>}
    {attempt && <details className="v-trace"><summary>查看调用、用量与追踪信息<ChevronDown size={13} /></summary><dl>
      <div><dt>请求 / 返回模型</dt><dd>{attempt.model} / {attempt.metadata?.model ?? "未返回"}</dd></div>
      <div><dt>评测 Prompt</dt><dd>{attempt.metadata?.promptVersion ?? "未返回"}{attempt.metadata?.reasoningEffort ? ` · ${attempt.metadata.reasoningEffort}` : ""}</dd></div>
      <div><dt>输入 / 输出 tokens</dt><dd>{attempt.usage?.inputTokens ?? "未知"} / {attempt.usage?.outputTokens ?? "未知"}</dd></div>
      <div><dt>估算费用</dt><dd>{attempt.estimatedCostUsd === null ? "未知，保留预算占用" : cost(attempt.estimatedCostUsd)}</dd></div>
      <div><dt>开始 / 完成</dt><dd>{date(attempt.startedAt)} / {attempt.completedAt ? date(attempt.completedAt) : "未完成"}</dd></div>
      <div><dt>Request ID</dt><dd>{attempt.metadata?.requestId ?? "未返回"}</dd></div>
      <div><dt>Response ID</dt><dd>{attempt.metadata?.responseId ?? "未返回"}</dd></div>
      <div><dt>输入 SHA-256</dt><dd>{attempt.inputHash}</dd></div>
    </dl></details>}
  </div>;
}
function MetricTable({ report }: { report: ValidationReport }) {
  const rows = [{ model: "冻结规则", scope: `全部 ${report.cases.length} 题`, metrics: report.ruleMetrics }, ...report.modelMetrics.map(row => ({ model: row.model, scope: `共同成功 ${report.commonPairs} 题`, metrics: row.commonMetrics }))];
  return <><div className="v-table-scroll"><table className="v-metrics-table"><caption>规则全量结果与模型共同成功集合的判定结果</caption><thead><tr><th>检测器 / 计算范围</th><th>有效 / 纳入</th><th>无有效结果</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th><th>精确率</th><th>召回率</th></tr></thead><tbody>{rows.map(({ model, scope, metrics: m }) => <tr key={model}><th scope="row">{model}<small className="v-metric-scope">{scope}</small></th><td>{m.completed} <span>/ {m.total}</span></td><td>{m.unavailable}</td><td>{m.tp}</td><td className={m.fp ? "v-error-text" : ""}>{m.fp}</td><td className={m.fn ? "v-error-text" : ""}>{m.fn}</td><td>{m.tn}</td><td>{percent(m.precision)}</td><td>{percent(m.recall)}</td></tr>)}</tbody></table></div>
    <div className="v-common-set"><ShieldCheck size={14} /><p>两模型主比较固定使用共同成功的同一批 <strong>{report.commonPairs}</strong> 题：{report.commonPairIds.length ? report.commonPairIds.join("、") : "尚无共同成功样本"}。未共同成功的题不用于两模型指标比较，其原始结果仍保留在逐题证据中。</p></div>
    <details className="v-secondary-metrics"><summary>各自成功子集与调用状态 · 分母不同，不用于模型排名<ChevronDown size={14} /></summary><div className="v-table-scroll"><table className="v-metrics-table"><thead><tr><th>模型</th><th>已尝试</th><th>成功</th><th>失败</th><th>未调用</th><th>执行中</th><th>TP / FP / FN / TN</th><th>精确率</th><th>召回率</th></tr></thead><tbody>{report.modelMetrics.map(row => <tr key={row.model}><th scope="row">{row.model}<small className="v-metric-scope">各自成功 {row.metrics.completed} / 预选 {row.metrics.total} 题</small></th><td>{row.attempted}</td><td>{row.succeeded}</td><td className={row.failed ? "v-error-text" : ""}>{row.failed}</td><td>{row.notAttempted}</td><td>{row.inProgress}</td><td>{row.metrics.tp} / {row.metrics.fp} / {row.metrics.fn} / {row.metrics.tn}</td><td>{percent(row.metrics.precision)}</td><td>{percent(row.metrics.recall)}</td></tr>)}</tbody></table></div></details>
  </>;
}
function CaseDetail({ item, report }: { item: Case; report: ValidationReport }) {
  const notices = item.ruleEvaluation.findings.filter(f => COVERAGE_TITLES.includes(f.title));
  const supported = item.ruleEvaluation.findings.filter(f => f.status === "supported");
  return <section className="v-panel v-case-detail" aria-labelledby="case-title">
    <div className="v-section-heading"><div><span className="v-kicker">CASE EVIDENCE / {item.sample.id}</span><h2 id="case-title">逐题核对</h2></div><span className="v-tag">{item.sample.profileId} · {item.sample.intent === "fact" ? "事实查询" : "证据解释"}</span></div>
    <div className="v-answer-reference"><div><span className="v-small-label">问题</span><h3>{item.sample.question}</h3><span className="v-small-label">待验收回答 · AI 构造</span><p className="v-answer">{item.sample.answer}</p></div><aside className="v-reference"><div><ClipboardCheck size={16} /><strong>冻结参考标签</strong></div><span className={`v-reference-label ${item.label.needsReview ? "v-needs-review" : ""}`}>{item.label.needsReview ? "预期：需要复核" : "预期：不需要复核"}</span><p>{item.label.reason}</p><div className="v-dimension-tags">{item.label.expectedDimensions.length ? item.label.expectedDimensions.map(d => <span key={d}>{DIMENSIONS[d]}</span>) : <span>无预期缺陷维度</span>}</div><small>来源页码：{item.label.sourcePages.length ? item.label.sourcePages.map(p => `P${p}`).join("、") : "无"}</small></aside></div>
    <div className="v-detector-grid"><div className="v-rule-detail"><div className="v-engine-title"><ShieldCheck size={15} /><strong>冻结规则</strong><OutcomeBadge value={outcome(item, "rules", report)} /></div><FindingList findings={actionable(item.ruleEvaluation)} empty="本次规则未发现质量缺陷告警。" />
      {notices.length > 0 && <details className="v-coverage"><summary><Info size={13} />{notices.length} 条覆盖提示 · 不计作回答缺陷<ChevronDown size={13} /></summary>{notices.map(f => <p key={f.id}><strong>{f.title}：</strong>{f.detail}</p>)}</details>}
      {supported.length > 0 && <details className="v-trace"><summary>{supported.length} 条有证据支持的核验记录<ChevronDown size={13} /></summary><FindingList findings={supported} empty="" /></details>}
    </div>{report.models.map(model => <AttemptDetail key={model} model={model} attempt={getAttempt(report, item.sample.id, model)} selected={item.modelSelected} />)}</div>
  </section>;
}
function ImprovementCard({ item, report, index }: { item: Improvement; report: ValidationReport; index: number }) {
  const before = actionable(item.before), after = actionable(item.after);
  return <article className="v-panel v-improvement"><div className="v-improvement-heading"><span className="v-case-number">0{index + 1}</span><div><span className="v-kicker">{item.id} / ANSWER REVISION</span><h3>{item.title}</h3></div></div><p className="v-improvement-question">{item.sampleBefore.question}</p>
    <div className="v-hypothesis"><span className="v-small-label">问题假设</span><p>{item.hypothesis}</p></div>
    <div className="v-answer-pair"><section><span className="v-small-label">修订前</span><p className="v-answer">{item.sampleBefore.answer}</p><div className="v-rule-result v-before-result">同版规则：{STATUS_LABELS[item.before.status]} · {before.length} 条质量疑点</div></section><section><span className="v-small-label">修订后</span><p className="v-answer">{item.sampleAfter.answer}</p><div className="v-rule-result">同版规则：{STATUS_LABELS[item.after.status]} · {after.length} 条质量疑点</div></section></div>
    <div className="v-improvement-reason"><section><h4><FileSearch size={15} />证据检查</h4><ol>{item.evidenceSteps.map(step => <li key={step}>{step}</li>)}</ol></section><section><h4><CheckCircle2 size={15} />具体修改</h4><ul>{item.changes.map(change => <li key={change}>{change}</li>)}</ul></section></div>
    <details className="v-improvement-regression"><summary>展开规则回归证据与修订稿模型复核<ChevronDown size={15} /></summary><div className="v-answer-pair"><section><h4>修订前 · 规则疑点</h4><FindingList findings={before} empty="没有质量缺陷告警。" /></section><section><h4>修订后 · 规则疑点</h4><FindingList findings={after} empty="没有质量缺陷告警；不等于全面正确。" /></section></div><div className="v-regression-models">{report.models.map(model => <AttemptDetail key={model} model={model} attempt={getAttempt(report, item.sampleAfter.id, model)} />)}</div></details>
    <p className="v-remaining"><Info size={14} /><span>{item.remainingLimit}</span></p>
  </article>;
}

function AdjudicationSection({ data, report }: { data: AdjudicationReport; report: ValidationReport }) {
  const reviews = [...data.findingReviews].sort((a, b) => Number(b.verdict === "false_positive") - Number(a.verdict === "false_positive"));
  return <section className="v-panel v-supplement" id="finding-review">
    <div className="v-section-heading"><div><span className="v-kicker">FOLLOW-UP / FINDING ADJUDICATION</span><h2>模型发现，也需要核对</h2></div><span className="v-tag">AI 工具核对 · 非真人复核</span></div>
    <p className="v-supplement-note">这里逐条检查模型疑点的依据。原始模型输出和初测矩阵完整保留，核对结果作为补充记录展示。</p>
    <div className="v-adjudication-counts"><span>已核对 <strong>{data.summary.reviewedModelFindingCount}</strong> 条发现</span><span>有依据 <strong>{data.summary.supportedConcernCount}</strong></span><span className="v-error-text">误报 <strong>{data.summary.falsePositiveCount}</strong></span><span>尚未解决 <strong>{data.summary.unresolvedCount}</strong></span></div>
    <div className="v-adjudication-list">{reviews.map(review => {
      const original = report.attempts.find(a => a.key === review.attemptKey)?.findings?.find(f => f.id === review.findingId);
      return <details className={`v-adjudication-item ${review.verdict === "false_positive" ? "v-adjudication-fp" : ""}`} key={review.findingId} open={review.verdict === "false_positive"}>
        <summary><span><small>{review.sampleId} · {review.model}</small><strong>{review.originalTitle}</strong></span><span className={`v-outcome ${review.verdict === "false_positive" ? "v-fp" : review.verdict === "supported_concern" ? "v-tp" : "v-pending"}`}>{review.verdict === "false_positive" ? "AI 核对：误报" : review.verdictLabel}</span><ChevronDown size={15} /></summary>
        <div className="v-adjudication-body"><div><span className="v-small-label">原始模型输出 · 保留</span>{original ? <FindingList findings={[original]} empty="" /> : <div className="v-finding"><h4>{review.originalTitle}</h4><blockquote>{review.originalQuote}</blockquote><p>完整原输出见验收报告 JSON。</p></div>}</div><div><span className="v-small-label">AI 核对理由</span><p className="v-adjudication-reason">{review.reason}</p><ul className="v-evidence-refs">{review.evidenceRefs.map((evidence, index) => <li key={`${evidence.sourceId}-${index}`}><strong>{evidence.sourceId} · {evidence.locator}</strong><p>{evidence.detail}</p></li>)}</ul><small className="v-issue-group">问题组：{review.issueGroupId} · 同组多条发现不代表多个独立错误</small></div></div>
      </details>;
    })}</div>
    <div className="v-supplement-footer"><ul>{data.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul><a className="button" href={ADJUDICATION_URL} download><Download size={14} />下载核对记录</a></div>
  </section>;
}
function RegressionSection({ data }: { data: RegressionReport }) {
  const classify = (expected: boolean, predicted: boolean): Outcome => expected ? predicted ? "TP" : "FN" : predicted ? "FP" : "TN";
  return <section className="v-panel v-supplement" id="rule-regression">
    <div className="v-section-heading"><div><span className="v-kicker">FOLLOW-UP / RULE REGRESSION</span><h2>规则修复之后，再看哪里仍会出错</h2></div><span className="v-tag">修复回归 · 非独立留出评测</span></div>
    <p className="v-supplement-note">这 {data.cases.length} 题已用于分析和修复，现在属于回归集。以下前后结果不用于排名模型或推断泛化能力；上方初测矩阵保持冻结时的原始结果。</p>
    <div className="v-table-scroll"><table className="v-metrics-table v-regression-table"><caption>相同回归集上的规则修复前后结果</caption><thead><tr><th>规则版本</th><th>有效 / 纳入</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th></tr></thead><tbody>{[{ label: "修复前", ...data.baseline }, { label: "修复后", ...data.current }].map(row => <tr key={row.label}><th scope="row">{row.label}<small className="v-metric-scope">{row.version}</small></th><td>{row.metrics.completed} <span>/ {row.metrics.total}</span></td><td>{row.metrics.tp}</td><td className={row.metrics.fp ? "v-error-text" : ""}>{row.metrics.fp}</td><td className={row.metrics.fn ? "v-error-text" : ""}>{row.metrics.fn}</td><td>{row.metrics.tn}</td></tr>)}</tbody></table></div>
    <details className="v-regression-case-list"><summary>逐题查看修复前后的规则发现<ChevronDown size={15} /></summary><div>{data.cases.map(item => <details className="v-regression-case" key={item.id}><summary><strong>{item.id}</strong><small>AI 参考：{item.expectedReview ? "需复核" : "无需复核"}</small><span><OutcomeBadge value={classify(item.expectedReview, item.beforeFlag)} /><ArrowRight size={12} /><OutcomeBadge value={classify(item.expectedReview, item.afterFlag)} /></span><ChevronDown size={13} /></summary><div className="v-answer-pair"><section><h4>修复前 · 规则发现</h4><FindingList findings={item.beforeFindings} empty="没有具体质量告警。" /></section><section><h4>修复后 · 规则发现</h4><FindingList findings={item.afterFindings} empty="没有具体质量告警；不代表回答已全面核验。" /></section></div></details>)}</div></details>
    {data.challenges.length > 0 && <div className="v-challenges"><div className="v-challenge-heading"><h3>继续挑战规则边界</h3><p>{data.challenges.length} 条 AI 构造挑战样本，未调用模型。AI 预期仅作案例参考。</p></div><div className="v-challenge-grid">{data.challenges.map(item => <article className="v-challenge-card" key={item.sample.id}><div className="v-engine-title"><strong>{item.sample.id}</strong><OutcomeBadge value={classify(item.reference.needsReview, item.flag)} /></div><span className="v-small-label">问题</span><h4>{item.sample.question}</h4><span className="v-small-label">挑战回答 · AI 构造</span><p className="v-answer">{item.sample.answer}</p><div className="v-challenge-reference"><strong>AI 预期：{item.reference.needsReview ? "需要复核" : "不需要复核"}</strong><p>{item.reference.reason}</p></div><div className="v-challenge-result">{item.localizationNote && <p className="v-error-text">{item.localizationNote}</p>}<span className="v-small-label">规则判定：{item.flag ? "触发具体质量告警" : "未触发具体质量告警"}</span><FindingList findings={actionable(item.evaluation)} empty="本次规则没有发现具体质量问题。" /></div></article>)}</div></div>}
    <div className="v-supplement-footer"><ul>{data.limits.map(limit => <li key={limit}>{limit}</li>)}</ul><a className="button" href={REGRESSION_URL} download><Download size={14} />下载回归与挑战记录</a></div>
  </section>;
}

export default function ValidationPage() {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [adjudication, setAdjudication] = useState<AdjudicationReport | null>(null);
  const [regression, setRegression] = useState<RegressionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [engine, setEngine] = useState("all");
  const [result, setResult] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(REPORT_URL, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? "质量验收报告尚未生成。完成受控验收后，报告会在这里展示。" : `读取报告失败（HTTP ${response.status}）。`);
      const data: ValidationReport = await response.json();
      if (data.schemaVersion !== 1 || !Array.isArray(data.cases) || !Array.isArray(data.attempts) || !Array.isArray(data.improvements)) throw new Error("报告结构不完整，暂时无法展示。请检查原始 JSON。");
      setReport(data);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "无法读取质量验收报告。"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    fetch(ADJUDICATION_URL, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const data: AdjudicationReport = await response.json();
      if (data.schemaVersion === 1 && data.summary && Array.isArray(data.findingReviews) && data.findingReviews.length && Array.isArray(data.limitations)) setAdjudication(data);
    }).catch(() => {});
    fetch(REGRESSION_URL, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const data: RegressionReport = await response.json();
      if (data.schemaVersion === 1 && data.baseline?.metrics && data.current?.metrics && Array.isArray(data.cases) && Array.isArray(data.challenges) && (data.cases.length || data.challenges.length) && Array.isArray(data.limits)) setRegression(data);
    }).catch(() => {});
    return () => controller.abort();
  }, [reload]);
  const filtered = useMemo(() => !report ? [] : report.cases.filter(item => {
    if (engine !== "all" && engine !== "rules" && !item.modelSelected) return false;
    if (result === "all") return true;
    const engines = engine === "all" ? ["rules", ...report.models] : [engine];
    return engines.some(e => outcome(item, e, report) === result);
  }), [report, engine, result]);
  const selected = filtered.find(item => item.sample.id === selectedId) ?? filtered[0];
  const failures = report?.attempts.filter(a => a.state === "failed") ?? [];
  const failureTypes = Object.entries(failures.reduce<Record<string, number>>((counts, a) => { const code = a.error?.code ?? "unknown"; counts[code] = (counts[code] ?? 0) + 1; return counts; }, {}));

  // eslint-disable-next-line @next/next/no-html-link-for-pages -- Native navigation avoids next/link's verified hook conflict in this Vinext runtime.
  return <div className="v-page"><header className="v-header"><div className="v-header-inner"><a href="/" className="v-brand" aria-label="观鉴，返回评测工作台"><span><ScanEye size={24} /></span><strong>观鉴<span>·</span></strong><small>INVESTMENT QA</small></a><a className="v-back" href="/"><ArrowLeft size={14} />返回工作台</a></div></header><main className="v-main">
    <div className="v-page-title"><div><span className="v-kicker">QUALITY VALIDATION / 质量证据</span><h1>让每个判定，都能被复核。</h1><p>独立留出样本、逐题对照与具体修订，组成一份可追溯的验收记录。</p></div><span className="v-title-icon"><ClipboardCheck size={35} strokeWidth={1.3} /></span></div>
    {loading ? <div className="v-panel v-load-state" role="status"><LoaderCircle className="spin" size={27} /><h2>正在读取验收报告</h2><p>仅加载已有记录，不发起模型请求。</p></div> : error ? <div className="v-panel v-load-state" role="alert"><FileSearch size={29} /><h2>报告暂不可用</h2><p>{error}</p><button className="button" onClick={() => { setLoading(true); setError(""); setReload(value => value + 1); }}>重新读取报告</button></div> : report && <>
      <div className="v-label-notice"><Info size={18} /><div><strong>{report.labelStatus}</strong><p>以下结果均相对这份参考标签计算。小样本案例验收不代表整体准确率，也不是金融判断能力认证。</p>{report.labelConfirmation && <small>确认时间：{date(report.labelConfirmation.confirmedAt)} · {report.labelConfirmation.source}</small>}</div></div>
      <section className="v-overview" aria-label="验收范围"><div><span>留出样本</span><strong>{report.cases.length}<small>条新构造回答</small></strong><p>规则检测全部样本</p></div><div><span>模型比较集合</span><strong>{report.selectedModelCaseIds.length}<small>题 / 每个模型</small></strong><p>两个模型均成功：{report.commonPairs} 对</p></div><div><span>已知估算费用</span><strong className="v-cost-number">{cost(report.knownEstimatedCostUsd)}</strong><p>另有 {report.unknownCostCount} 次费用未知</p></div><div><span>预算上限</span><strong>${report.budgetUsd.toFixed(2)}<small>USD</small></strong><p>含未知预留占用：{cost(report.reservedSpendUsd)}</p></div></section>
      <div className="v-jump-links"><a href="#comparison">01 判定对照<ArrowDown size={12} /></a><a href="#case-review">02 逐题证据<ArrowDown size={12} /></a><a href="#improvements">03 改善案例<ArrowDown size={12} /></a>{adjudication && <a href="#finding-review">补充 · 模型发现核对<ArrowDown size={12} /></a>}{regression && <a href="#rule-regression">补充 · 修复回归<ArrowDown size={12} /></a>}<a href="#protocol">04 验收边界<ArrowDown size={12} /></a></div>
      <section className="v-panel" id="comparison"><div className="v-section-heading"><div><span className="v-kicker">01 / DETECTOR COMPARISON</span><h2>规则与模型，相对参考标签的表现</h2></div><span className="v-tag">模型固定同一批共同样本</span></div><MetricTable report={report} /><div className="v-metric-explanation"><p><b>TP</b> 参考有问题且检出　<b>FP</b> 参考无问题却告警　<b>FN</b> 参考有问题但漏检　<b>TN</b> 参考无问题且未告警</p><p>这里只验证「是否触发具体告警」与参考标签的一致性，不能说明每条疑点的理由都正确。精确率 = TP / (TP + FP)；召回率 = TP / (TP + FN)。分母为 0 时显示「—」。规则全量与模型共同子集的范围不同，不直接排名。</p></div></section>
      {report.attempts.some(a => a.state !== "success") && <section className="v-call-notice"><TriangleAlert size={18} /><div><strong>{failures.length} 次调用失败 · {report.attempts.filter(a => a.state === "started").length} 次未完成</strong><p>保留原始失败，不重试或替换样本；失败与未完成都不计作通过。</p>{failureTypes.length > 0 && <div>{failureTypes.map(([code, count]) => <span className="v-error-code" key={code}>{code} × {count}</span>)}</div>}<details><summary>查看失败明细<ChevronDown size={13} /></summary><ul>{failures.map(a => <li key={a.key}><strong>{a.sampleId} · {a.model} · {a.error?.code ?? "unknown"}</strong><p>{a.error?.diagnosis ?? "未提供进一步诊断"}{a.error?.status ? `（HTTP ${a.error.status}）` : ""}</p><small>费用：{a.estimatedCostUsd === null ? "未知" : cost(a.estimatedCostUsd)} · {a.group === "regression" ? "修订稿回归" : "留出集验收"}</small></li>)}</ul></details></div></section>}
      <section className="v-panel" id="case-review"><div className="v-section-heading"><div><span className="v-kicker">02 / CASE-BY-CASE REVIEW</span><h2>找到误报，也找到漏报</h2></div><span className="v-tag">显示 {filtered.length} / {report.cases.length} 题</span></div><div className="v-filters"><label>检测器<select value={engine} onChange={e => setEngine(e.target.value)}><option value="all">全部检测器</option><option value="rules">冻结规则</option>{report.models.map(model => <option key={model} value={model}>{model}</option>)}</select></label><label>判定结果<select value={result} onChange={e => setResult(e.target.value)}><option value="all">全部结果</option><option value="FP">FP · 误报</option><option value="FN">FN · 漏报</option><option value="TP">TP · 命中问题</option><option value="TN">TN · 无告警一致</option><option value="pending">无有效结果</option></select></label><p>选择一题展开原回答、参考理由和各检测器证据。</p></div>
        <div className="v-table-scroll"><table className="v-cases-table"><thead><tr><th>样本 / 问题</th><th>参考标签</th><th>冻结规则</th>{report.models.map(model => <th key={model}>{model}</th>)}<th><span className="sr-only">操作</span></th></tr></thead><tbody>{filtered.map(item => <tr key={item.sample.id} className={selected?.sample.id === item.sample.id ? "v-selected-row" : ""}><td><button className="v-case-link" onClick={() => setSelectedId(item.sample.id)}><span>{item.sample.id}</span><strong>{item.sample.question}</strong></button></td><td><span className={`v-reference-short ${item.label.needsReview ? "v-needs-review" : ""}`}>{item.label.needsReview ? "需要复核" : "无需复核"}</span></td><td><OutcomeBadge value={outcome(item, "rules", report)} /></td>{report.models.map(model => <td key={model}><OutcomeBadge value={outcome(item, model, report)} /></td>)}<td><button className="v-view-case" onClick={() => setSelectedId(item.sample.id)} aria-label={`查看 ${item.sample.id} 证据`}><ArrowRight size={15} /></button></td></tr>)}</tbody></table></div>{!filtered.length && <div className="v-empty-filter"><FileSearch size={24} /><p>当前筛选下没有样本。</p><button onClick={() => { setEngine("all"); setResult("all"); }}>清除筛选</button></div>}
      </section>
      {selected && <CaseDetail item={selected} report={report} />}
      <section className="v-improvements-section" id="improvements"><div className="v-section-heading"><div><span className="v-kicker">03 / WORKED IMPROVEMENTS</span><h2>从发现问题，到修订与回归</h2></div><span className="v-tag">{report.improvements.length} 条完整改善案例</span></div><p className="v-section-description">AI 依据已核验证据修订具体回答，并用同版规则做前后回归。模型只复核修订稿；这组记录不构成实际 Prompt 生成实验。</p>{report.improvements.length ? report.improvements.map((item, index) => <ImprovementCard key={item.id} item={item} report={report} index={index} />) : <div className="v-panel v-load-state"><p>报告中尚未记录改善案例。</p></div>}</section>
      {adjudication && <AdjudicationSection data={adjudication} report={report} />}
      {regression && <RegressionSection data={regression} />}
      <section className="v-panel v-protocol" id="protocol"><div className="v-section-heading"><div><span className="v-kicker">04 / FROZEN PROTOCOL</span><h2>结论边界与复核材料</h2></div><ShieldCheck size={22} /></div><div className="v-protocol-grid"><div><dl><div><dt>协议冻结</dt><dd>{date(report.frozenAt)}</dd></div><div><dt>报告生成</dt><dd>{date(report.generatedAt)}</dd></div><div><dt>规则版本</dt><dd>{report.rulesVersion}</dd></div><div><dt>模型共同设置</dt><dd>quality-v2 · low · 输出上限 3000 tokens</dd></div><div><dt>预选题号</dt><dd>{report.selectedModelCaseIds.join("、")}</dd></div><div><dt>运行编号</dt><dd>{report.runId}</dd></div><div><dt>协议 SHA-256</dt><dd>{report.protocolHash}</dd></div></dl><div className="v-downloads"><a className="button button-primary" href={REPORT_URL} download><Download size={14} />验收报告 JSON</a><a className="button" href={FROZEN_URL} download><Download size={14} />冻结协议 JSON</a></div><p className="v-download-note">费用是依据用量与配置费率的估算，未知费用单列；以供应商账单为准。</p></div><ul>{report.limits.map(limit => <li key={limit}>{limit}</li>)}</ul></div></section>
      <footer className="v-footer"><span>观鉴 · 投资问答质量评测工作台</span><span>证据可追溯，结论有边界。</span></footer>
    </>}
  </main></div>;
}
