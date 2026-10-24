import { test } from "node:test";
import assert from "node:assert/strict";
import { IMPROVEMENT_CASES, evaluateImprovementCase } from "../lib/improvement-cases.ts";
import { evaluate } from "../lib/evaluator.ts";
import { EVIDENCE } from "../lib/seed.ts";

const at = "2026-10-25T00:00:00.000Z";

test("the causal worked example retains the verified fact while withdrawing overreach", () => {
  const item = IMPROVEMENT_CASES.find((entry) => entry.id === "BC01")!;
  const { before, after } = evaluateImprovementCase(item, at);
  assert.ok(before.findings.some((finding) => finding.dimension === "reasoning"));
  assert.ok(before.findings.some((finding) => finding.dimension === "compliance"));
  assert.ok(!after.findings.some((finding) => ["reasoning", "compliance"].includes(finding.dimension)));
  assert.ok(after.findings.some((finding) => finding.factId === "revenue-growth-2024" && finding.status === "supported"));
  assert.equal(item.sampleAfter.id, "BC01-after");
  assert.equal(item.sampleAfter.provenance, "constructed");
  assert.equal(item.sampleAfter.modelVersion, item.sampleBefore.modelVersion);
  assert.equal(item.sampleAfter.dataVersion, item.sampleBefore.dataVersion);
});

test("the profile fix is evidence-backed and does not hide the reference by changing versions", () => {
  const item = IMPROVEMENT_CASES.find((entry) => entry.id === "BC02")!;
  const { before, after } = evaluateImprovementCase(item, at);
  assert.ok(before.findings.some((finding) => finding.dimension === "personalization"));
  assert.ok(before.findings.some((finding) => finding.factId === "net-profit-2024" && finding.status === "contradicted"));
  assert.ok(!after.findings.some((finding) => finding.dimension === "personalization"));
  assert.ok(after.findings.some((finding) => finding.factId === "net-profit-2024" && finding.status === "supported"));
  assert.equal(item.peersAfter[0].answer, item.peersBefore[0].answer);
  assert.equal(item.peersAfter[0].profileId, "experienced");
  assert.equal(item.peersAfter[0].promptVersion, item.sampleAfter.promptVersion);
  assert.equal(item.sampleAfter.promptVersion, "case-revision-v1");
  assert.equal(item.sampleAfter.id, "BC02-after");
  assert.equal(item.sampleAfter.provenance, "constructed");
  assert.deepEqual(item.sampleAfter.evidenceIds, item.sampleBefore.evidenceIds);
  const reintroduced = evaluate({ ...item.sampleAfter, answer: item.sampleBefore.answer }, item.peersAfter, EVIDENCE, at);
  assert.ok(reintroduced.findings.some((finding) => finding.dimension === "personalization"), "the unchanged reference must still catch the original wrong fact");
});
