import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EVIDENCE } from "../lib/seed.ts";
import { evaluate, EVALUATOR_VERSION } from "../lib/evaluator.ts";
import { IMPROVEMENT_CASES } from "../lib/improvement-cases.ts";
import { buildModelRequest, estimateModelCostUsd, inspectWithModel, ModelInspectionError } from "../lib/model.ts";
import {
  VALIDATION_RUN_ID, VALIDATION_MODELS, MODEL_CASE_IDS, VALIDATION_BUDGET_USD,
  actionableRuleFindings, classificationCounts, validationSample, validationCanRequest, validationReservedSpend,
  type ReferenceLabel, type ValidationInput, type ValidationAttempt, type ValidationReport,
} from "../lib/validation.ts";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const privateFile=(name:string)=>path.join(root,"private",name);
const frozenPath=path.join(root,"public/evidence/quality-validation-frozen.json");
const reportPath=path.join(root,"public/evidence/quality-validation-20261025.json");
const ledgerPath=privateFile("quality-validation-ledger.json");
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const readJson=async(file:string)=>JSON.parse(await readFile(file,"utf8"));
async function atomicJson(file:string,value:unknown,createOnly=false) {
  await mkdir(path.dirname(file),{recursive:true});
  const text=JSON.stringify(value,null,2)+"\n";
  if(createOnly){await writeFile(file,text,{encoding:"utf8",flag:"wx"});return;}
  const temporary=`${file}.tmp-${process.pid}`;
  await writeFile(temporary,text,{encoding:"utf8",flag:"wx"});
  await rename(temporary,file);
}
type Frozen={
  runId:string; frozenAt:string; input:ValidationInput; labels:ReferenceLabel[]; evidence:typeof EVIDENCE;
  improvements:typeof IMPROVEMENT_CASES; selectedModelCaseIds:string[]; budgetUsd:number;
  rulesVersion:string; codeHashes:Record<string,string>; plans:Plan[]; policy:string;
};
type Plan={key:string;sampleId:string;model:typeof VALIDATION_MODELS[number];group:"holdout"|"regression";inputHash:string;reservationUsd:number};
type Ledger={runId:string;protocolHash:string;budgetUsd:number;attempts:ValidationAttempt[]};
const codeFiles=["lib/evaluator.ts","lib/model.ts","lib/validation.ts","scripts/validate-quality.ts"];
async function codeHashes() {return Object.fromEntries(await Promise.all(codeFiles.map(async f=>[f,hash(await readFile(path.join(root,f),"utf8"))])));}
function modelInput(frozen:Pick<Frozen,"input"|"evidence"|"improvements">,id:string,model:typeof VALIDATION_MODELS[number]) {
  const sample=id.startsWith("H") ? validationSample(frozen.input.cases.find(c=>c.id===id)!) : frozen.improvements.find(c=>c.sampleAfter.id===id)!.sampleAfter;
  return {sample,evidence:frozen.evidence,profile:frozen.input.profiles.find(p=>p.id===sample.profileId),evaluationAsOf:frozen.input.evaluationAsOf,model,promptVersion:"quality-v2" as const};
}
function makePlan(frozen:Pick<Frozen,"input"|"evidence"|"improvements">,sampleId:string,model:typeof VALIDATION_MODELS[number],group:Plan["group"]):Plan {
  const payload=buildModelRequest(modelInput(frozen,sampleId,model));
  // Byte count + serialization margin is deliberately conservative, not measured token usage.
  const inputCeiling=Buffer.byteLength(JSON.stringify(payload),"utf8")+4096;
  const reservationUsd=estimateModelCostUsd(inputCeiling,3000,model)!;
  return {key:`${sampleId}:${model}`,sampleId,model,group,inputHash:hash(payload),reservationUsd};
}
async function publishReport(frozen:Frozen,ledger:Ledger) {
  let decision:{status:string;confirmedAt?:string;source?:string;reviewPacketHash:string}|null=null;
  try{decision=await readJson(privateFile("phase2-label-confirmation.json"));}catch{}
  if(decision?.reviewPacketHash!==hash({input:frozen.input,labels:frozen.labels}))decision=null;
  const samples=frozen.input.cases.map(validationSample);
  const cases=samples.map(sample=>{
    const ruleEvaluation=evaluate(sample,samples,frozen.evidence,`${frozen.input.evaluationAsOf}T00:00:00Z`);
    return {sample,label:frozen.labels.find(l=>l.id===sample.id)!,ruleEvaluation,ruleFlag:actionableRuleFindings(ruleEvaluation).length>0,modelSelected:MODEL_CASE_IDS.includes(sample.id)};
  });
  const commonPairIds=MODEL_CASE_IDS.filter(id=>VALIDATION_MODELS.every(model=>ledger.attempts.some(a=>a.key===`${id}:${model}`&&a.state==="success")));
  const modelMetrics=VALIDATION_MODELS.map(model=>{
    const cohort=ledger.attempts.filter(a=>a.group==="holdout"&&a.model===model);
    const rows=cases.filter(c=>c.modelSelected).map(c=>{
      const a=cohort.find(a=>a.sampleId===c.sample.id);
      return {id:c.sample.id,expected:c.label.needsReview,predicted:a?.state==="success"?!!a.findings?.length:null};
    });
    return {model,metrics:classificationCounts(rows),commonMetrics:classificationCounts(rows.filter(r=>commonPairIds.includes(r.id))),
      attempted:cohort.length,succeeded:cohort.filter(a=>a.state==="success").length,failed:cohort.filter(a=>a.state==="failed").length,
      notAttempted:MODEL_CASE_IDS.length-cohort.length,inProgress:cohort.filter(a=>a.state==="started").length};
  });
  const known=ledger.attempts.filter(a=>a.estimatedCostUsd!==null).reduce((sum,a)=>sum+a.estimatedCostUsd!,0);
  const report:ValidationReport={schemaVersion:1,runId:frozen.runId,generatedAt:new Date().toISOString(),protocolHash:ledger.protocolHash,
    frozenAt:frozen.frozenAt,labelStatus:decision?.status==="confirmed"?"用户已核对并认可预期判定（非专家审计）":"AI预标注（非独立人工真值）",
    labelConfirmation:decision?.status==="confirmed"?{confirmedAt:decision.confirmedAt!,source:decision.source!}:null,
    models:VALIDATION_MODELS,selectedModelCaseIds:MODEL_CASE_IDS,budgetUsd:VALIDATION_BUDGET_USD,
    knownEstimatedCostUsd:Number(known.toFixed(9)),unknownCostCount:ledger.attempts.filter(a=>a.estimatedCostUsd===null).length,
    reservedSpendUsd:Number(validationReservedSpend(ledger.attempts).toFixed(9)),attempts:ledger.attempts,
    ruleMetrics:classificationCounts(cases.map(c=>({id:c.sample.id,expected:c.label.needsReview,predicted:c.ruleFlag}))),modelMetrics,
    commonPairs:commonPairIds.length,commonPairIds,
    cases,rulesVersion:frozen.rulesVersion,
    improvements:frozen.improvements.map(c=>({id:c.id,title:c.title,sampleBefore:c.sampleBefore,sampleAfter:c.sampleAfter,hypothesis:c.hypothesis,
      evidenceSteps:c.evidenceSteps,changes:c.changes,remainingLimit:c.remainingLimit,
      before:evaluate(c.sampleBefore,c.peersBefore,frozen.evidence,`${frozen.input.evaluationAsOf}T00:00:00Z`),
      after:evaluate(c.sampleAfter,c.peersAfter,frozen.evidence,`${frozen.input.evaluationAsOf}T00:00:00Z`)})),
    limits:["12条新构造样本不曾参与现有检测器调试，但仍限于同一家公司和同一份历史年报，不代表真实用户分布。",
      "参考标签与模型输入分开保存；调用仅发送问题、回答、画像和证据，不发送参考标签或其他模型结果。",
      "规则告警与模型疑点是否匹配参考标签，只用于小样本案例验收；非整体准确率或金融判断能力认证。",
      "TP/FP/FN/TN仅衡量是否触发具体告警与参考标签的一致性，不代表每条疑点的维度或理由均正确；须逐条核对。双模型主比较限双方共同成功的同一批样本。",
      "规则的数字覆盖提示不计作回答缺陷；无告警或零模型疑点不等于整篇回答正确。失败或未调用单列，不计作通过。",
      "两个模型固定 quality-v2、low 推理、3000输出上限、相同证据与时点，各题各一次，不重试或替换失败。",
      "两条改善案例是AI依据证据修订回答，不是实际Prompt生成实验；模型仅复核修订稿，前后变化以同版规则回归说明。",
      "网页读取冻结的真实调用结果；新输入的在线付费模型与实时行情仍未开放。"],
  };
  await atomicJson(reportPath,report);
  console.log(JSON.stringify({report:reportPath,attempted:ledger.attempts.length,knownEstimatedCostUsd:report.knownEstimatedCostUsd,unknownCostCount:report.unknownCostCount,commonPairs:report.commonPairs}));
}

try {
  const mode=process.argv[2]??"--plan";
  if(mode==="--freeze") {
    const input:ValidationInput=await readJson(privateFile("phase2-cases-input.json"));
    const labels:ReferenceLabel[]=(await readJson(privateFile("phase2-cases-labels.json"))).cases;
    if(input.cases.length!==12||labels.length!==12||input.cases.some(c=>!labels.some(l=>l.id===c.id)))throw new Error("dataset");
    const base={input,labels,evidence:EVIDENCE.filter(e=>e.id==="S1"),improvements:IMPROVEMENT_CASES};
    const plans:Plan[]=[];
    for(const id of MODEL_CASE_IDS)for(const model of VALIDATION_MODELS)plans.push(makePlan(base,id,model,"holdout"));
    for(const c of IMPROVEMENT_CASES)for(const model of VALIDATION_MODELS)plans.push(makePlan(base,c.sampleAfter.id,model,"regression"));
    if(plans.length!==16)throw new Error("plan");
    const frozen:Frozen={...base,runId:VALIDATION_RUN_ID,frozenAt:new Date().toISOString(),selectedModelCaseIds:MODEL_CASE_IDS,
      budgetUsd:VALIDATION_BUDGET_USD,rulesVersion:EVALUATOR_VERSION,codeHashes:await codeHashes(),plans,
      policy:"回答是否出现需修改或补证的具体问题；通用解析/覆盖不足提示单列，不计缺陷。模型非空findings为告警。费用未知保留至少$0.10，另留$0.10下一次请求缓冲。"};
    await atomicJson(frozenPath,frozen,true);
    console.log(JSON.stringify({frozen:frozenPath,protocolHash:hash(frozen),cases:12,requests:plans.length,maximumSingleReservationUsd:Math.max(...plans.map(p=>p.reservationUsd)),networkRequests:0}));
  } else {
    const frozen:Frozen=await readJson(frozenPath);
    const protocolHash=hash(frozen);
    if(JSON.stringify(frozen.codeHashes)!==JSON.stringify(await codeHashes()))throw new Error("code-changed-after-freeze");
    let ledger:Ledger;
    try{ledger=await readJson(ledgerPath);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;ledger={runId:VALIDATION_RUN_ID,protocolHash,budgetUsd:VALIDATION_BUDGET_USD,attempts:[]};}
    if(ledger.runId!==VALIDATION_RUN_ID||ledger.protocolHash!==protocolHash||ledger.budgetUsd!==VALIDATION_BUDGET_USD)throw new Error("ledger-mismatch");
    if(mode==="--plan")console.log(JSON.stringify({runId:frozen.runId,budgetUsd:frozen.budgetUsd,attempted:ledger.attempts.length,plans:frozen.plans,networkRequests:0},null,2));
    else if(mode==="--report")await publishReport(frozen,ledger);
    else if(mode==="--run"||mode==="--continue-after-diagnosis") {
      if(!process.argv.includes("--approved-budget=0.50"))throw new Error("approval-required");
      const decision=await readJson(privateFile("phase2-label-confirmation.json"));
      if(!["confirmed","ai_reference"].includes(decision.status)||decision.reviewPacketHash!==hash({input:frozen.input,labels:frozen.labels}))throw new Error("label-decision-pending");
      const apiKey=process.env.OPENAI_API_KEY;
      if(!apiKey?.startsWith("sk-")||/[\r\n]/.test(apiKey))throw new Error("credential");
      if(ledger.attempts.some(a=>a.state==="started"))throw new Error("interrupted-request");
      if(mode==="--run"&&ledger.attempts.some(a=>a.state==="failed"))throw new Error("failure-needs-diagnosis");
      for(const plan of frozen.plans.filter(p=>!ledger.attempts.some(a=>a.key===p.key))) {
        const input=modelInput(frozen,plan.sampleId,plan.model);
        if(hash(buildModelRequest(input))!==plan.inputHash)throw new Error("payload-changed");
        if(!validationCanRequest(ledger.attempts,plan.reservationUsd)){console.log("Stopped at the budget gate; no next request sent.");break;}
        const attempt:ValidationAttempt={...plan,startedAt:new Date().toISOString(),completedAt:null,state:"started",estimatedCostUsd:null};
        ledger.attempts.push(attempt);await atomicJson(ledgerPath,ledger);
        try {
          const result=await inspectWithModel({...input,apiKey});
          const {findings,usage,...metadata}=result;
          Object.assign(attempt,{state:"success",findings,usage,metadata,estimatedCostUsd:usage.estimatedCostUsd});
        }catch(error){
          const safe=error instanceof ModelInspectionError?error:new ModelInspectionError("network_error");
          Object.assign(attempt,{state:"failed",usage:safe.usage,metadata:safe.metadata,estimatedCostUsd:safe.usage.estimatedCostUsd,
            error:{code:safe.code,...(safe.status?{status:safe.status}:{}),...("diagnosis" in safe&&safe.diagnosis?{diagnosis:safe.diagnosis}:{})}});
        }
        attempt.completedAt=new Date().toISOString();
        await atomicJson(ledgerPath,ledger);await publishReport(frozen,ledger);
        console.log(JSON.stringify({key:attempt.key,state:attempt.state,findings:attempt.findings?.length??null,usage:attempt.usage,error:attempt.error}));
        if(attempt.state!=="success"){process.exitCode=1;break;}
      }
    } else throw new Error("mode");
  }
}catch(error){
  // Only our static error tags are exposed; never print provider errors, headers or environment.
  const message=error instanceof Error?error.message:"";
  const known=["dataset","plan","code-changed-after-freeze","ledger-mismatch","approval-required","label-decision-pending","credential","interrupted-request","failure-needs-diagnosis","payload-changed","mode"];
  console.error(`Validation stopped safely (${known.includes(message)?message:"file-or-configuration"}); no automatic retry.`);
  process.exitCode=1;
}
