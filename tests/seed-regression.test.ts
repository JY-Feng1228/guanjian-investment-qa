import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate } from "../lib/evaluator.ts";
import { EVIDENCE, seedSamples } from "../lib/seed.ts";
import { actionableRuleFindings, type ValidationReport } from "../lib/validation.ts";
import type { Sample } from "../lib/domain.ts";

const at = "2026-10-25T00:00:00Z";
const samples = seedSamples(at);
const results = samples.map(sample => evaluate(sample, samples, EVIDENCE, at));

test("all 32 demo answers keep ordinary financial prose out of company detection", () => {
  assert.equal(samples.length, 32);
  const falseEntities = results.flatMap(result => result.findings
    .filter(finding => finding.title === "回答可能使用了其他公司主体")
    .map(finding => ({ sample: result.sampleId, quote: finding.quote })));
  assert.deepEqual(falseEntities, []);
});

test("all four Q01/Q02 v1 demo answers expose the planted revenue conflict", () => {
  const targets = results.filter(result => /^Q0[12]-(novice|experienced)-v1$/.test(result.sampleId));
  assert.equal(targets.length, 4);
  for (const result of targets) {
    assert.equal(result.status, "contradicted", result.sampleId);
    assert.ok(result.findings.some(finding => finding.dimension === "number" &&
      finding.title === "营业收入与原文冲突" && finding.status === "contradicted"), result.sampleId);
  }
});

test("the 12 validation cases and three challenges keep their reference flags and locate H08/C02", () => {
  const frozen = JSON.parse(readFileSync(new URL("../public/evidence/quality-validation-20261025.json", import.meta.url), "utf8")) as ValidationReport;
  const { challenges } = JSON.parse(readFileSync(new URL("../public/evidence/quality-regression-20261025.json", import.meta.url), "utf8")) as {
    challenges: { sample: Sample; reference: { needsReview: boolean } }[];
  };
  assert.equal(frozen.cases.length, 12);
  assert.equal(challenges.length, 3);
  for (const { sample, expected } of [
    ...frozen.cases.map(item => ({ sample: item.sample, expected: item.label.needsReview })),
    ...challenges.map(item => ({ sample: item.sample, expected: item.reference.needsReview })),
  ]) {
    const findings = actionableRuleFindings(evaluate(sample, [], EVIDENCE, at));
    assert.equal(findings.length > 0, expected, sample.id);
    if (sample.id === "H08" || sample.id === "C02") {
      assert.ok(!findings.some(f => f.title === "回答可能使用了其他公司主体"), sample.id);
      const title = sample.id === "H08" ? "未解释所问指标的含义差别" : "回答指标可能偏离问题";
      assert.ok(findings.some(f => f.title === title), sample.id);
    }
  }
});
