import test from "node:test";
import assert from "node:assert/strict";
import { modelSnapshotSummary, snapshotEvaluations } from "../lib/model-snapshot.ts";
import { EVIDENCE, seedSamples } from "../lib/seed.ts";
import { evaluate } from "../lib/evaluator.ts";

test("real snapshot keeps all attempts, unknown usage and failed results separate from rules", async () => {
  const samples=seedSamples("2030-01-01T00:00:00Z");
  const records=await snapshotEvaluations(samples,EVIDENCE);
  assert.equal(records.length,8);
  assert.equal(modelSnapshotSummary.succeeded,6);
  assert.equal(modelSnapshotSummary.failed,2);
  const network=records.find(e=>e.modelRun?.errorCode==="network_error")!;
  assert.equal(network.modelRun?.usage.estimatedCostUsd,null);
  assert.equal(network.modelRun?.model,null);
  assert.ok(records.every(e=>e.mode==="rules+model"));
  assert.ok(samples.every(s=>evaluate(s,samples,EVIDENCE).mode==="rules"));
});

test("captured model results do not transfer to changed answer, version or source evidence", async () => {
  for (const change of [{answer:"changed"},{promptVersion:"changed"},{dataVersion:"changed"}]) {
    const samples=seedSamples("2030-01-01T00:00:00Z").map(s=>({...s,...change}));
    assert.equal((await snapshotEvaluations(samples,EVIDENCE)).length,0);
  }
  const changed=EVIDENCE.map(e=>({...e,note:e.note+" changed"}));
  assert.equal((await snapshotEvaluations(seedSamples("2030-01-01T00:00:00Z"),changed)).length,0);
});
