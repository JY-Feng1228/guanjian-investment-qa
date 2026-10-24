import type { Evidence, Evaluation, Fact, Finding, Sample } from "./domain.ts";
import { containsSensitivePattern } from "./privacy.ts";

export const EVALUATOR_VERSION = "rules-1.3.0";
type Claim = { metric: string; period: string; value: number; tolerance: number; raw: string; unit: string; fact?: Fact; evidenceId?: string };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const money = /\d[\d,]*(?:\.\d+)?\s*(?:万亿元|亿元|万元|元|%|％)/g;
const clauses = (text:string) => text.split(/[。；;，,\n]|但是|然而|不过|而是|(?<!不)但/).map(part=>part.trim()).filter(Boolean);
export const citesEvidence = (text: string, source: Evidence) => new RegExp(`(?<![A-Za-z0-9_-])${escape(source.id)}(?![A-Za-z0-9_-])`).test(text) || text.includes(source.title);
// Date-only sources establish a publication day, not an invented hour. Use China time.
const publicationTime = (value: string) => {
  const day = value.slice(0,10);
  const parsedDay = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || !Number.isFinite(parsedDay) || new Date(parsedDay).toISOString().slice(0,10) !== day) return NaN;
  return value.length === 10 ? Date.parse(`${value}T00:00:00+08:00`) : Date.parse(value);
};
const freshnessWindow = 7 * 864e5;

function periodFor(text:string,year:string) {
  if(/前三季度|前九个月/.test(text)) return `${year}-YTD-Q3`;
  if(/上半年|前六个月/.test(text)) return `${year}-H1`;
  if(/下半年/.test(text)) return `${year}-H2`;
  const quarter=text.match(/第?([一二三四1-4])季度|\bQ([1-4])\b/i);
  const value=quarter?.[1]??quarter?.[2];
  return value?`${year}-Q${({一:1,二:2,三:3,四:4} as Record<string,number>)[value]??value}`:year;
}
function conflictingEntities(sample:Sample,evidence:Evidence[]) {
  if(!/茅台|600519/.test(sample.question)&&!evidence.some(e=>sample.evidenceIds.includes(e.id)&&e.title.includes("贵州茅台"))) return [];
  const metrics=[...new Set(["营业收入","营业总收入","归母净利润",...evidence.filter(e=>sample.evidenceIds.includes(e.id)).flatMap(e=>e.facts.flatMap(f=>[f.metric,...f.aliases]))])].sort((a,b)=>b.length-a.length);
  const generic=new Set(["这是","这里","其中","截至","我们","我","你","公司","该公司","本公司","该企业","本企业","企业","年报","报告","本报告","摘要","报表","材料","资料","数据","数字","表中","文中","上述","营业收入","营业总收入","归母净利润","营收","利润","预计","达到","数据来自","数据来源","先看"]);
  // Only a direct metric amount can establish this limited subject check; explanatory mentions cannot.
  const pattern=new RegExp(`(?:^|[。；，、\\s])([\\u4e00-\\u9fff]{2,20}?)\\s*(?:20\\d{2}\\s*年\\s*)?(?:${metrics.map(escape).join("|")})\\s*(?:为|是|达到|约为|约|：|:|录得|合计)?\\s*[\\d,]+(?:\\.\\d+)?\\s*(?:万亿元|亿元|万元|元|%|％)`,"g");
  return [...sample.answer.matchAll(pattern)].map(m=>m[1].replace(/^(根据|按照|关于|来自|引用|以及|和|与|及)/,"").replace(/(?:列出|列示|披露|显示|说明|预计|记载|载明|记录)(?:的)?$/ ,"").replace(/的$/,""))
    .filter(name=>name.length>=2&&!generic.has(name)&&!name.includes("茅台")&&!metrics.some(metric=>metric.startsWith(name)||name.includes(metric))&&!/报告|年报|指标|同比|季度|年度|口径/.test(name)&&!/(?:来自|包括|除了|对应|参考|引用|采用|截至|说明|是|与|于|把|为|对|按|从|在|到|据|看)$/.test(name));
}

export function extractClaims(sample: Sample, evidence: Evidence[]): Claim[] {
  const facts = evidence.filter(e => sample.evidenceIds.includes(e.id) && e.kind === "official" && e.status === "verified").flatMap(e => e.facts.map(f => ({ ...f, evidenceId: e.id })));
  const aliases = [...new Set(facts.flatMap(f => [f.metric, ...f.aliases]))].sort((a,b) => b.length-a.length);
  if (!aliases.length) return [];
  const pattern = new RegExp(`(${aliases.map(escape).join("|")})\\s*(?:为|是|达到|约为|约|：|:|录得|合计)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(万亿元|亿元|万元|元|%|％)`, "g");
  const claims: Claim[] = [];
  for (const match of sample.answer.matchAll(pattern)) {
    const start = match.index ?? 0;
    const prefix = sample.answer.slice(0, start).split(/[。；;\n]/).at(-1) ?? "";
    const years = [...prefix.matchAll(/(20\d{2})\s*年/g)];
    const questionYears = [...sample.question.matchAll(/(20\d{2})\s*年/g)];
    const year = years.at(-1)?.[1] ?? questionYears[0]?.[1] ?? "unknown";
    const period = periodFor((years.length?prefix.slice(years.at(-1)!.index):sample.question)+match[1],year);
    const candidates = facts.filter(f => f.metric === match[1] || f.aliases.includes(match[1]));
    const fact = candidates.find(f => f.period === period);
    const factor = ({"万亿元":1e12,"亿元":1e8,"万元":1e4,"元":1,"%":1,"％":1} as Record<string,number>)[match[3]];
    const tolerance=0.51*factor/10**(match[2].split(".")[1]?.length??0);
    claims.push({ metric: candidates[0]?.metric ?? match[1], period, value: Number(match[2].replaceAll(",", ""))*factor, tolerance, raw: match[0], unit: match[3], fact, evidenceId: fact?.evidenceId });
  }
  return claims;
}

export function evaluate(sample: Sample, peers: Sample[], evidence: Evidence[], now = new Date().toISOString()): Evaluation {
  const findings: Finding[] = [];
  const add = (f: Omit<Finding,"id">) => findings.push({ ...f, id: `f${findings.length+1}` });
  const otherEntities=conflictingEntities(sample,evidence);
  const selected = evidence.filter(e => sample.evidenceIds.includes(e.id));
  const hotspots = selected.filter(e => e.kind === "hotspot" && citesEvidence(sample.answer, e));
  // A cited news snapshot cannot opt out of the registered official financial facts.
  const factSample = hotspots.length ? { ...sample, evidenceIds: [...new Set([...sample.evidenceIds, ...evidence.filter(e => e.kind === "official").map(e => e.id)])] } : sample;
  const claims = extractClaims(factSample, otherEntities.length?[]:evidence);
  const numericTokens = sample.answer.match(money) ?? [];
  if(otherEntities.length) add({dimension:"relevance",status:"review",severity:"high",title:"回答可能使用了其他公司主体",quote:[...new Set(otherEntities)].join("、"),detail:"当前证据属于贵州茅台，不能套用于另一家公司。已暂停该回答的数字支持判定，请先核对主体。",method:"rule"});
  for (const c of claims) {
    if (!c.fact) {
      add({dimension:"period",status:"unverifiable",severity:"medium",title:"该期间缺少对应证据",quote:c.raw,detail:`识别期间 ${c.period}；现有证据没有可匹配的同口径数值。`,method:"evidence"});
      continue;
    }
    // Tolerance follows the precision displayed by the answer, rather than a loose percent band.
    const unitMatch = (c.fact.unit === "%") === /%|％/.test(c.unit);
    const matches = unitMatch && Math.abs(c.value - c.fact.value) <= c.tolerance;
    add({dimension:"number",status:matches?"supported":"contradicted",severity:matches?"info":"high",title:matches?`${c.metric}与原文一致`:`${c.metric}与原文冲突`,quote:c.raw,
      detail:`${c.period}年，按回答显示精度核对。原文第 ${c.fact.page} 页；营业收入与营业总收入分开核验。`,evidenceId:c.evidenceId,factId:c.fact.id,
      expected:`${c.fact.value.toLocaleString("zh-CN",{maximumFractionDigits:2})} ${c.fact.unit}`,observed:`${c.value.toLocaleString("zh-CN",{maximumFractionDigits:2})} ${/%|％/.test(c.unit)?"%":"元"}`,method:"evidence"});
    if (!matches && hotspots.length) add({dimension:"number",status:"contradicted",severity:"high",title:"热点不能改写已登记财务事实",quote:c.raw,detail:"热点与画像只能改变背景和解释方式，不能覆盖已登记的同期间、同口径财报数值。",evidenceId:c.evidenceId,factId:c.fact.id,method:"evidence"});
  }
  if (numericTokens.length > claims.length) add({dimension:"number",status:"unverifiable",severity:"medium",title:"还有数字未完成核验",quote:numericTokens.filter(t => !claims.some(c => c.raw.includes(t))).join("；").slice(0,300),detail:"现有解析器只核对已收录指标的直接陈述。同比、多个年份的省略句及其他指标需要补充证据或人工核验。",method:"rule"});
  if (!claims.length) add({dimension:"source",status:"unverifiable",severity:"medium",title:"没有可直接核验的财务断言",quote:"",detail:"未检出与现有证据匹配的直接数字陈述；不等同于回答错误或已通过。",method:"evidence"});
  const qYears = [...sample.question.matchAll(/(20\d{2})\s*年/g)].map(m=>m[1]);
  if (qYears.length===1 && claims.length && claims.every(c=>c.period!==periodFor(sample.question,qYears[0]))) add({dimension:"period",status:"contradicted",severity:"high",title:"回答期间偏离问题",quote:sample.question,detail:`问题期间为 ${periodFor(sample.question,qYears[0])}，已识别断言均为其他期间；年度与季度不可混用。`,method:"rule"});
  const requestedMetrics = selected.filter(e=>e.kind==="official").flatMap(e=>e.facts).filter(f=>[f.metric,...f.aliases].some(a=>sample.question.includes(a))).map(f=>f.metric);
  if(sample.intent==="fact" && requestedMetrics.length && claims.length && !claims.some(c=>requestedMetrics.includes(c.metric))) add({dimension:"relevance",status:"review",severity:"medium",title:"回答指标可能偏离问题",quote:sample.question,detail:"已核对数字属于另一指标。口径正确不代表回答了用户所问，需要检查是否混用营业收入与营业总收入。",method:"rule"});
  const parts=clauses(sample.answer);
  const asksMetricMeaning=sample.intent==="explanation"&&/(营业收入|营收)/.test(sample.question)&&/(归母净利润|净利润)/.test(sample.question)&&/(含义|区别|差别|区分|理解|解释)/.test(sample.question);
  const explainsRevenue=parts.some(part=>/(?:营业收入|营收|收入|前者).{0,16}(?:销售|经营|业务|商品|服务|规模|所得)/.test(part));
  const explainsProfit=parts.some(part=>/(?:归母(?:净利润|净利|利润)?|净利润|净利|后者).{0,20}(?:扣除|减去|扣掉|成本|费用|税费|剩余|盈利|归属|净赚)/.test(part));
  if(asksMetricMeaning&&(!explainsRevenue||!explainsProfit)) add({dimension:"relevance",status:"review",severity:"medium",title:"未解释所问指标的含义差别",quote:sample.question,detail:"问题要求解释收入与净利润的含义差别，当前回答缺少至少一项概念说明；仅列产品收入或两项金额不能替代解释。该规则检查概念覆盖，不裁定解释完整性。",method:"rule"});
  const currentClaims=parts.filter(part=>(/(今天|今日|实时|当前热点|最新行情|近期热点)/.test(part)||(hotspots.length && /最新/.test(part)))&&!/无法(?:确认|获取|核验|判断)|没有(?:实时|当日|最新)(?:行情|数据|证据|来源|材料|信息)|不能(?:据此)?(?:确认|获取|核验|判断|单独用于判断).{0,20}(?:今天|今日|当前|实时|最新)|(?:不能|不应|不可).{0,24}(?:延用|沿用|套用|外推).{0,8}(?:今天|今日|当前|实时|最新)|(?:并非|不是|不代表).{0,12}(?:今天|今日|实时|当前|最新)|缺少(?:证据|实时|数据)|尚未获取|^(?:如需|若需|如果需要)|(?:请|需要).{0,8}(?:查询|查阅|获取|补充)/.test(part));
  const questionAt = Date.parse(sample.askedAt ?? sample.createdAt);
  for (const hot of hotspots) {
    const published = publicationTime(hot.publishedAt);
    if (!Number.isFinite(published) || !Number.isFinite(questionAt)) {
      add({dimension:"freshness",status:"unverifiable",severity:"high",title:"热点缺少有效发布时间或提问时间",quote:hot.id,detail:"没有有效发布时间的条目不能作为热点证据；查询时间不能替代发布时间。",evidenceId:hot.id,method:"evidence"});
      continue;
    }
    if (published > questionAt) add({dimension:"freshness",status:"contradicted",severity:"high",title:"热点发布时间晚于提问时间",quote:hot.id,detail:`发布时间 ${hot.publishedAt}；提问时间 ${sample.askedAt ?? sample.createdAt}。回答不可能事先引用该消息。`,evidenceId:hot.id,method:"evidence"});
    const usedAsCurrent = currentClaims.some(part => {
      const sentence = sample.answer.split(/[。；;\n]/).find(sentence => sentence.includes(part)) ?? part;
      const citedHere = hotspots.filter(source => citesEvidence(sentence, source));
      return citedHere.length ? citedHere.includes(hot) : true;
    });
    if (usedAsCurrent && questionAt - published > freshnessWindow) add({dimension:"freshness",status:"unverifiable",severity:"high",title:"过期热点不能作为今天或最新消息",quote:hot.id,detail:`发布时间 ${hot.publishedAt}；提问时间 ${sample.askedAt ?? sample.createdAt}，已超过 7 天窗口。可注明日期引用历史背景，不能充当今天或最新的依据。`,evidenceId:hot.id,method:"evidence"});
  }
  // Extend the existing seven-day gate: only cited, dated, available hot evidence can support it.
  const usableSources = selected.filter(e => e.kind !== "hotspot" || (hotspots.includes(e) && Number.isFinite(publicationTime(e.publishedAt)) && publicationTime(e.publishedAt) <= questionAt));
  if (currentClaims.length && !hotspots.length && usableSources.every(e=> !e.publishedAt || new Date(now).getTime()-new Date(e.publishedAt).getTime()>freshnessWindow)) add({dimension:"freshness",status:"unverifiable",severity:"high",title:"历史年报不能支持当前行情",quote:currentClaims.join("；"),detail:`评测时点 ${now.slice(0,10)}；证据是历史报告，没有当日行情或热点来源。披露日、报告期和取数日不可混用。`,method:"evidence"});
  const causalClaims=parts.filter(part=>/(造成|导致|归因于|驱动|带动|促成|必然|唯一(?:的)?(?:原因|因素)|主要原因|完全来自|排除.{0,18}(?:因素|原因|影响)|证明.{0,20}(?:未来|必然|原因|因素|提价|股价|收益|增长)|(?:因为|由于).{0,20}(?:提价|涨价|销量|成本|需求))/.test(part)&&!/(?:不能|无法|未能)(?:据此|单独)?(?:证明|确认|判断|推断|归因|排除)|不(?:足以|等于|意味着|代表|一定|完全)|并非|未必/.test(part));
  if (sample.intent==="explanation" && causalClaims.length) add({dimension:"reasoning",status:"review",severity:"medium",title:"因果解释需要额外证据",quote:causalClaims.join("；"),detail:"财务数值核对不能证明原因。请人工检查结论是否超出证据、是否把相关性写成因果。",method:"rule"});
  const risky = [...sample.answer.matchAll(/稳赚|保证收益|保本保收益|必涨|必然(?:上涨|盈利|赚钱)|全仓(?:买入|梭哈)|一定(?:赚钱|上涨|盈利)|无风险收益/g)].filter(m=> !/(?:不|不能|无法|不应|切勿|避免|禁止|不存在|并非).{0,7}$/.test(sample.answer.slice(Math.max(0,(m.index??0)-12),m.index)));
  if (risky.length) add({dimension:"compliance",status:"contradicted",severity:"high",title:"确定性收益或激进行动表述",quote:risky.map(m=>m[0]).join("、"),detail:"回答包含保证收益或激进交易引导，必须修订；风险偏好不能作为承诺收益的依据。此为产品规则检测，非法律合规认证。",method:"rule"});
  const profileContext=/(风险偏好|高风险|风险承受|承受能力|(?:承担|偏好).{0,6}风险|经验|专业用户|资深|画像)/.test(sample.question+sample.answer);
  const omittedRisk=profileContext?parts.filter(part=>/(?:省去|省略|删去|删除|删减|略去|隐去|忽略|不讲|不谈|不提|(?:无需|不用|不必)(?:再)?(?:说明|提示|披露)).{0,16}(?:风险|局限|不利)|(?:风险|局限).{0,16}(?:省去|省略|删去|删减|略去|隐去|忽略)|(?:只(?:需|要)?(?:看|讲|展示|关注|保留)|仅(?:看|讲|展示|关注|保留)).{0,8}(?:有利|利好|正面|收益)/.test(part)&&!/(?:不(?:能|可|应|得|要|会)?|切勿).{0,12}(?:省去|省略|删去|删除|删减|略去|隐去|忽略|不讲|不谈|不提|只|仅)/.test(part)):[];
  if(omittedRisk.length) add({dimension:"personalization",status:"review",severity:"high",title:"画像不能作为省略风险的理由",quote:omittedRisk.join("；"),detail:"回答主动按用户经验或风险偏好省略风险、数据局限或不利信息，需要复核。画像可以改变解释深度，不能降低事实和风险披露要求。",method:"rule"});
  if (containsSensitivePattern(sample.answer+sample.question)) add({dimension:"privacy",status:"review",severity:"high",title:"疑似敏感信息",quote:"[已隐藏]",detail:"检测到疑似手机号、证件或密钥格式。不要把真实个人信息放入评测样本。",method:"rule"});
  if (!/(茅台|营收|营业|利润|现金流|财务|年报|数据|证据|行情|收益|投资|指标)/.test(sample.answer)) add({dimension:"relevance",status:"review",severity:"medium",title:"可能没有回应投资问题",quote:sample.answer,detail:"未命中当前领域的基础语义词；规则只标记疑点，需人工判断。",method:"rule"});
  if (selected.some(e=>e.status==="conflict")) add({dimension:"source",status:"review",severity:"medium",title:"检索结果存在来源冲突",quote:"",detail:"所选 MCP 摘要包含已发现的口径或数值冲突。数值判定仅使用已核验原始年报，冲突摘要保留为审计证据。",evidenceId:selected.find(e=>e.status==="conflict")?.id,method:"evidence"});
  for (const peer of peers.filter(p=>p.id!==sample.id && p.questionId===sample.questionId && p.profileId!==sample.profileId && p.promptVersion===sample.promptVersion && p.modelVersion===sample.modelVersion && p.dataVersion===sample.dataVersion)) {
    const peerClaims=extractClaims(peer,evidence);
    if(claims.some(c=>peerClaims.some(p=>p.metric===c.metric && p.period===c.period && Math.abs(p.value-c.value)>c.tolerance+p.tolerance))) add({dimension:"personalization",status:"contradicted",severity:"high",title:"同一事实随画像改变",quote:peer.id,detail:"相同问题、模型、Prompt、数据版本下，另一画像出现不同财务数值（已考虑各自显示精度）。知识水平与风险偏好只能改变解释方式。",method:"paired"});
  }
  const status = findings.some(f=>f.status==="contradicted") ? "contradicted" : findings.some(f=>f.status==="review") ? "review" : findings.some(f=>f.status==="unverifiable") ? "unverifiable" : "supported";
  return {id:crypto.randomUUID(),sampleId:sample.id,createdAt:now,evaluatorVersion:EVALUATOR_VERSION,status,findings,checkedClaims:findings.filter(f=>f.dimension==="number"&&["supported","contradicted"].includes(f.status)).length,totalClaims:Math.max(numericTokens.length,claims.length),mode:"rules",modelStatus:"not_requested"};
}
