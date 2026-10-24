import assert from "node:assert/strict";
const base=process.env.QA_BASE_URL??"http://127.0.0.1:5173";
let cookie="";
let checks=0;
async function request(path,body,expected=200,extra={}) {
  const response=await fetch(base+path,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json",...(cookie?{cookie}:{}),...extra},...(body===undefined?{}:{body:typeof body==="string"?body:JSON.stringify(body)})});
  assert.equal(response.status,expected,`${path} expected ${expected}, got ${response.status}`);
  cookie=response.headers.get("set-cookie")?.split(";")[0]??cookie;
  checks++;
  if(response.headers.get("content-type")?.includes("application/json")) return response.json();
  assert.ok(expected>=400,`${path} returned unexpected non-JSON content`);
  return {error:await response.text()};
}
const initial=await request("/api/workspace");
assert.equal(initial.samples.length,35); assert.equal(initial.reviews.length,0); assert.equal(initial.connection.modelEnabled,false);
assert.equal(initial.evaluations.filter(e=>e.mode==="rules").length,35); assert.ok(initial.evaluations.some(e=>e.status==="contradicted"));
const seedRules=initial.evaluations.filter(e=>e.mode==="rules"&&!e.sampleId.startsWith("HOT-"));
assert.equal(seedRules.length,32);
assert.ok(seedRules.every(e=>!e.findings.some(f=>f.title==="回答可能使用了其他公司主体")));
const expectedHot={"HOT-correct":"supported","HOT-expired":"unverifiable","HOT-overwrite":"contradicted"};
for (const [id,status] of Object.entries(expectedHot)) {
  assert.equal(initial.evaluations.find(e=>e.sampleId===id&&e.mode==="rules")?.status,status,id);
  assert.ok(initial.samples.find(s=>s.id===id)?.askedAt);
}
assert.ok(initial.evidence.some(e=>e.kind==="hotspot"&&e.publishedAt&&e.provider.includes("search_news")));
const {readFile}=await import("node:fs/promises");
const baseline=JSON.parse(await readFile(new URL("../public/evidence/hot-context-baseline-rules-1.2.1.json",import.meta.url),"utf8"));
for (const row of baseline.seeds) {
  const result=seedRules.find(e=>e.sampleId===row.id);
  assert.equal(result.status,row.status,row.id);
  assert.deepEqual([...new Set(result.findings.map(f=>f.title))].sort(),row.titles,row.id);
}
const plantedRevenueErrors=seedRules.filter(e=>/^Q0[12]-(novice|experienced)-v1$/.test(e.sampleId));
assert.equal(plantedRevenueErrors.length,4);
assert.ok(plantedRevenueErrors.every(e=>e.findings.some(f=>f.title==="营业收入与原文冲突"&&f.status==="contradicted")));
assert.ok(initial.connection.modelSnapshot); assert.equal(initial.evaluations.filter(e=>e.modelRun).length,initial.connection.modelSnapshot.total);
const capturedModel=initial.evaluations.find(e=>e.modelRun?.status==="success");
assert.ok(capturedModel); assert.ok(capturedModel.modelRun.usage.reported); assert.ok(capturedModel.findings.filter(f=>f.method==="model").every(f=>["review","unverifiable"].includes(f.status)));
await request("/api/reviews",{evaluationId:capturedModel.id,decision:"needs_data",comment:"自动化验收：独立模型记录的复核绑定检查，不是业务人工结论。"});
const withModelReview=await request("/api/workspace");
assert.equal(withModelReview.reviews.filter(r=>r.evaluationId===capturedModel.id).length,1);
assert.ok(!withModelReview.reviews.some(r=>initial.evaluations.some(e=>e.mode==="rules"&&e.id===r.evaluationId)));
const input={question:"贵州茅台2024年营业收入是多少？",answer:"2024年营业收入为1708.99亿元。",intent:"fact",profileId:"novice"};
const imported=await request("/api/samples",input);
const added=imported.samples.find(s=>s.provenance==="imported"); assert.ok(added);
const firstEval=imported.evaluations.find(e=>e.sampleId===added.id); assert.equal(firstEval.status,"supported");
await request("/api/reviews",{evaluationId:firstEval.id,decision:"confirmed",comment:"自动化验收输入：核对官方原文数字；本记录不是业务人工评估结论。"});
const rerun=await request("/api/evaluate",{sampleIds:[added.id]});
assert.equal(rerun.evaluations.filter(e=>e.sampleId===added.id).length,2);
assert.ok(rerun.reviews.filter(r=>r.sampleId===added.id).every(r=>r.evaluationId===firstEval.id));
const revised=await request("/api/revisions",{sampleId:added.id,answer:"2024年营业收入为1800亿元。",promptVersion:"smoke-revision"});
const revision=revised.samples.find(s=>s.promptVersion==="smoke-revision");
assert.equal(revision.questionId,added.questionId); assert.ok(revised.samples.some(s=>s.id===added.id));
assert.equal(revised.evaluations.find(e=>e.sampleId===revision.id).status,"contradicted");
assert.ok(!revised.evaluations.some(e=>e.sampleId===revision.id&&e.modelRun));
await request("/api/revisions",{sampleId:added.id,answer:input.answer,promptVersion:"smoke-revision"},409);
const feedback=await request("/api/feedback",{sampleId:added.id,kind:"dispute",comment:"自动化验收：反馈不修改事实判定。"});
assert.equal(feedback.feedback.length,1);
await request("/api/samples",{...input,answer:"手机号 13800000000"},400);
await request("/api/reviews",{evaluationId:firstEval.id,decision:"confirmed",comment:"sk-synthetic0123456789012"},400);
await request("/api/samples",{...input,intent:"unknown"},400);
await request("/api/evaluate",{sampleIds:["missing"]},404);
await request("/api/evaluate",{sampleIds:[added.id],useModel:true},400);
await request("/api/samples",input,403,{origin:"https://untrusted.example"});
await request("/api/samples","{broken",400);
await request("/api/samples",input,415,{"Content-Type":"text/plain"});
const persisted=await request("/api/workspace"); assert.equal(persisted.samples.length,37);
const modelPair=await request("/api/samples",{...input,modelVersion:"fixture-model-b"});
const modelVariant=modelPair.samples.find(s=>s.modelVersion==="fixture-model-b");
assert.equal(modelVariant.questionId,added.questionId); assert.equal(modelVariant.promptVersion,added.promptVersion); assert.equal(modelVariant.dataVersion,added.dataVersion);
await request("/api/samples",{...input,modelVersion:"fixture-model-b"},409);
const dataPair=await request("/api/samples",{...input,dataVersion:"fixture-data-b"});
const dataVariant=dataPair.samples.find(s=>s.dataVersion==="fixture-data-b");
assert.equal(dataVariant.questionId,added.questionId); assert.equal(dataVariant.modelVersion,added.modelVersion); assert.equal(dataVariant.promptVersion,added.promptVersion);
assert.deepEqual(dataVariant.evidenceIds,["S1"]);
const financial=await request("/api/samples",{...input,answer:"2024年营业收入为13900000000.25元。",modelVersion:"financial-privacy-check"});
assert.ok(financial.samples.some(s=>s.modelVersion==="financial-privacy-check"));
for (const [modelVersion,askedAt,answer,status,title] of [
  ["hot-import-future","2026-10-18T12:00:00+08:00","2024年营业收入为1708.99亿元。2026-10-19的新闻[HOT1]讨论渠道调整。","contradicted","热点发布时间晚于提问时间"],
  ["hot-import-expired","2026-10-28T12:00:00+08:00","2024年营业收入为1708.99亿元。今天最新热点[HOT1]是渠道调整。","unverifiable","过期热点不能作为今天或最新消息"],
  ["hot-import-overwrite","2026-10-25T12:00:00+08:00","根据新闻[HOT1]，2024年营业收入为1808.99亿元。","contradicted","热点不能改写已登记财务事实"],
]) {
  const workspace=await request("/api/samples",{...input,modelVersion,askedAt,answer});
  const sample=workspace.samples.find(s=>s.modelVersion===modelVersion);
  assert.deepEqual(sample.evidenceIds,["S1","HOT1"]);
  const evaluation=workspace.evaluations.find(e=>e.sampleId===sample.id);
  assert.equal(evaluation.status,status);
  assert.ok(evaluation.findings.some(f=>f.title===title));
}
await request("/api/samples",{...input,askedAt:"not-a-time"},400);
const ownCookie=cookie; cookie="";
const isolated=await request("/api/workspace"); assert.equal(isolated.samples.length,35); assert.equal(isolated.feedback.length,0);
await request("/api/reviews",{evaluationId:firstEval.id,decision:"confirmed",comment:"Cross sandbox check"},404);
cookie=ownCookie;
console.log(JSON.stringify({ok:true,httpChecks:checks,covered:["seed-and-auto-check","import","immutable-review-history","regression","revision","feedback","privacy","input-errors","cross-origin","cross-sandbox","paid-model-disabled","persistence","model-and-data-version-pairs","duplicate-version-rejection","32-seed-status-and-title-parity","three-hotspot-demos","hotspot-import-a-b-c","question-time-validation"],note:"Test mutations are isolated in a dedicated cookie sandbox; no model or iFinD requests."},null,2));
