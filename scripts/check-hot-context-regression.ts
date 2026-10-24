import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { EVALUATOR_VERSION, evaluate } from "../lib/evaluator.ts";
import { seedSamples } from "../lib/seed.ts";
import { HOT_SAMPLES, WORKSPACE_EVIDENCE } from "../lib/hot-context.ts";
import { actionableRuleFindings, classificationCounts } from "../lib/validation.ts";
import type { Sample } from "../lib/domain.ts";

export function checkHotRegression() {
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const baseline = read("public/evidence/hot-context-baseline-rules-1.2.1.json");
  const heldout = read("public/evidence/quality-validation-20261025.json");
  const challenges = read("public/evidence/quality-regression-20261025.json").challenges;
  const at = baseline.evaluationAt;
  const seeds = seedSamples(at);
  const compare = (sample: Sample, peers: Sample[] = []) => {
    const result = evaluate(sample, peers, WORKSPACE_EVIDENCE, at);
    return { id: sample.id, status: result.status, titles: [...new Set(result.findings.map(f => f.title))].sort() };
  };
  const current = { seeds: seeds.map(s => compare(s, seeds)),
    holdout: heldout.cases.map((c: { sample: Sample }) => compare(c.sample)),
    challenges: challenges.map((c: { sample: Sample }) => compare(c.sample)) };
  for (const group of ["seeds", "holdout", "challenges"] as const)
    assert.deepEqual(current[group], baseline[group], `${group}: rules-1.2.1 status/title regression — stop`);
  for (const [path, hash] of Object.entries(baseline.hashes)) {
    if (path === "lib/evaluator.ts") continue;
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), hash, `${path} changed — stop`);
  }
  const seedResults = seeds.map(s => evaluate(s, seeds, WORKSPACE_EVIDENCE, at));
  const entityFalsePositives = seedResults.filter(e => e.findings.some(f => f.title === "回答可能使用了其他公司主体")).length;
  assert.equal(entityFalsePositives, 0);
  const planted = seedResults.filter(e => /^Q0[12]-(novice|experienced)-v1$/.test(e.sampleId));
  assert.equal(planted.length, 4);
  assert.ok(planted.every(e => e.findings.some(f => f.title === "营业收入与原文冲突" && f.status === "contradicted")));
  const metrics = classificationCounts(heldout.cases.map((c: { sample: Sample; label: { needsReview: boolean } }) => ({
    id: c.sample.id, expected: c.label.needsReview, predicted: actionableRuleFindings(evaluate(c.sample, [], WORKSPACE_EVIDENCE, at)).length > 0,
  })));
  assert.deepEqual([metrics.tp, metrics.fp, metrics.fn, metrics.tn], [6, 0, 0, 6]);
  const demos = HOT_SAMPLES.map(sample => ({ ...compare(sample), askedAt: sample.askedAt }));
  assert.deepEqual(demos.map(d => d.status), ["supported", "unverifiable", "contradicted"]);
  assert.ok(demos[1].titles.includes("过期热点不能作为今天或最新消息"));
  assert.ok(demos[2].titles.includes("热点不能改写已登记财务事实"));
  return { baselineCommit: baseline.commit, baselineVersion: baseline.version, version: EVALUATOR_VERSION,
    evaluationAt: at, entityFalsePositives, plantedRevenueConflicts: planted.length, metrics, ...current, demos,
    queryCalls: 1, modelCalls: 0, unchangedHashes: Object.keys(baseline.hashes).filter(p => p !== "lib/evaluator.ts") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = checkHotRegression();
  if (process.argv.includes("--write")) writeFileSync("public/evidence/hot-context-regression-rules-1.3.0.json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
