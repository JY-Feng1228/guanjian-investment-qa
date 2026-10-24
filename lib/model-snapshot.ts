import snapshotJson from "../public/evidence/openai-review-20261025.json" with {type: "json"};
import type { Evaluation, Evidence, Sample, Workspace } from "./domain.ts";
import type { ModelInspection, ModelInspectionError } from "./model.ts";
import { evaluate } from "./evaluator.ts";

type Record = {
  sampleId: string; inputHash: string; completedAt: string; status: "success" | "failed";
  result?: ModelInspection;
  error?: {code: string; usage: ModelInspectionError["usage"]; metadata: ModelInspectionError["metadata"]};
};
const snapshot = snapshotJson as unknown as {
  runId: string; completedAt: string; requestedModel: string; promptVersion: string;
  estimatedCostUsd: number; unknownCostCount: number; records: Record[];
};

export const modelSnapshotSummary: NonNullable<Workspace["connection"]["modelSnapshot"]> = {
  runId: snapshot.runId, completedAt: snapshot.completedAt, total: snapshot.records.length,
  succeeded: snapshot.records.filter(r => r.status === "success").length,
  failed: snapshot.records.filter(r => r.status === "failed").length,
  estimatedCostUsd: snapshot.estimatedCostUsd, unknownCostCount: snapshot.unknownCostCount,
};

async function matchesSnapshot(sample: Sample, evidence: Evidence[], expectedHash: string) {
  const {createdAt: _createdAt, ...stableSample} = sample;
  const identity = {sample: stableSample, evidence: evidence.filter(e => sample.evidenceIds.includes(e.id)), promptVersion: snapshot.promptVersion, requestedModel: snapshot.requestedModel};
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(identity)));
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2,"0")).join("") === expectedHash;
}

// A captured result is only reusable for the exact original answer, versions and evidence.
export async function snapshotEvaluations(samples: Sample[], evidence: Evidence[]): Promise<Evaluation[]> {
  const evaluations: Evaluation[] = [];
  for (const record of snapshot.records) {
    const sample = samples.find(s => s.id === record.sampleId);
    if (!sample || !(await matchesSnapshot(sample, evidence, record.inputHash))) continue;
    const metadata = record.result ?? record.error?.metadata;
    const usage = record.result?.usage ?? record.error?.usage;
    if (!metadata || !usage) continue;
    const rules = evaluate(sample, samples, evidence, record.completedAt);
    const modelFindings = record.result?.findings ?? [];
    const findings = [...rules.findings, ...modelFindings];
    const status = rules.status === "contradicted" ? "contradicted" : record.status === "failed" || findings.some(f => f.status === "unverifiable") ? "unverifiable" : findings.some(f => f.status === "review") ? "review" : rules.status;
    evaluations.push({
      ...rules, id: `snapshot-${snapshot.runId}-${sample.id}`, status, mode: "rules+model",
      evaluatorVersion: `${rules.evaluatorVersion}+${snapshot.requestedModel}-${snapshot.promptVersion}`,
      findings, modelStatus: record.status,
      modelRun: {provider: "OpenAI", requestedModel: metadata.requestedModel, model: metadata.model,
        promptVersion: metadata.promptVersion, requestId: metadata.requestId, responseId: metadata.responseId,
        completedAt: record.completedAt, usage, status: record.status,
        ...(record.error ? {errorCode: record.error.code} : {}),
      },
    });
  }
  return evaluations;
}
