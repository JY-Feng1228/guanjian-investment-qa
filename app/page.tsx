"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Activity, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Database, ExternalLink, FileText, Filter, FlaskConical, GitCompareArrows, History, Layers3, LoaderCircle, MessageSquare, PencilLine, Plus, RefreshCw, ScanEye, Search, ShieldCheck, ThumbsDown, ThumbsUp, TriangleAlert, X } from "lucide-react";
import { DIMENSIONS, STATUS_LABELS, type CheckStatus, type Evaluation, type Finding, type Intent, type Sample, type Workspace } from "@/lib/domain";

type View = "workspace" | "compare" | "governance";
type Mutation = (path: string, body: Record<string, unknown>, success: string) => Promise<Workspace | undefined>;
const INTENTS: Record<Intent, string> = { fact: "事实查询", explanation: "证据解释" };
const DECISIONS = { confirmed: "确认问题", false_positive: "判定误报", needs_data: "需要补充数据" };
const FEEDBACK = { useful: "有帮助", not_useful: "无帮助", dispute: "提出异议" };
const TITLES = { workspace: "评测工作台", compare: "版本对比", governance: "治理记录" };
const date = (value: string) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value));
const issues = (evaluation?: Evaluation) => evaluation?.findings.filter((finding) => finding.status !== "supported") ?? [];
const issueKey = (finding: Finding) => `${finding.dimension}/${finding.factId ?? ""}/${finding.title}`;

function Status({ status }: { status?: CheckStatus }) {
  const Icon = status === "supported" ? CheckCircle2 : status === "contradicted" ? TriangleAlert : status === "unverifiable" ? CircleHelp : Clock3;
  return <span className={`status status-${status ?? "pending"}`}><Icon size={12} />{status ? STATUS_LABELS[status] : "待评测"}</span>;
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><ClipboardCheck size={29} strokeWidth={1.4} /><strong>{title}</strong><p>{children}</p></div>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal" aria-label={title} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-heading"><div><span className="eyebrow">NEW SAMPLE</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={19} /></button></div>{children}</dialog>;
}

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [view, setView] = useState<View>("workspace");
  const [activeId, setActiveId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [intent, setIntent] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [detailTab, setDetailTab] = useState("answer");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/workspace", { signal: controller.signal }).then(async (response) => {
      const data = await response.json() as Workspace & { error?: string };
      if (!response.ok) throw new Error(data.error || "加载失败，请重试");
      setWorkspace(data);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法连接工作台"); });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4500); return () => clearTimeout(timer); }, [toast]);
  async function mutate(path: string, body: Record<string, unknown>, success: string) {
    setBusy(path); setError("");
    try {
      const response = await fetch(`/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as Workspace & { error?: string };
      if (!response.ok) throw new Error(data.error || "操作未完成，请重试");
      setWorkspace(data); setToast(success); return data as Workspace;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请检查连接"); }
    finally { setBusy(""); }
  }
  const latest = useMemo(() => {
    const values = new Map<string, Evaluation>();
    workspace?.evaluations.forEach((evaluation) => { if (!values.has(evaluation.sampleId) || values.get(evaluation.sampleId)!.createdAt <= evaluation.createdAt) values.set(evaluation.sampleId, evaluation); });
    return values;
  }, [workspace]);
  const samples = workspace?.samples ?? [];
  const active = samples.find((sample) => sample.id === activeId) ?? samples[0];
  const activeProfile = workspace?.profiles.find((profile) => profile.id === active?.profileId);
  const evaluation = active ? latest.get(active.id) : undefined;
  const filtered = samples.filter((sample) => (intent === "all" || sample.intent === intent) && (status === "all" || (latest.get(sample.id)?.status ?? "pending") === status) && `${sample.question} ${sample.answer} ${sample.id}`.toLowerCase().includes(search.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 8)), safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * 8, safePage * 8 + 8);
  const latestValues = Array.from(latest.values());
  const conflictCount = latestValues.filter((item) => item.status === "contradicted").length;
  const pendingReviews = latestValues.filter((item) => !workspace?.reviews.some((review) => review.evaluationId === item.id)).length;
  const totalClaims = latestValues.reduce((sum, item) => sum + item.totalClaims, 0), checkedClaims = latestValues.reduce((sum, item) => sum + item.checkedClaims, 0);
  const coverage = totalClaims ? Math.round(checkedClaims / totalClaims * 100) : null;
  const conflictSources = workspace?.evidence.filter((item) => item.status === "conflict") ?? [];
  const profileName = (id: string) => workspace?.profiles.find((profile) => profile.id === id)?.name ?? id;
  function selectSample(sample: Sample) { setActiveId(sample.id); setDetailTab("answer"); }
  function switchView(next: View) { setView(next); setError(""); window.scrollTo({ top: 0 }); }
  async function evaluate(ids: string[]) { if (ids.length > 64) { setError("单次最多核验 64 条，请勾选部分样本后再运行。"); return; } const result = await mutate("evaluate", { sampleIds: ids }, `已完成 ${ids.length} 条回答的规则核验`); if (result) setSelected([]); }
  function openAdded(result: Workspace) { const added = result.samples.find((sample) => !samples.some((old) => old.id === sample.id)); if (added) selectSample(added); switchView("workspace"); setSearch(""); setStatus("all"); setIntent("all"); }

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="#" onClick={(event) => { event.preventDefault(); switchView("workspace"); }} className="brand" aria-label="观鉴首页"><span className="brand-symbol"><ScanEye size={26} strokeWidth={1.7} /></span><span><strong>观鉴<span className="brand-dot">.</span></strong><small>投资回答质检</small></span></a>
      <div className="workspace-label"><span className="workspace-avatar">研</span><div><strong>投资问答质量工作台</strong><span>演示工作空间</span></div><ChevronDown size={14} /></div>
      <div className="nav-section-title">质量运营</div>
      <nav aria-label="主导航">{([{ id: "workspace", icon: Layers3 }, { id: "compare", icon: GitCompareArrows }, { id: "governance", icon: History }] as const).map(({ id, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => switchView(id)}><Icon size={18} /><span>{TITLES[id]}</span>{id === "workspace" && <span className="nav-count">{samples.length || "—"}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="principle-card"><ShieldCheck size={20} /><strong>个性化表达，统一事实</strong><p>数字、报告期与来源<br />不能随用户画像改变。</p><span>FACTS STAY FACTS <ArrowRight size={12} /></span></div><div className="system-status"><span className="live-dot" /><span>规则核验已就绪</span><span className="version">v0.1</span></div><p className="ai-note">{workspace?.connection.modelEnabled ? workspace.connection.model : "AI 辅助核验待配置"}</p></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><span>质量运营</span><ChevronRight size={13} /><strong>{TITLES[view]}</strong></div><div className="topbar-right"><span className={`snapshot-status ${conflictSources.length ? "has-conflict" : ""}`}><Database size={13} />历史数据快照{conflictSources.length ? " · 含来源冲突" : ""}</span><span className="user-avatar">QA</span></div></header>
      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow">ANSWER QUALITY OPERATIONS</div><h1>{{ workspace: "让每一个判断，有据可查。", compare: "单变量对照，看清变化。", governance: "让每一次处理，留下记录。" }[view]}</h1><p>{{ workspace: "从事实核验到人工复核，找到问题，也看清问题从何而来。", compare: "选择模型、Prompt 或数据作为唯一变化项，在固定条件下比较已有回答。", governance: "查看评测运行、人工判定与用户反馈，保留完整处理过程。" }[view]}</p></div><button className="button button-primary" onClick={() => setShowImport(true)} disabled={!workspace}><Plus size={16} />新增问答</button></div>
        {error && <div className="error-banner" role="alert"><TriangleAlert size={17} /><span>{error}</span><button className="icon-button" onClick={() => setError("")} aria-label="关闭错误提示"><X size={16} /></button></div>}
        {!workspace ? <div className="loading-card">{error ? <><TriangleAlert /><strong>工作台暂时无法加载</strong><button className="button" onClick={() => window.location.reload()}>重新加载</button></> : <><LoaderCircle className="spin" /><strong>正在读取样本与核验记录…</strong></>}</div> : <>
          <div className="scope-notice"><FlaskConical size={16} /><span><strong>演示数据，透明边界</strong><span className="notice-separator">/</span>初始回答为构造样例；统计反映当前规则核验结果，不代表真实模型成绩。</span><span className="scope-tag">{new Set(samples.filter((sample) => sample.provenance === "constructed").map((sample) => sample.questionId)).size} 个基础问题</span></div>
          {view === "workspace" && <>
            <section className="metric-grid" aria-label="当前评测统计">
              <Metric label="回答样本" value={samples.length} unit="条" icon={<Layers3 size={17} />} detail={`${latest.size} 条已评测`} note={`${samples.length - latest.size} 条待评测`} percent={samples.length ? latest.size / samples.length * 100 : 0} />
              <Metric label="发现冲突" value={conflictCount} unit="条回答" icon={<TriangleAlert size={17} />} detail="需要检查事实或规则边界" percent={latest.size ? conflictCount / latest.size * 100 : 0} tone="danger" />
              <Metric label="待人工复核" value={pendingReviews} unit="条回答" icon={<ClipboardCheck size={17} />} detail="当前评测尚无人工判定" percent={latest.size ? pendingReviews / latest.size * 100 : 0} tone="amber" />
              <Metric label="数字核验覆盖" value={coverage ?? "—"} unit={coverage !== null ? "%" : "暂无数据"} icon={<ScanEye size={17} />} detail={`${checkedClaims} / ${totalClaims} 条已识别数字片段`} note="非准确率" percent={coverage ?? 0} />
            </section>
            <div className="workbench-grid">
              <section className="panel sample-panel"><div className="panel-heading"><div><h2>回答样本<span className="count-label">{filtered.length}</span></h2><p>检查回答，也检查背后的证据。</p></div><button className="button button-small" onClick={() => evaluate(selected.length ? selected : filtered.map((sample) => sample.id))} disabled={!!busy || (!selected.length && !filtered.length)}>{busy === "evaluate" ? <LoaderCircle size={14} className="spin" /> : <ScanEye size={14} />}{selected.length ? `核验已选 ${selected.length} 条` : "核验当前列表"}</button></div>
                <div className="table-tools"><label className="search-input"><Search size={16} /><input aria-label="搜索问答内容" placeholder="搜索问题或回答…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />{search && <button onClick={() => { setSearch(""); setPage(0); }} aria-label="清除搜索"><X size={13} /></button>}</label><label className="select-wrap"><Filter size={13} /><select aria-label="筛选意图" value={intent} onChange={(event) => { setIntent(event.target.value); setPage(0); }}><option value="all">全部意图</option><option value="fact">事实查询</option><option value="explanation">证据解释</option></select></label><label className="select-wrap"><select aria-label="筛选判定" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="all">全部判定</option><option value="pending">待评测</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
                <div className="table-scroll"><table className="sample-table"><thead><tr><th className="checkbox-cell"><input type="checkbox" aria-label="选择当前页全部样本" checked={visible.length > 0 && visible.every((sample) => selected.includes(sample.id))} onChange={(event) => setSelected(event.target.checked ? Array.from(new Set([...selected, ...visible.map((sample) => sample.id)])) : selected.filter((id) => !visible.some((sample) => sample.id === id)))} /></th><th>问题 / 意图</th><th>用户画像</th><th>Prompt</th><th>核验判定</th><th className="arrow-cell" /></tr></thead><tbody>{visible.map((sample, index) => <tr key={sample.id} className={active?.id === sample.id ? "selected-row" : ""}><td className="checkbox-cell"><input type="checkbox" aria-label={`选择样本 ${sample.id}`} checked={selected.includes(sample.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, sample.id] : selected.filter((id) => id !== sample.id))} /></td><td><button className="sample-link" onClick={() => selectSample(sample)}><span className="sample-question">{sample.question}</span><span className="sample-meta"><span className="sample-index">{String(safePage * 8 + index + 1).padStart(2, "0")}</span><span>{INTENTS[sample.intent]}</span><span>·</span><span>{sample.provenance === "constructed" ? "构造样例" : sample.provenance === "model" ? "模型生成" : "手动导入"}</span></span></button></td><td><span className="profile-label">{profileName(sample.profileId)}</span></td><td><span className="prompt-tag">{sample.promptVersion}</span></td><td><Status status={latest.get(sample.id)?.status} /></td><td className="arrow-cell"><button aria-label={`查看 ${sample.question}`} className="row-open" onClick={() => selectSample(sample)}><ChevronRight size={15} /></button></td></tr>)}</tbody></table>{!visible.length && <Empty title="没有匹配的样本">试试其他关键词或筛选条件。</Empty>}</div>
                <div className="table-footer"><span>{selected.length ? `已选择 ${selected.length} 条` : `共 ${filtered.length} 条回答`}</span><div><span>{safePage + 1} / {pageCount}</span><button className="icon-button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="上一页"><ChevronLeft size={16} /></button><button className="icon-button" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)} aria-label="下一页"><ChevronRight size={16} /></button></div></div><div className="table-explainer"><CircleHelp size={14} /><span>“有证据支持”仅表示当前规则检查通过，不能代替人工判断。</span></div>
              </section>
              <section className="panel detail-panel" aria-label="回答详情">{active ? <>
                <div className="detail-heading"><span className="eyebrow"><span className="detail-dot" />ANSWER INSPECTOR</span><button className="icon-button" aria-label="重新核验当前回答" disabled={!!busy} onClick={() => evaluate([active.id])}><RefreshCw size={14} className={busy === "evaluate" ? "spin" : ""} /></button></div>
                <h2 className="detail-question">{active.question}</h2><div className="detail-status"><Status status={evaluation?.status} /><span>{evaluation ? `${issues(evaluation).length} 项需关注` : "运行核验后查看发现"}</span></div>
                <div className="profile-switch" aria-label="切换相同版本的用户画像">{workspace.profiles.map((profile) => { const counterpart = samples.find((sample) => sample.questionId === active.questionId && sample.promptVersion === active.promptVersion && sample.modelVersion === active.modelVersion && sample.dataVersion === active.dataVersion && sample.profileId === profile.id); return <button key={profile.id} title={profile.description} aria-pressed={profile.id === active.profileId} disabled={!counterpart} className={profile.id === active.profileId ? "selected" : ""} onClick={() => counterpart && selectSample(counterpart)}>{profile.name}</button>; })}</div>
                <div className="profile-context"><span>匿名画像</span>{activeProfile?.knowledge} · {activeProfile?.risk} · {activeProfile?.horizon}</div><div className="detail-tabs" role="tablist" aria-label="回答详情内容">{[{ id: "answer", title: "回答与发现" }, { id: "evidence", title: "证据来源" }, { id: "review", title: "人工复核" }].map((tab) => <button key={tab.id} role="tab" aria-selected={detailTab === tab.id} className={detailTab === tab.id ? "active" : ""} onClick={() => setDetailTab(tab.id)}>{tab.title}{tab.id === "review" && <span className="tab-dot" />}</button>)}</div>
                <div className="detail-body" role="tabpanel">
                  {detailTab === "answer" && <><div className="section-caption"><span><MessageSquare size={13} />回答原文</span><span>{active.provenance === "constructed" ? "构造样例" : active.provenance === "imported" ? "导入内容" : "模型生成"}</span></div><div className="answer-text">{active.answer}</div><div className="version-line"><span><code>{active.promptVersion}</code><span>{active.modelVersion}</span></span><span title={active.createdAt}>{date(active.createdAt)}</span></div><div className="findings-heading"><h3>核验发现</h3><span>{evaluation?.findings.length ?? 0} 项</span></div>{evaluation ? <div className="finding-list">{evaluation.findings.map((finding) => <div key={finding.id} className={`finding finding-${finding.status}`}><div className="finding-top"><span className="finding-icon">{finding.status === "supported" ? <Check size={13} /> : finding.status === "contradicted" ? <X size={13} /> : <CircleHelp size={13} />}</span><strong>{finding.title}</strong><span>{DIMENSIONS[finding.dimension]}</span></div>{finding.quote && <blockquote>{finding.quote}</blockquote>}<p>{finding.detail}</p>{finding.expected && <div className="expected-value"><span>参考依据</span><strong>{finding.expected}</strong></div>}{finding.evidenceId && <button className="text-button" onClick={() => setDetailTab("evidence")}>查看原始出处 <ArrowRight size={12} /></button>}<div className="finding-method">{{ rule: "规则检查", evidence: "字段核验", paired: "画像配对", model: "AI 辅助" }[finding.method]} · {STATUS_LABELS[finding.status]}</div></div>)}</div> : <Empty title="这条回答还未评测">运行规则核验，查看可追溯的发现。</Empty>}
                    <details className="revision-box" key={active.id}><summary><PencilLine size={13} />修订后回归<ChevronDown size={13} /></summary><RevisionForm sample={active} busy={!!busy} mutate={mutate} onAdded={openAdded} /></details>
                    <div className="feedback-block"><span>这些发现对你有帮助吗？</span><div><button disabled={!!busy} onClick={() => mutate("feedback", { sampleId: active.id, kind: "useful", comment: "" }, "已记录“有帮助”反馈")}><ThumbsUp size={13} />有帮助</button><button disabled={!!busy} onClick={() => mutate("feedback", { sampleId: active.id, kind: "not_useful", comment: "" }, "已记录“无帮助”反馈")}><ThumbsDown size={13} />无帮助</button><button disabled={!!busy} onClick={() => setDetailTab("review")}><MessageSquare size={13} />异议</button></div></div></>}
                  {detailTab === "evidence" && <EvidencePanel sample={active} workspace={workspace} />}
                  {detailTab === "review" && <ReviewPanel key={evaluation?.id ?? active.id} sample={active} evaluation={evaluation} workspace={workspace} busy={!!busy} mutate={mutate} />}
                </div><div className="detail-bottom"><ShieldCheck size={12} />{evaluation?.mode === "rules+model" ? "规则核验 + AI 辅助 · 最终判定由人工负责" : "规则核验 · 不能据此作出投资决策"}</div>
              </> : <Empty title="尚无回答样本">新增一条问答开始质检。</Empty>}</section>
            </div>
            <div className={`data-notice ${conflictSources.length ? "data-notice-conflict" : ""}`}><Database size={16} /><div><strong>{conflictSources.length ? `${conflictSources.length} 个数据来源存在口径或字段冲突` : "来源与时效边界"}</strong><p>{workspace.connection.notice}</p></div><span title={workspace.connection.snapshotAt}>快照 {workspace.connection.snapshotAt.slice(0, 10)}</span></div>
          </>}
          {view === "compare" && <Comparison workspace={workspace} latest={latest} onOpen={(sample) => { selectSample(sample); switchView("workspace"); }} />}
          {view === "governance" && <Governance workspace={workspace} onOpen={(sample) => { selectSample(sample); setDetailTab("review"); switchView("workspace"); }} />}
          <footer className="page-footer"><span>观鉴 · 投资回答质检</span><span>事实可追溯 / 判定有边界 / 处理留记录</span></footer>
        </>}
      </div>
    </main>
    {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}<button aria-label="关闭提示" onClick={() => setToast("")}><X size={14} /></button></div>}
    {showImport && workspace && <Modal title="新增问答样本" onClose={() => setShowImport(false)}><ImportForm workspace={workspace} busy={!!busy} error={error} onSubmit={async (body) => { const result = await mutate("samples", body, "问答已加入工作台"); if (result) { openAdded(result); setShowImport(false); } }} /></Modal>}
  </div>;
}

function Metric({ label, value, unit, icon, detail, note, percent, tone = "" }: { label: string; value: string | number; unit: string; icon: ReactNode; detail: string; note?: string; percent: number; tone?: string }) {
  return <div className="metric-card"><div><span>{label}</span>{icon}</div><strong className={tone === "danger" ? "number-danger" : ""}>{value}<small>{unit}</small></strong><p><span>{detail}</span>{note && <span className="subtle">{note}</span>}</p><div className={`metric-track ${tone}`}><span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div></div>;
}

function ImportForm({ workspace, busy, error, onSubmit }: { workspace: Workspace; busy: boolean; error: string; onSubmit: (body: Record<string, unknown>) => Promise<void> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body: Record<string, unknown> = { question: data.get("question"), answer: data.get("answer"), intent: data.get("intent"), profileId: data.get("profileId") };
    for (const key of ["promptVersion", "modelVersion", "dataVersion"]) { const value = String(data.get(key) ?? "").trim(); if (value) body[key] = value; }
    await onSubmit(body);
  }
  return <form className="import-form" onSubmit={submit}><p className="form-description">导入待检查的原始问答。请使用匿名信息，避免填写真实持仓、账号与个人隐私。</p>{error && <p className="error-banner" role="alert">{error}</p>}<label>用户问题<input name="question" placeholder="例如：这份年报中的营业收入是多少？" required maxLength={500} autoFocus /></label><label>回答原文<textarea name="answer" rows={6} required maxLength={4000} placeholder="粘贴需要检查的完整回答…" /></label><div className="form-columns"><label>问答意图<select name="intent"><option value="fact">事实查询</option><option value="explanation">证据解释</option></select></label><label>匿名画像<select name="profileId">{workspace.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label></div><details className="revision-box version-metadata"><summary><Layers3 size={13} />版本信息（可选）<ChevronDown size={13} /></summary><div className="metadata-fields"><label>Prompt 版本<input name="promptVersion" maxLength={40} placeholder="留空使用默认标签" /></label><label>模型版本<input name="modelVersion" maxLength={100} placeholder="例如：实际生成回答的模型版本" /></label><label>数据版本<input name="dataVersion" maxLength={100} placeholder="例如：回答生成时使用的数据快照" /></label></div><p className="form-description">版本标签由导入者提供；核验仍使用当前固定官方证据。相同问题文本会归入同题，其他条件一致时可进行版本对照。</p></details><div className="form-note"><CircleHelp size={15} /><span>新增内容标记为“手动导入”。缺少可匹配数据时，核验结果会保留为无法核验。</span></div><button className="button button-primary full-width" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}添加到工作台</button></form>;
}
function RevisionForm({ sample, busy, mutate, onAdded }: { sample: Sample; busy: boolean; mutate: Mutation; onAdded: (workspace: Workspace) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const result = await mutate("revisions", { sampleId: sample.id, answer: data.get("answer"), promptVersion: data.get("promptVersion") }, "修订已保存并完成规则回归，旧记录已保留"); if (result) onAdded(result); }
  const number = Number(sample.promptVersion.match(/\d+/)?.[0] ?? 2);
  return <form className="review-form" onSubmit={submit}><p className="form-description">保留原回答、画像与数据版本，新建修订样本并再次核验。</p><label>修订版本<input name="promptVersion" defaultValue={`v${Math.max(3, number + 1)}`} required maxLength={40} /></label><label>修订后的完整回答<textarea name="answer" rows={5} defaultValue={sample.answer} required maxLength={4000} /></label><button className="button button-primary full-width" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}保存修订并回归</button></form>;
}

function EvidencePanel({ sample, workspace }: { sample: Sample; workspace: Workspace }) {
  return <><div className="evidence-intro"><Database size={16} /><div><strong>数据快照 · {sample.dataVersion}</strong><p>历史财务资料用于核验指定期间事实，不等同于当前行情。</p></div></div>{sample.evidenceIds.length ? sample.evidenceIds.map((id) => { const evidence = workspace.evidence.find((item) => item.id === id); if (!evidence) return <div className="source-conflict" key={id}>找不到证据 {id}，当前无法核验。</div>; return <article className="evidence-card" key={id}><div className="evidence-provider"><span><FileText size={13} />{evidence.provider}</span><span className={evidence.status === "conflict" ? "danger-text" : "teal-text"}>{evidence.status === "conflict" ? "存在来源冲突" : "已保存出处"}</span></div><h3>{evidence.title}</h3><dl><div><dt>报告期间</dt><dd>{evidence.period}</dd></div><div><dt>发布日期</dt><dd>{evidence.publishedAt || "未提供"}</dd></div><div><dt>获取时间</dt><dd>{evidence.retrievedAt}</dd></div></dl><blockquote>{evidence.excerpt}</blockquote>{evidence.facts.map((fact) => <div className="fact-row" key={fact.id}><span>{fact.metric}<small>{fact.period} · 第 {fact.page} 页</small></span><strong>{fact.value.toLocaleString("zh-CN", { maximumFractionDigits: 4 })}<small>{fact.unit}</small></strong></div>)}{evidence.note && <p className={evidence.status === "conflict" ? "source-conflict" : "source-note"}>{evidence.note}</p>}{evidence.url ? <a className="source-link" href={evidence.url} target="_blank" rel="noopener noreferrer">打开原始出处<ExternalLink size={13} /></a> : <p className="source-note">接口未返回原文链接，请以已核验官方资料为准。</p>}</article>; }) : <Empty title="没有绑定事实来源">这条导入回答缺少指定数据出处；相关事实应保持无法核验。</Empty>}</>;
}

function ReviewPanel({ sample, evaluation, workspace, busy, mutate }: { sample: Sample; evaluation?: Evaluation; workspace: Workspace; busy: boolean; mutate: Mutation }) {
  const reviews = workspace.reviews.filter((review) => review.evaluationId === evaluation?.id);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!evaluation) return; const form = event.currentTarget, data = new FormData(form); const result = await mutate("reviews", { evaluationId: evaluation.id, decision: data.get("decision"), comment: data.get("comment") }, "人工复核记录已保存"); if (result) form.reset(); }
  async function dispute(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const result = await mutate("feedback", { sampleId: sample.id, kind: "dispute", comment: new FormData(form).get("comment") }, "异议已记录，等待复核"); if (result) form.reset(); }
  return <><div className="review-state"><ClipboardCheck size={20} /><div><strong>{reviews.length ? `已有 ${reviews.length} 次人工判定` : "待人工复核"}</strong><p>系统不会自动创建或替你确认人工标签。</p></div></div>{reviews.map((review) => <div className="review-record" key={review.id}><div><strong>{DECISIONS[review.decision]}</strong><span>{date(review.createdAt)}</span></div><p>{review.comment}</p></div>)}{evaluation ? <form className="review-form" onSubmit={submit}><h3>提交你的复核判定</h3><label htmlFor="review-decision">判定结果<select id="review-decision" name="decision" required defaultValue=""><option value="" disabled>请选择判定</option>{Object.entries(DECISIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label htmlFor="review-comment">依据与处理说明<textarea id="review-comment" name="comment" required minLength={2} maxLength={600} rows={3} placeholder="写明你的核对依据，或还需要补充哪些数据…" /></label><button className="button button-primary full-width" disabled={busy}><ClipboardCheck size={14} />确认并提交复核</button></form> : <p className="form-note">先运行一次评测，才能对具体评测结果复核。</p>}<form className="review-form dispute-form" onSubmit={dispute}><h3>反馈有问题的判定</h3><label htmlFor="dispute-comment">异议内容<textarea id="dispute-comment" name="comment" required minLength={2} maxLength={600} rows={2} placeholder="哪些结论与你看到的证据不一致？" /></label><button className="button full-width" disabled={busy}><MessageSquare size={14} />提交异议反馈</button></form></>;
}

function Comparison({ workspace, latest, onOpen }: { workspace: Workspace; latest: Map<string, Evaluation>; onOpen: (sample: Sample) => void }) {
  const axes = [{ key: "promptVersion", label: "Prompt" }, { key: "modelVersion", label: "模型" }, { key: "dataVersion", label: "数据" }] as const;
  type Axis = typeof axes[number]["key"];
  const [axis, setAxis] = useState<Axis>("promptVersion");
  const versionOptions = (key: Axis) => [...new Set(workspace.samples.map((sample) => sample[key]))].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const versions = versionOptions(axis);
  const [beforeVersion, setBeforeVersion] = useState(versions[0] ?? "");
  const [afterVersion, setAfterVersion] = useState(versions[1] ?? "");
  const axisLabel = axes.find((item) => item.key === axis)!.label;
  const fixedAxes = axes.filter((item) => item.key !== axis);
  const hasVersions = versions.length >= 2;
  function changeAxis(next: Axis) { const options = versionOptions(next); setAxis(next); setBeforeVersion(options[0] ?? ""); setAfterVersion(options[1] ?? ""); }
  const pairs = hasVersions ? workspace.samples.filter((sample) => sample[axis] === beforeVersion).map((a) => {
    const matches = workspace.samples.filter((sample) => sample[axis] === afterVersion && sample.questionId === a.questionId && sample.profileId === a.profileId && fixedAxes.every((field) => sample[field.key] === a[field.key]));
    const b = matches.length === 1 ? matches[0] : undefined;
    const left = latest.get(a.id), right = b ? latest.get(b.id) : undefined;
    const comparable = !!b && a.id !== b.id && !!left && !!right && left.evaluatorVersion === right.evaluatorVersion;
    const leftIssues = issues(left), rightIssues = issues(right);
    return { a, b, left, right, comparable, ambiguous: matches.length > 1, fixed: comparable ? leftIssues.filter((finding) => !rightIssues.some((other) => issueKey(other) === issueKey(finding))) : [], added: comparable ? rightIssues.filter((finding) => !leftIssues.some((other) => issueKey(other) === issueKey(finding))) : [], remaining: comparable ? rightIssues.filter((finding) => leftIssues.some((other) => issueKey(other) === issueKey(finding))) : [] };
  }) : [];
  const comparable = pairs.filter((pair) => pair.comparable);
  const totals = comparable.reduce((sum, pair) => ({ fixed: sum.fixed + pair.fixed.length, added: sum.added + pair.added.length, remaining: sum.remaining + pair.remaining.length }), { fixed: 0, added: 0, remaining: 0 });
  return <>
    <section className="panel compare-controls"><div><h2>单变量版本对照</h2><p>固定问题、画像、{fixedAxes.map((item) => item.label).join("、")}与评测器，只改变{axisLabel}版本。</p><div className="axis-switch" role="group" aria-label="对比维度">{axes.map((item) => <button key={item.key} aria-pressed={axis === item.key} className={axis === item.key ? "active" : ""} onClick={() => changeAxis(item.key)}>{item.label}</button>)}</div></div><div className="version-selects"><label><span>基准{axisLabel}版本</span><select aria-label="基准版本" value={beforeVersion} onChange={(event) => setBeforeVersion(event.target.value)}>{versions.map((version) => <option key={version}>{version}</option>)}</select></label><ArrowRight size={20} /><label><span>对比{axisLabel}版本</span><select aria-label="对比版本" value={afterVersion} disabled={!hasVersions} onChange={(event) => setAfterVersion(event.target.value)}>{!hasVersions && <option value="">等待另一版本</option>}{versions.map((version) => <option key={version}>{version}</option>)}</select></label></div></section>
    <div className="comparison-notice"><FlaskConical size={17} /><p>初始回答为构造样例，导入版本标签由导入者提供。这里比较已有回答，<strong>不实时生成模型回答，不证明版本改动的因果效果</strong>；数据版本标签不会切换当前固定官方核验依据。</p></div>
    {!hasVersions ? <section className="panel"><Empty title={`当前只有 ${versions.length} 个${axisLabel}版本`}>导入同题不同{axisLabel}版本的回答后比较。请保持画像、{fixedAxes.map((item) => item.label).join("与")}版本一致。</Empty></section> : <>
      <div className="compare-metrics"><div className="panel"><span><CheckCircle2 size={17} />未再出现的发现</span><strong className="teal-text">{totals.fixed}<small>项</small></strong><p>原版本发现，在对比版本中未出现</p></div><div className="panel"><span><TriangleAlert size={17} />新增发现</span><strong className="danger-text">{totals.added}<small>项</small></strong><p>对比版本新识别出的待处理问题</p></div><div className="panel"><span><History size={17} />遗留发现</span><strong>{totals.remaining}<small>项</small></strong><p>两个版本都存在的同类问题</p></div></div>
      <section className="panel comparison-table"><div className="panel-heading"><div><h2>逐条回归<span className="count-label">{comparable.length} 组可比较</span></h2><p>按维度、事实字段与发现标题匹配。未再检出仍需人工确认修复。</p></div><span className="subtle">{pairs.length - comparable.length} 组暂不可比较</span></div><div className="table-scroll"><table><thead><tr><th>问题 / 配对固定条件</th><th>基准{axisLabel}版本</th><th>对比{axisLabel}版本</th><th>回归变化</th><th /></tr></thead><tbody>{pairs.map((pair) => <tr key={pair.a.id}><td><strong className="compare-question">{pair.a.question}</strong><div className="sample-meta">画像：{workspace.profiles.find((profile) => profile.id === pair.a.profileId)?.name}</div><div className="comparison-fixed">{fixedAxes.map((field) => <span key={field.key}>{field.label}：{pair.a[field.key]}</span>)}<span>评测器：{pair.left?.evaluatorVersion ?? "尚未评测"}</span></div></td><td><div className="comparison-version"><code>{pair.a[axis]}</code><Status status={pair.left?.status} /></div></td><td>{pair.b ? <div className="comparison-version"><code>{pair.b[axis]}</code><Status status={pair.right?.status} /></div> : <span className="subtle">{pair.ambiguous ? "有多条候选，无法唯一配对" : "无配对样本"}</span>}</td><td>{pair.comparable ? <div className="change-tags"><span className="change-fixed">− {pair.fixed.length}</span><span className="change-added">+ {pair.added.length}</span><span>遗留 {pair.remaining.length}</span><details className="compare-findings"><summary>明细</summary><p>未再出现：{pair.fixed.map((finding) => finding.title).join("；") || "无"}</p><p>新增：{pair.added.map((finding) => finding.title).join("；") || "无"}</p><p>遗留：{pair.remaining.map((finding) => finding.title).join("；") || "无"}</p></details></div> : <span className="subtle">{beforeVersion === afterVersion ? "请选择不同版本" : pair.ambiguous ? "请使用唯一版本标签" : !pair.b ? "缺少相同固定条件样本" : !pair.left || !pair.right ? "等待两版本评测" : "评测器版本不一致"}</span>}</td><td><button className="text-button" onClick={() => onOpen(pair.b ?? pair.a)}>查看 <ArrowRight size={13} /></button></td></tr>)}</tbody></table></div>{!pairs.length && <Empty title="暂无可比较样本">添加两个版本的相同问题后进行比较。</Empty>}</section>
    </>}
  </>;
}
function Governance({ workspace, onOpen }: { workspace: Workspace; onOpen: (sample: Sample) => void }) {
  const [tab, setTab] = useState("events");
  const sample = (id: string) => workspace.samples.find((item) => item.id === id);
  const actions: Record<string, string> = { evaluate: "运行质量评测", review: "提交人工复核", feedback: "提交用户反馈", import: "新增问答样本", seed: "初始化示例", evaluation: "运行质量评测", sample: "新增问答样本", revision: "保存修订并回归" };
  return <><div className="governance-summary"><div><History size={18} /><strong>{workspace.events.length}</strong><span>操作记录</span></div><div><ClipboardCheck size={18} /><strong>{workspace.reviews.length}</strong><span>人工判定</span></div><div><MessageSquare size={18} /><strong>{workspace.feedback.length}</strong><span>反馈记录</span></div></div><section className="panel governance-panel"><div className="governance-tabs"><button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>操作记录</button><button className={tab === "reviews" ? "active" : ""} onClick={() => setTab("reviews")}>人工复核</button><button className={tab === "feedback" ? "active" : ""} onClick={() => setTab("feedback")}>用户反馈</button></div>
    {tab === "events" && <div className="timeline">{[...workspace.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((event) => <div className="timeline-item" key={event.id}><div className="timeline-icon"><Activity size={16} /></div><div><strong>{actions[event.action] ?? event.action}</strong><p>{event.detail}</p></div><time>{date(event.createdAt)}</time></div>)}{!workspace.events.length && <Empty title="尚无操作记录">评测、导入、复核与反馈将在这里留下记录。</Empty>}</div>}
    {tab === "reviews" && <div className="record-list">{[...workspace.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((review) => <article key={review.id} className="governance-record"><div><span className="record-label"><ClipboardCheck size={14} />{DECISIONS[review.decision]}</span><time>{date(review.createdAt)}</time></div><h3>{sample(review.sampleId)?.question ?? review.sampleId}</h3><p>{review.comment}</p><button className="text-button" onClick={() => { const target = sample(review.sampleId); if (target) onOpen(target); }}>查看回答与证据 <ArrowRight size={13} /></button></article>)}{!workspace.reviews.length && <Empty title="暂无人工判定">初始标签均为待复核。只有实际提交的复核才会出现在这里。</Empty>}</div>}
    {tab === "feedback" && <div className="record-list">{[...workspace.feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((feedback) => <article key={feedback.id} className="governance-record"><div><span className="record-label"><MessageSquare size={14} />{FEEDBACK[feedback.kind]}</span><time>{date(feedback.createdAt)}</time></div><h3>{sample(feedback.sampleId)?.question ?? feedback.sampleId}</h3><p>{feedback.comment || "未填写补充说明"}</p><div className="record-bottom"><span>页面访客反馈 · 不等同于真实用户研究</span><button className="text-button" onClick={() => { const target = sample(feedback.sampleId); if (target) onOpen(target); }}>进入复核 <ArrowRight size={13} /></button></div></article>)}{!workspace.feedback.length && <Empty title="暂无用户反馈">在回答详情中提交反馈，或对有争议的判定提出异议。</Empty>}</div>}
    </section><div className="audit-note"><ShieldCheck size={16} /><span>复核只标注具体评测，不覆盖旧回答与旧记录。修改后需新一轮评测验证。</span></div></>;
}
