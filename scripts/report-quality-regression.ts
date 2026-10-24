import { readFile, writeFile } from "node:fs/promises";
import { EVALUATOR_VERSION, evaluate } from "../lib/evaluator.ts";
import { EVIDENCE } from "../lib/seed.ts";
import { actionableRuleFindings, classificationCounts, validationSample, type ValidationReport } from "../lib/validation.ts";

// Offline only. Preserve the frozen first-run results; these known cases are now regression data.
const baseline = JSON.parse(await readFile("public/evidence/quality-validation-20261025.json", "utf8")) as ValidationReport;
const generatedAt = new Date().toISOString();
const evaluationAt = baseline.cases[0].ruleEvaluation.createdAt;
const cases = baseline.cases.map(item => {
  const after = evaluate(item.sample, [], EVIDENCE, evaluationAt);
  return { id: item.sample.id, expectedReview: item.label.needsReview, beforeFlag: item.ruleFlag,
    afterFlag: actionableRuleFindings(after).length > 0,
    beforeFindings: actionableRuleFindings(item.ruleEvaluation), afterFindings: actionableRuleFindings(after) };
});
const challengeInputs = [
  { id: "C01", question: "贵州茅台2024年营业收入是多少？请保留两位小数。",
    answer: "贵州茅台2024年营业收入约为1709.00亿元，按全年合并口径、人民币亿元展示。该历史金额不代表未来业绩。",
    reason: "原值为1708.9915227634亿元，两位小数应为1708.99；1709.00已超出该显示精度的舍入容差。约字不能为任意误差免责。" },
  { id: "C02", question: "贵州茅台2024年营业总收入是多少？",
    answer: "谨慎来看，2024年营业收入为1708.99亿元。这里暂把这一金额作为所问营业总收入的规模参考，具体仍以年报为准，也不据此预测股价。",
    reason: "1708.99是正确的营业收入数值，但问题问的是营业总收入；谨慎措辞和以年报为准不能纠正指标混用。" },
  { id: "C03", question: "贵州茅台2024年全年营业收入是多少？",
    answer: "2024年上半年营业收入为1708.99亿元。金额采用合并报表口径，保留两位小数，历史数据不构成收益承诺。",
    reason: "1708.99对应2024全年，回答将它放到上半年，并未回答全年问题。现有证据表未登记半年值，不能因此声称已知正确半年值。" },
];
const challenges = challengeInputs.map(({ reason, ...input }) => {
  const sample = { ...validationSample({ ...input, intent: "fact", profileId: "experienced", evidenceIds: ["S1"] }),
    promptVersion: "offline-challenge-v1" };
  const evaluation = evaluate(sample, [], EVIDENCE, evaluationAt);
  const localizationNote = evaluation.findings.some(f => f.title === "回答可能使用了其他公司主体")
    ? "本题虽触发告警，但原因是将普通语句误识别为公司主体，未正确定位指标口径问题；二元TP不能当作正确定位。"
    : null;
  return { sample, reference: { needsReview: true, reason }, evaluation, flag: actionableRuleFindings(evaluation).length > 0, localizationNote };
});
const report = { schemaVersion: 1, generatedAt, evaluationAt,
  baseline: { version: baseline.rulesVersion, metrics: baseline.ruleMetrics },
  current: { version: EVALUATOR_VERSION, metrics: classificationCounts(cases.map(c => ({ id: c.id, expected: c.expectedReview, predicted: c.afterFlag }))) },
  cases, challenges,
  limits: [
    "初测原始结果与模型返回均未改写；本文件只记录修复后的离线规则回归，没有发起模型调用。",
    "这12题已被用于定位和修复规则，因此不再是新规则的独立留出集；修复后结果不能作为泛化准确率。",
    "参考标签仍为AI预标注，用户转发的外部AI意见不等于用户或领域专家逐题人工确认。",
    "初测H04与H08虽在二元计分中记为TP，但当时主要依靠错误的主体告警，不能据此说正确定位问题。",
    "三条挑战题由同一助手在初测之后构造，仅检查小数精度、谨慎措辞下的口径混用与报告期错置，不构成独立质量评测。",
    "所有案例仍集中于一家公司的一份年报；规则依赖有限句式和指标登记，未验证跨公司、跨行业或真实用户分布。",
  ] };
await writeFile("public/evidence/quality-regression-20261025.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ version: report.current.version, metrics: report.current.metrics, challenges: challenges.map(c => ({ id: c.sample.id, flag: c.flag })), modelRequests: 0 }));
