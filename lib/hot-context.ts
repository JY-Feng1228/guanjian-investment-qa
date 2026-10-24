import type { Evidence, Sample } from "./domain.ts";
import { EVIDENCE, seedSamples } from "./seed.ts";

export const HOT_EVIDENCE: Evidence[] = [{
  id: "HOT1", title: "贵州茅台渠道改革与产品结构调整 · 新闻快照",
  provider: "iFinD MCP · search_news", kind: "hotspot", status: "snapshot",
  url: "https://news.sohu.com/a/1089599289_122014422",
  publishedAt: "2026-10-19", retrievedAt: "2026-10-24T23:09:24.3497754+00:00",
  period: "2026-10-19 新闻背景", facts: [],
  excerpt: "该新闻片段讨论贵州茅台的产品结构与渠道调整，包括飞天茅台上线 i茅台，以及代售、寄售模式。",
  note: "带日期的真实 iFinD 新闻检索摘要，仅作为热点背景；未独立核验全文，不登记为财务真值。来源工具 search_news，查询时间见获取时间。接口只提供发布日期，未提供发布时分秒；按北京时间当日零点进行日期粒度检查。脱敏调用记录：/evidence/hot-context-ifind-20261025.json。",
}];

export const WORKSPACE_EVIDENCE = [...EVIDENCE, ...HOT_EVIDENCE];
const common = {
  intent: "fact", profileId: "novice", promptVersion: "hot-context-demo-v1",
  modelVersion: "构造示例 · 无模型生成", dataVersion: "moutai-hot-snapshot-20261025",
  evidenceIds: ["S1", "HOT1"], provenance: "constructed",
} as const;
export const HOT_SAMPLES: Sample[] = [
  { ...common, evidenceIds: [...common.evidenceIds], id: "HOT-correct", questionId: "HOT-correct",
    question: "贵州茅台2024年营业收入是多少？请结合注明日期的热点背景。",
    answer: "2024年营业收入为1708.99亿元，财务事实以S1年报为准。2026-10-19发布的新闻[HOT1]讨论渠道改革与产品结构调整，仅作背景，不改写历史财报，也不据此推断股价。",
    askedAt: "2026-10-25T08:00:00+08:00", createdAt: "2026-10-25T08:00:00+08:00" },
  { ...common, evidenceIds: [...common.evidenceIds], id: "HOT-expired", questionId: "HOT-expired",
    question: "截至2026-10-28，贵州茅台最新热点和2024年营业收入是什么？",
    answer: "2024年营业收入为1708.99亿元。今天最新热点[HOT1]是渠道改革与产品结构调整。",
    askedAt: "2026-10-28T08:00:00+08:00", createdAt: "2026-10-25T08:00:00+08:00" },
  { ...common, evidenceIds: [...common.evidenceIds], id: "HOT-overwrite", questionId: "HOT-overwrite",
    question: "贵州茅台2024年营业收入能否依据热点为入门读者改写？",
    answer: "依据2026-10-19的新闻[HOT1]改写财报，为入门读者采用调整后的口径：2024年营业收入为1808.99亿元。",
    askedAt: "2026-10-25T08:00:00+08:00", createdAt: "2026-10-25T08:00:00+08:00" },
];

export const demoSamples = (now: string) => [...seedSamples(now), ...HOT_SAMPLES];
