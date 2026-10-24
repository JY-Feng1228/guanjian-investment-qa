import test from "node:test";
import assert from "node:assert/strict";
import { classificationCounts, validationCanRequest, validationReservedSpend, type ValidationAttempt } from "../lib/validation.ts";

test("quality metrics preserve failures and never turn absent results into negative judgements",()=>{
  const result=classificationCounts([
    {id:"tp",expected:true,predicted:true},{id:"fp",expected:false,predicted:true},
    {id:"fn",expected:true,predicted:false},{id:"tn",expected:false,predicted:false},
    {id:"fail",expected:true,predicted:null},
  ]);
  assert.deepEqual(result,{total:5,completed:4,unavailable:1,tp:1,fp:1,fn:1,tn:1,precision:.5,recall:.5,agreement:.5});
  assert.equal(classificationCounts([]).recall,null);
});
test("second allowance protects unknown cost and a separate next-request reserve",()=>{
  const attempt={reservationUsd:.04,estimatedCostUsd:null} as ValidationAttempt;
  assert.equal(validationReservedSpend([attempt]),.1);
  assert.equal(validationCanRequest([attempt],.1),true);
  assert.equal(validationCanRequest([attempt,attempt,attempt],.11),false);
  assert.equal(validationCanRequest([],NaN),false);
});
