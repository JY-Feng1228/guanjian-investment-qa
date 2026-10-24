import type { Evaluation, Finding, Profile, Sample } from "./domain.ts";

export const VALIDATION_RUN_ID = "quality-validation-20261025-v1";
export const VALIDATION_MODELS = ["gpt-6-luna", "gpt-6.1-sol"] as const;
// Chosen before reading the new inputs or labels; never replace failed cases.
export const MODEL_CASE_IDS = ["H01", "H04", "H05", "H08", "H09", "H12"];
export const VALIDATION_BUDGET_USD = 0.50;
export const VALIDATION_UNKNOWN_RESERVE_USD = 0.10;
export type ValidationInput = { schemaVersion: 1; evaluationAsOf: string; profiles: Profile[]; cases: Pick<Sample, "id"|"question"|"answer"|"intent"|"profileId"|"evidenceIds">[] };
export type ReferenceLabel = { id: string; needsReview: boolean; expectedDimensions: Finding["dimension"][]; reason: string; sourcePages: number[] };
export type Classification = { id: string; expected: boolean; predicted: boolean | null };

export function classificationCounts(rows: Classification[]) {
  const valid = rows.filter(r => r.predicted !== null);
  const count = (expected: boolean, predicted: boolean) => valid.filter(r => r.expected === expected && r.predicted === predicted).length;
  const tp = count(true, true), fp = count(false, true), fn = count(true, false), tn = count(false, false);
  return { total: rows.length, completed: valid.length, unavailable: rows.length-valid.length, tp, fp, fn, tn,
    precision: tp+fp ? tp/(tp+fp) : null, recall: tp+fn ? tp/(tp+fn) : null,
    agreement: valid.length ? (tp+tn)/valid.length : null };
}

export function actionableRuleFindings(evaluation: Evaluation) {
  // Coverage notices describe the checker, not a demonstrated quality defect.
  // Freeze this policy before running the holdout; keep notices visible separately.
  return evaluation.findings.filter(f => f.status !== "supported"
    && !["没有可直接核验的财务断言", "还有数字未完成核验"].includes(f.title));
}

export function validationSample(input: ValidationInput["cases"][number]): Sample {
  return { ...input, questionId: input.id, promptVersion: "heldout-answer-v1", modelVersion: "AI构造 · 非API生成",
    dataVersion: "moutai-2024-verified-v1", provenance: "constructed", createdAt: "2026-10-25T00:00:00Z" };
}

export type ValidationAttempt = {
  key: string; sampleId: string; model: typeof VALIDATION_MODELS[number]; group: "holdout"|"regression";
  inputHash: string; startedAt: string; completedAt: string | null; state: "started"|"success"|"failed";
  reservationUsd: number; estimatedCostUsd: number | null; findings?: Finding[];
  usage?: { reported: boolean; inputTokens: number | null; outputTokens: number | null; estimatedCostUsd: number | null };
  metadata?: { requestedModel: string; model: string|null; promptVersion: string; requestId: string|null; responseId: string|null; reasoningEffort?: string };
  error?: { code: string; status?: number; diagnosis?: string };
};
export function validationReservedSpend(attempts: ValidationAttempt[]) {
  return attempts.reduce((sum,a)=>sum+(a.estimatedCostUsd ?? Math.max(VALIDATION_UNKNOWN_RESERVE_USD,a.reservationUsd)),0);
}
export function validationCanRequest(attempts: ValidationAttempt[], reservation: number) {
  return Number.isFinite(reservation) && reservation > 0
    && attempts.every(a => Number.isFinite(a.reservationUsd) && a.reservationUsd > 0 && (a.estimatedCostUsd === null || Number.isFinite(a.estimatedCostUsd) && a.estimatedCostUsd >= 0))
    && validationReservedSpend(attempts)+reservation+VALIDATION_UNKNOWN_RESERVE_USD <= VALIDATION_BUDGET_USD;
}

export type ValidationReport = {
  schemaVersion: 1; runId: string; generatedAt: string; protocolHash: string; frozenAt: string;
  labelStatus: string; labelConfirmation: { confirmedAt: string; source: string } | null;
  models: readonly string[]; selectedModelCaseIds: string[]; budgetUsd: number; knownEstimatedCostUsd: number;
  unknownCostCount: number; reservedSpendUsd: number; attempts: ValidationAttempt[];
  ruleMetrics: ReturnType<typeof classificationCounts>;
  modelMetrics: { model: string; metrics: ReturnType<typeof classificationCounts>; commonMetrics: ReturnType<typeof classificationCounts>;
    attempted: number; succeeded: number; failed: number; notAttempted: number; inProgress: number }[];
  commonPairs: number; commonPairIds: string[];
  cases: { sample: Sample; label: ReferenceLabel; ruleEvaluation: Evaluation; ruleFlag: boolean; modelSelected: boolean }[];
  improvements: { id: string; title: string; sampleBefore: Sample; sampleAfter: Sample; hypothesis: string;
    evidenceSteps: string[]; changes: string[]; remainingLimit: string; before: Evaluation; after: Evaluation }[];
  rulesVersion: string; limits: string[];
};
