import test from "node:test";
import assert from "node:assert/strict";
import { canStartRequest, reservedSpend } from "../lib/model-budget.ts";

test("unknown and interrupted requests retain budget instead of becoming free", () => {
  assert.equal(reservedSpend([{reservationUsd: 0.005, estimatedCostUsd: null}]), 0.10);
  assert.equal(reservedSpend([{reservationUsd: 0.15, estimatedCostUsd: null}]), 0.15);
  assert.equal(canStartRequest([{reservationUsd: 0.005, estimatedCostUsd: null},{reservationUsd: 0.005, estimatedCostUsd: null}],0.005), false);
  assert.equal(canStartRequest([{reservationUsd: 0.005, estimatedCostUsd: 0.001}],0.005), true);
});

test("budget rejects invalid accounting and leaves next-request reserve", () => {
  assert.equal(canStartRequest([{reservationUsd: 0.1, estimatedCostUsd: 0.20}],0.01), false);
  assert.equal(canStartRequest([{reservationUsd: 0.01, estimatedCostUsd: -1}],0.01), false);
  assert.equal(canStartRequest([],Number.NaN), false);
  assert.equal(canStartRequest([],0), false);
});
