import { z } from "zod";
import type { Feedback, Review, Sample } from "./domain";
import { PROFILES } from "./seed";
import { WORKSPACE_EVIDENCE as EVIDENCE, HOT_EVIDENCE } from "./hot-context";
import { evaluate, citesEvidence } from "./evaluator";
import { containsSensitivePattern } from "./privacy";
import { append, event, getWorkspace, resultResponse, sandboxFor } from "./store";

const text=z.string().trim().min(1).max(4000);
const schemas={
  evaluate:z.object({sampleIds:z.array(z.string().max(100)).min(1).max(80)}).strict(),
  samples:z.object({question:text.max(500),answer:text,intent:z.enum(["fact","explanation"]),profileId:z.enum(["novice","experienced"]),promptVersion:z.string().trim().min(1).max(40).optional(),modelVersion:z.string().trim().min(1).max(100).optional(),dataVersion:z.string().trim().min(1).max(100).optional(),askedAt:z.string().datetime({offset:true}).optional()}).strict(),
  revisions:z.object({sampleId:z.string().max(100),answer:text,promptVersion:z.string().trim().min(1).max(40)}).strict(),
  reviews:z.object({evaluationId:z.string().max(100),decision:z.enum(["confirmed","false_positive","needs_data"]),comment:text.max(600)}).strict(),
  feedback:z.object({sampleId:z.string().max(100),kind:z.enum(["useful","not_useful","dispute"]),comment:z.string().trim().max(600).default("")}).strict(),
};
export type Action=keyof typeof schemas;
export async function handle(request: Request,action?:Action) {
  const sandbox=sandboxFor(request);
  try {
    if (action) {
      const origin=request.headers.get("origin");
      if (origin && origin!==new URL(request.url).origin) return resultResponse({error:"不接受跨站写入。"},sandbox.cookie,403);
      if (!request.headers.get("content-type")?.includes("application/json")) return resultResponse({error:"请使用 JSON 请求。"},sandbox.cookie,415);
    }
    const workspace=await getWorkspace(sandbox.id);
    if (!action) return resultResponse(workspace,sandbox.cookie);
    const raw=await request.text();
    if(raw.length>16000) return resultResponse({error:"输入过长，请缩短样本。"},sandbox.cookie,413);
    let payload:unknown;
    try {payload=JSON.parse(raw);} catch {return resultResponse({error:"JSON 格式错误。"},sandbox.cookie,400);}
    const validated=schemas[action].safeParse(payload);
    if(!validated.success) return resultResponse({error:"字段缺失、类型错误或超出长度限制。"},sandbox.cookie,400);
    if(Object.values(validated.data).some(value=>typeof value==="string"&&containsSensitivePattern(value))) return resultResponse({error:"发现疑似手机号、证件或密钥，请先匿名化再提交。内容未保存。"},sandbox.cookie,400);
    const now=new Date().toISOString();
    if(workspace.events.length>=150) return resultResponse({error:"本演示空间已达到 150 次操作上限。"},sandbox.cookie,429);
    if(["samples","revisions","evaluate"].includes(action)&&workspace.evaluations.length>=650) return resultResponse({error:"评测历史已达到 650 条演示上限。"},sandbox.cookie,429);
    if(action==="samples" || action==="revisions") {
      if (action==="revisions") {
        const data=schemas.revisions.parse(payload);
        const original=workspace.samples.find(s=>s.id===data.sampleId);
        if(!original) return resultResponse({error:"原样本不存在。"},sandbox.cookie,404);
        if(workspace.samples.length>=80) return resultResponse({error:"本演示空间最多保存 80 条样本。"},sandbox.cookie,429);
        if(workspace.samples.some(s=>s.questionId===original.questionId&&s.profileId===original.profileId&&s.promptVersion===data.promptVersion&&s.modelVersion===original.modelVersion&&s.dataVersion===original.dataVersion)) return resultResponse({error:"这个问题和画像已存在该版本，请使用新的版本名。"},sandbox.cookie,409);
        const sample:Sample={...original,id:crypto.randomUUID(),answer:data.answer,promptVersion:data.promptVersion,provenance:"imported",createdAt:now};
        await append(sandbox.id,[{kind:"sample",value:sample},{kind:"evaluation",value:evaluate(sample,[...workspace.samples,sample],EVIDENCE,now)},{kind:"event",value:event("修订并回归",`${original.promptVersion} → ${data.promptVersion}；人工修订，旧版本与评测保留。`,now)}]);
        return resultResponse(await getWorkspace(sandbox.id),sandbox.cookie);
      }
      const data=schemas.samples.parse(payload);
      if(workspace.samples.length>=80) return resultResponse({error:"本演示空间最多保存 80 条样本。"},sandbox.cookie,429);
      const knownCompany=/茅台|600519/.test(data.question);
      const normalized=data.question.replace(/\s+/g,"").toLowerCase();
      const questionId=workspace.samples.find(s=>s.question.replace(/\s+/g,"").toLowerCase()===normalized)?.questionId??crypto.randomUUID();
      const sample:Sample={...data,id:crypto.randomUUID(),questionId,promptVersion:data.promptVersion??"用户导入",modelVersion:data.modelVersion??"未提供",dataVersion:data.dataVersion??(knownCompany?"moutai-2024-verified-v1":"无匹配数据"),evidenceIds:knownCompany?["S1",...HOT_EVIDENCE.filter(e=>citesEvidence(data.answer,e)).map(e=>e.id)]:[],provenance:"imported",createdAt:now};
      if(workspace.samples.some(s=>s.questionId===sample.questionId&&s.profileId===sample.profileId&&s.promptVersion===sample.promptVersion&&s.modelVersion===sample.modelVersion&&s.dataVersion===sample.dataVersion)) return resultResponse({error:"相同问题、画像和版本组合已存在，请展开版本信息并填写新的版本标签。"},sandbox.cookie,409);
      await append(sandbox.id,[{kind:"sample",value:sample},{kind:"evaluation",value:evaluate(sample,[...workspace.samples,sample],EVIDENCE,now)},{kind:"event",value:event("导入并自动评测",`${PROFILES.find(p=>p.id===data.profileId)?.name} · ${data.question.slice(0,60)}`,now)}]);
    } else if(action==="evaluate") {
      const {sampleIds}=schemas.evaluate.parse(payload);
      const unique=[...new Set(sampleIds)];
      const samples=workspace.samples.filter(s=>unique.includes(s.id));
      if(samples.length!==unique.length) return resultResponse({error:"样本不存在或不属于当前演示空间。"},sandbox.cookie,404);
      if(workspace.evaluations.length+samples.length>650) return resultResponse({error:"评测历史已达到演示上限。"},sandbox.cookie,429);
      await append(sandbox.id,[...samples.map(sample=>({kind:"evaluation" as const,value:evaluate(sample,workspace.samples,EVIDENCE,now)})),{kind:"event",value:event("执行规则回归",`${samples.length} 条回答；原结果保留，人工结论不自动转移到新评测。`,now)}]);
    } else if(action==="reviews") {
      const data=schemas.reviews.parse(payload);
      const evaluation=workspace.evaluations.find(e=>e.id===data.evaluationId);
      if(!evaluation) return resultResponse({error:"评测不存在或不属于当前演示空间。"},sandbox.cookie,404);
      const review:Review={...data,id:crypto.randomUUID(),sampleId:evaluation.sampleId,createdAt:now};
      const decisionLabel={confirmed:"确认问题",false_positive:"判定误报",needs_data:"需要补证"}[data.decision];
      await append(sandbox.id,[{kind:"review",value:review},{kind:"event",value:event("提交人工复核",`${decisionLabel}；保留原始机器判定，结论绑定当前评测。`,now)}]);
    } else {
      const data=schemas.feedback.parse(payload);
      if(!workspace.samples.some(s=>s.id===data.sampleId)) return resultResponse({error:"样本不存在或不属于当前演示空间。"},sandbox.cookie,404);
      const feedback:Feedback={...data,id:crypto.randomUUID(),createdAt:now,origin:"visitor"};
      const feedbackLabel={useful:"有帮助",not_useful:"无帮助",dispute:"事实异议"}[data.kind];
      await append(sandbox.id,[{kind:"feedback",value:feedback},{kind:"event",value:event("收到访客反馈",`${feedbackLabel}；反馈进入复核参考，不直接改变事实判定。`,now)}]);
    }
    return resultResponse(await getWorkspace(sandbox.id),sandbox.cookie);
  } catch {
    // Never forward upstream or database error text, which may contain user content or credentials.
    return resultResponse({error:"服务暂不可用，操作未确认完成。请刷新检查记录；错误不会被标记为通过。"},sandbox.cookie,503);
  }
}
