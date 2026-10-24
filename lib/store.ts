import { env } from "cloudflare:workers";
import type { AuditEvent, Evaluation, Feedback, Review, Sample, Workspace } from "./domain";
import { EVIDENCE, PROFILES, seedSamples } from "./seed";
import { evaluate } from "./evaluator";

type RecordKind = "sample" | "evaluation" | "review" | "feedback" | "event";
type RecordValue = Sample | Evaluation | Review | Feedback | AuditEvent;
const cookieName = "qa_sandbox";

export function sandboxFor(request: Request) {
  const cookie = request.headers.get("cookie")?.split(";").map(p=>p.trim()).find(p=>p.startsWith(cookieName+"="))?.slice(cookieName.length+1);
  const id = cookie && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(cookie) ? cookie : crypto.randomUUID();
  return {id, cookie:`${cookieName}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${new URL(request.url).protocol==="https:"?"; Secure":""}`};
}
function database() { if (!env.DB) throw new Error("数据库尚未配置"); return env.DB; }

export async function append(sandbox: string, items: {kind: RecordKind; value: RecordValue}[]) {
  if (!items.length) return;
  const db=database();
  await db.batch(items.map(({kind,value})=>db.prepare("INSERT OR IGNORE INTO qa_records (sandbox,id,kind,payload,created_at) VALUES (?,?,?,?,?)").bind(sandbox,value.id,kind,JSON.stringify(value),value.createdAt)));
}
export function event(action: string, detail: string, now=new Date().toISOString()): AuditEvent { return {id:crypto.randomUUID(),action,detail,createdAt:now}; }

export async function getWorkspace(sandbox: string): Promise<Workspace> {
  const db=database();
  let {results} = await db.prepare("SELECT kind,payload FROM qa_records WHERE sandbox=? ORDER BY created_at ASC,id ASC LIMIT 1200").bind(sandbox).all<{kind:RecordKind;payload:string}>();
  if (!results.length) {
    const now=new Date().toISOString();
    const samples=seedSamples(now);
    const evaluations=samples.map(s=>({...evaluate(s,samples,EVIDENCE,now),id:`initial-${s.id}`}));
    await append(sandbox,[...samples.map(value=>({kind:"sample" as const,value})),...evaluations.map(value=>({kind:"evaluation" as const,value})),{kind:"event",value:{id:"initial",action:"创建独立演示空间",detail:"载入 32 条构造样例并执行规则核验；没有模型调用或人工确认。",createdAt:now}}]);
    results=(await db.prepare("SELECT kind,payload FROM qa_records WHERE sandbox=? ORDER BY created_at ASC,id ASC LIMIT 1200").bind(sandbox).all<{kind:RecordKind;payload:string}>()).results;
  }
  const values = <T>(kind:RecordKind)=>results.filter(r=>r.kind===kind).map(r=>JSON.parse(r.payload) as T);
  return {samples:values<Sample>("sample"),evaluations:values<Evaluation>("evaluation"),reviews:values<Review>("review"),feedback:values<Feedback>("feedback"),events:values<AuditEvent>("event").reverse(),evidence:EVIDENCE,profiles:PROFILES,
    connection:{data:"iFinD 已验证 · 固定快照",model:"规则核验运行中 · 模型未启用",modelEnabled:false,snapshotAt:"2026-10-25T04:34:17+08:00",notice:"使用已保存的真实 iFinD 响应与官方年报核验快照；网页操作不会调用实时行情或付费模型。每个浏览器使用独立演示空间，记录保存在服务端。请勿输入真实个人信息。"}};
}

export function resultResponse(data: unknown,cookie: string,status=200) { return Response.json(data,{status,headers:{"Set-Cookie":cookie,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}}); }
