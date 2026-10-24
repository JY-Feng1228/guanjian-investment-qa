import type { Sample } from "./domain.ts";
import { evaluate } from "./evaluator.ts";
import { EVIDENCE, seedSamples } from "./seed.ts";

export type ImprovementCase = {
  id: string;
  title: string;
  sampleBefore: Sample;
  sampleAfter: Sample;
  peersBefore: Sample[];
  peersAfter: Sample[];
  hypothesis: string;
  evidenceSteps: string[];
  changes: string[];
  remainingLimit: string;
};

// AI-authored answer revisions for a worked example, not model generations or human labels.
const CASE_DEFINED_AT = "2026-10-24T21:44:32.000Z";
const REVISION_LABEL = "case-revision-v1";
const samples = seedSamples(CASE_DEFINED_AT);
const causeBefore = samples.find((sample) => sample.id === "Q05-novice-v1");
const profileBefore = samples.find((sample) => sample.id === "Q07-novice-v1");
const profileReference = samples.find((sample) => sample.id === "Q07-experienced-v1");
if (!causeBefore || !profileBefore || !profileReference) {
  throw new Error("The documented improvement-case source samples are missing.");
}

export const IMPROVEMENT_CASES: ImprovementCase[] = [
  {
    id: "BC01",
    title: "回答修订：从营收增长事实，收回无证据因果与收益确定性",
    sampleBefore: causeBefore,
    sampleAfter: {
      ...causeBefore,
      id: "BC01-after",
      promptVersion: REVISION_LABEL,
      provenance: "constructed",
      answer: "2024 年营业收入同比增长 15.71%（S1 第 5 页，2024 年全年合并口径）。S1 第 8 页的经营解释同时提到销量增加及主要产品价格调整，但该段没有量化两者各自的贡献，无法据此确认增长全部由提价推动。关于后续股价，历史财报没有给出充分证据；现有资料也未提供当前估值、后续经营或市场变化的信息。这里仅说明历史经营情况，不作确定性股价判断、收益承诺或直接买卖建议。",
    },
    peersBefore: [],
    peersAfter: [],
    hypothesis: "原回答把一个正确的增长数字当作排他性因果证据，又从经营事实跳到未来股价确定性。可观察的问题是证据范围与结论范围不匹配；这是依据文本提出的归因假设，不能据此认定某个上游模型或 Prompt 的内部机制。",
    evidenceSteps: [
      "S1 官方年报第 5 页登记的 2024 年营业收入同比增长率为 15.71%；原回答的这个数值本身不需要改动。",
      "S1 第 8 页的既有原文核验记录同时列出销量增加及主要产品价格调整，未在该段量化两者贡献，不能支撑“完全由提价导致”。",
      "现有 S1 是历史财报，不包含当前估值或未来股价证据；准确的增长数字不能成为未来收益确定性的依据。",
    ],
    changes: [
      "保留增长数值、报告期、合并口径与第 5 页出处，不靠删除被核验事实取得更少发现。",
      "补充第 8 页的解释与未量化边界，撤回单一原因的排他性断言。",
      "移除确定性股价结论，明确现有证据不足；这是 AI 助手修订回答文本，不是重新运行或优化生成 Prompt。",
    ],
    remainingLimit: "修订仍没有量化各因素贡献，也不能预测后续股价。规则未再检出疑点不代表语义正确性已被独立确认；本案例未产生真人复核标签，仍需基于原文判断。",
  },
  {
    id: "BC02",
    title: "回答修订：两种画像采用同一组财务事实",
    sampleBefore: profileBefore,
    sampleAfter: {
      ...profileBefore,
      id: "BC02-after",
      promptVersion: REVISION_LABEL,
      provenance: "constructed",
      answer: "先解释术语：营业收入反映经营收入规模，归母净利润是归属于母公司股东的利润，不等于分红或投资者收益。贵州茅台 2024 年营业收入为 1708.99 亿元，归母净利润为 862.28 亿元。两项均为 2024 年全年合并口径，金额按人民币亿元保留两位小数，精确值见 S1 第 5 页。知识程度可以改变术语解释和信息详略，但不能改变数值、单位、报告期与出处。风险偏好也不能改变这些历史事实或消除未来投资风险。",
    },
    peersBefore: [profileReference],
    // Keep the reference answer text and facts unchanged. Only align its comparison label;
    // otherwise the evaluator would exclude it and conceal the original profile mismatch.
    peersAfter: [{ ...profileReference, id: "BC02-reference-after", promptVersion: REVISION_LABEL }],
    hypothesis: "同题、同模型标签和同数据版本下，入门画像写成 962.28 亿元，另一画像写成 862.28 亿元；前者也偏离 S1。可据此提出“个性化表达没有保持事实一致”的问题假设，但无法凭这些构造文本确定真实系统中的检索、生成或缓存环节谁导致了变化。",
    evidenceSteps: [
      "S1 第 5 页登记的 2024 年营业收入为 170,899,152,276.34 元，归母净利润为 86,228,146,421.62 元，均为合并口径。",
      "人民币元换算为亿元、保留两位小数后分别为 1708.99 和 862.28；原入门回答的 962.28 不受显示精度容差支持。",
      "固定参考回答 Q07-experienced-v1 已使用 862.28 亿元。前后均与这份相同文本配对，并分别对照同一 S1，不能仅凭两画像彼此一致便宣称事实正确。",
    ],
    changes: [
      "将入门画像的归母净利润恢复为 S1 支持的 862.28 亿元；保留营业收入、报告期、合并口径、币种与出处。",
      "继续解释财务术语，把用户知识程度的影响限制在表达详略，不让画像改变事实。",
      "参考画像回答全文不改；after 侧仅同步案例版本标签以保持规则配对。该标签表示 AI 助手的回答修订，不表示真实 Prompt 生成或优化。",
    ],
    remainingLimit: "当前一致性检查只覆盖已解析的财务数值，不代表完整 KYC 适当性审查。参考回答仍为构造示例，事实依据是 S1；本案例没有真人确认或独立模型质量结论。",
  },
];

export function evaluateImprovementCase(item: ImprovementCase, at = new Date().toISOString()) {
  return {
    before: evaluate(item.sampleBefore, item.peersBefore, EVIDENCE, at),
    after: evaluate(item.sampleAfter, item.peersAfter, EVIDENCE, at),
  };
}
