export type Intent = "fact" | "explanation";
export type CheckStatus = "supported" | "contradicted" | "unverifiable" | "review";
export type Severity = "high" | "medium" | "info";
export type Profile = { id: string; name: string; knowledge: string; risk: string; horizon: string; description: string };
export type Fact = { id: string; metric: string; period: string; value: number; unit: "元" | "%"; aliases: string[]; page: number };
export type Evidence = {
  id: string; title: string; provider: string; url: string; publishedAt: string;
  retrievedAt: string; period: string; kind: "official" | "mcp" | "hotspot"; status: "verified" | "conflict" | "snapshot";
  excerpt: string; facts: Fact[]; note: string;
};
export type Sample = {
  id: string; questionId: string; question: string; answer: string; intent: Intent; profileId: string;
  promptVersion: string; modelVersion: string; dataVersion: string; evidenceIds: string[];
  provenance: "constructed" | "imported" | "model"; createdAt: string; askedAt?: string;
};
export type Finding = {
  id: string; dimension: "number" | "period" | "freshness" | "relevance" | "reasoning" | "personalization" | "compliance" | "privacy" | "source";
  status: CheckStatus; severity: Severity; title: string; quote: string; detail: string;
  evidenceId?: string; factId?: string; expected?: string; observed?: string;
  method: "rule" | "evidence" | "paired" | "model";
};
export type Evaluation = {
  id: string; sampleId: string; createdAt: string; evaluatorVersion: string; status: CheckStatus;
  findings: Finding[]; checkedClaims: number; totalClaims: number;
  mode: "rules" | "rules+model"; modelStatus: "not_requested" | "success" | "failed";
  modelRun?: {
    provider: "OpenAI"; requestedModel: string; model: string | null; promptVersion: string;
    requestId: string | null; responseId: string | null; completedAt: string;
    usage: { reported: boolean; inputTokens: number | null; outputTokens: number | null; estimatedCostUsd: number | null };
    status: "success" | "failed"; errorCode?: string;
  };
};
export type Review = { id: string; evaluationId: string; sampleId: string; decision: "confirmed" | "false_positive" | "needs_data"; comment: string; createdAt: string };
export type Feedback = { id: string; sampleId: string; kind: "useful" | "not_useful" | "dispute"; comment: string; createdAt: string; origin: "visitor" };
export type AuditEvent = { id: string; action: string; detail: string; createdAt: string };
export type Workspace = {
  samples: Sample[]; evaluations: Evaluation[]; reviews: Review[]; feedback: Feedback[]; events: AuditEvent[];
  evidence: Evidence[]; profiles: Profile[];
  connection: { data: string; model: string; modelEnabled: boolean; snapshotAt: string; notice: string;
    modelSnapshot?: { runId: string; total: number; succeeded: number; failed: number; estimatedCostUsd: number; unknownCostCount: number; completedAt: string };
  };
};
export const DIMENSIONS: Record<Finding["dimension"], string> = {
  number: "数字与单位", period: "报告期间", freshness: "时效", relevance: "意图匹配", reasoning: "解释依据",
  personalization: "画像一致性", compliance: "合规边界", privacy: "隐私", source: "来源",
};
export const STATUS_LABELS: Record<CheckStatus, string> = { supported: "有证据支持", contradicted: "发现冲突", unverifiable: "无法核验", review: "待复核" };
