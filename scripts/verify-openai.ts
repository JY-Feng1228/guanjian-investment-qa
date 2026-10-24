import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EVIDENCE, seedSamples } from "../lib/seed.ts";
import { DEFAULT_MODEL, MODEL_INSPECTION_PROMPT, MODEL_MAX_OUTPUT_TOKENS, MODEL_PROMPT_VERSION, ModelInspectionError, inspectWithModel } from "../lib/model.ts";
import { APPROVED_BUDGET_USD, canStartRequest, reservedSpend } from "../lib/model-budget.ts";
import type { Sample } from "../lib/domain.ts";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(project, "private", "openai-verification-20261025.json");
const publicPath = path.join(project, "public", "evidence", "openai-review-20261025.json");
const runId = "openai-first-verification-20261025";
// Fixed before the first request; one sample per independent question, no failure replacement.
const selectedIds = ["Q01-novice-v2", "Q02-experienced-v1", "Q03-novice-v1", "Q04-experienced-v1", "Q05-novice-v2", "Q06-experienced-v1", "Q07-novice-v1", "Q08-experienced-v2"];
type Attempt = {
  sampleId: string; inputHash: string; startedAt: string; completedAt: string | null;
  state: "started" | "success" | "failed"; reservationUsd: number; estimatedCostUsd: number | null;
  result?: Awaited<ReturnType<typeof inspectWithModel>>;
  error?: { code: string; status?: number; usage: ModelInspectionError["usage"]; metadata: ModelInspectionError["metadata"] };
};
type Ledger = { runId: string; budgetUsd: number; selectedIds: string[]; createdAt: string; attempts: Attempt[] };
const samples = seedSamples("2026-10-25T00:00:00Z");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function inputIdentity(sample: Sample) {
  const {createdAt: _createdAt, ...stableSample} = sample;
  return {sample: stableSample, evidence: EVIDENCE.filter(e => sample.evidenceIds.includes(e.id)), promptVersion: MODEL_PROMPT_VERSION, requestedModel: DEFAULT_MODEL};
}
function reservationFor(sample: Sample) {
  // UTF-8 bytes plus a 4,096-token serialization/schema margin, at conservative input pricing.
  const inputUpperBound = Buffer.byteLength(JSON.stringify(inputIdentity(sample)) + MODEL_INSPECTION_PROMPT, "utf8") + 4096;
  return Number(((inputUpperBound * 0.25 + MODEL_MAX_OUTPUT_TOKENS * 0.50) / 1_000_000).toFixed(9));
}
async function atomicJson(destination: string, value: unknown) {
  await mkdir(path.dirname(destination), {recursive: true});
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {encoding: "utf8", flag: "wx"});
  await rename(temporary, destination);
}
async function exportSnapshot(ledger: Ledger) {
  const records = ledger.attempts.filter(a => a.state !== "started").map(a => ({
    sampleId: a.sampleId, inputHash: a.inputHash, completedAt: a.completedAt, status: a.state,
    ...(a.result ? {result: a.result} : {}), ...(a.error ? {error: a.error} : {}),
  }));
  await atomicJson(publicPath, {
    schemaVersion: 1, runId, createdAt: ledger.createdAt,
    completedAt: ledger.attempts.at(-1)?.completedAt ?? ledger.createdAt,
    provider: "OpenAI", requestedModel: DEFAULT_MODEL, promptVersion: MODEL_PROMPT_VERSION,
    selectedIds, records, budgetUsd: APPROVED_BUDGET_USD,
    estimatedCostUsd: Number(ledger.attempts.reduce((sum, a) => sum + (a.estimatedCostUsd ?? 0), 0).toFixed(9)),
    unknownCostCount: ledger.attempts.filter(a => a.estimatedCostUsd === null).length,
    reservedSpendUsd: Number(reservedSpend(ledger.attempts).toFixed(9)),
    note: "固定8个独立问题，每题一次，不重试、不替换失败样本。回答仍为构造样例，模型只作语义复核；估算不等于账单，未知费用单列。网页载入本次快照，不触发付费模型。",
  });
}

try {
  const mode = process.argv[2] ?? "--plan";
  if (!["--plan", "--probe", "--continue", "--continue-after-diagnosis"].includes(mode)) throw new Error("mode");
  let ledger: Ledger;
  try { ledger = JSON.parse(await readFile(ledgerPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    ledger = {runId, budgetUsd: APPROVED_BUDGET_USD, selectedIds, createdAt: new Date().toISOString(), attempts: []};
  }
  if (ledger.runId !== runId || ledger.budgetUsd !== APPROVED_BUDGET_USD || JSON.stringify(ledger.selectedIds) !== JSON.stringify(selectedIds)) throw new Error("ledger");
  if (mode === "--plan") {
    console.log(JSON.stringify({mode: "plan-only", model: DEFAULT_MODEL, budgetUsd: APPROVED_BUDGET_USD, planned: selectedIds.map(id => ({sampleId: id, reservationUsd: reservationFor(samples.find(s => s.id === id)!)})), attempted: ledger.attempts.length, reservedSpendUsd: reservedSpend(ledger.attempts), note: "No API request made."}, null, 2));
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey?.startsWith("sk-") || /[\r\n]/.test(apiKey)) throw new Error("credential");
    if (ledger.attempts.some(a => a.state === "started")) throw new Error("interrupted-request");
    if (ledger.attempts.some(a => a.state === "failed") && mode !== "--continue-after-diagnosis") throw new Error("previous-failure");
    if (mode === "--probe" && ledger.attempts.length) throw new Error("already-attempted");
    if (mode.startsWith("--continue") && ledger.attempts.length < 1) throw new Error("probe-required");
    const ids = mode === "--probe" ? selectedIds.slice(0, 1) : selectedIds.filter(id => !ledger.attempts.some(a => a.sampleId === id));
    for (const id of ids) {
      const sample = samples.find(s => s.id === id)!;
      const reservationUsd = reservationFor(sample);
      if (!canStartRequest(ledger.attempts, reservationUsd)) throw new Error("budget");
      const attempt: Attempt = {sampleId: id, inputHash: hash(inputIdentity(sample)), startedAt: new Date().toISOString(), completedAt: null, state: "started", reservationUsd, estimatedCostUsd: null};
      ledger.attempts.push(attempt);
      await atomicJson(ledgerPath, ledger); // Persist unknown-cost reservation before the network call.
      try {
        attempt.result = await inspectWithModel({sample, evidence: EVIDENCE, apiKey});
        attempt.state = "success";
        attempt.estimatedCostUsd = attempt.result.usage.estimatedCostUsd;
      } catch (error) {
        const safe = error instanceof ModelInspectionError ? error : new ModelInspectionError("network_error");
        attempt.state = "failed";
        attempt.error = {code: safe.code, ...(safe.status ? {status: safe.status} : {}), usage: safe.usage, metadata: safe.metadata};
        attempt.estimatedCostUsd = safe.usage.estimatedCostUsd;
      }
      attempt.completedAt = new Date().toISOString();
      await atomicJson(ledgerPath, ledger);
      await exportSnapshot(ledger);
      console.log(JSON.stringify({sampleId: id, state: attempt.state, findings: attempt.result?.findings.length ?? null, usage: attempt.result?.usage ?? attempt.error?.usage, errorCode: attempt.error?.code ?? null, httpStatus: attempt.error?.status ?? null}));
      if (attempt.state !== "success") {process.exitCode = 1; break;}
    }
  }
} catch {
  // Only a generic failure escapes; never emit error objects, headers, environment, or credential values.
  console.error("Verification stopped before another request. Check the selected mode, credential presence, existing ledger and budget; no automatic retry was made.");
  process.exitCode = 1;
}
