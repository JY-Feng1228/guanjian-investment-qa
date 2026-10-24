import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../lib/evaluator.ts";
import { EVIDENCE, seedSamples } from "../lib/seed.ts";
import type { Evidence, Sample } from "../lib/domain.ts";

const at = "2026-10-25T12:00:00+08:00";
const hot: Evidence = { id: "HOT", title: "贵州茅台新闻测试夹具", provider: "fixture · search_news", url: "",
  publishedAt: "2026-10-19", retrievedAt: at, period: "新闻", kind: "hotspot", status: "snapshot",
  excerpt: "测试新闻片段，不是真实取数", facts: [], note: "" };
const base: Sample = { ...seedSamples(at)[0], id: "hot-test", questionId: "hot-test", askedAt: at,
  question: "贵州茅台近期热点和2024年营业收入是什么？", evidenceIds: ["S1", "HOT"],
  answer: "2024年营业收入为1708.99亿元。2026-10-19的新闻[HOT]提到渠道调整。" };
const run = (patch: Partial<Sample> = {}, sources: Evidence[] = [hot]) => evaluate({ ...base, ...patch }, [], [...EVIDENCE, ...sources], at);

test("hotspot a: publication after question is a conflict", () => {
  const result = run({ askedAt: "2026-10-18T12:00:00+08:00" });
  assert.ok(result.findings.some(f => f.title === "热点发布时间晚于提问时间" && f.status === "contradicted"));
});

test("hotspot b: expired news presented as latest raises freshness even beside fresh evidence", () => {
  const fresh = { ...hot, id: "FRESH", publishedAt: "2026-10-25" };
  const result = run({ askedAt: "2026-10-28T12:00:00+08:00", evidenceIds: ["S1", "HOT", "FRESH"],
    answer: "2024年营业收入为1708.99亿元。最新热点[HOT]是渠道调整。" }, [hot, fresh]);
  assert.ok(result.findings.some(f => f.title === "过期热点不能作为今天或最新消息" && f.status === "unverifiable"));
});

test("hotspot c: news cannot overwrite registered financial facts even without selecting report", () => {
  const result = run({ evidenceIds: ["HOT"], answer: "依据热点[HOT]改写历史财报：2024年营业收入为1808.99亿元。" });
  assert.ok(result.findings.some(f => f.title === "热点不能改写已登记财务事实" && f.status === "contradicted"));
});

test("dated background remains usable after expiry and profiles cannot change financial truth", () => {
  for (const profileId of ["novice", "experienced"]) {
    const result = run({ profileId, askedAt: "2026-11-01T12:00:00+08:00" });
    assert.equal(result.status, "supported");
    assert.equal(run({ profileId, answer: "根据新闻[HOT]，2024年营业收入为1808.99亿元。" }).status, "contradicted");
  }
});

test("seven-day boundary uses question time, not evaluation or retrieval time", () => {
  const source = { ...hot, publishedAt: "2026-10-18T12:00:00+08:00" };
  const answer = "2024年营业收入为1708.99亿元。近期热点[HOT]是渠道调整。";
  assert.equal(run({ answer }, [source]).status, "supported");
  assert.ok(run({ answer, askedAt: "2026-10-25T12:00:00.001+08:00" }, [source]).findings.some(f => f.title === "过期热点不能作为今天或最新消息"));
  assert.ok(run({ answer, askedAt: "2026-10-18T11:59:59+08:00" }, [source]).findings.some(f => f.title === "热点发布时间晚于提问时间"));
});

test("missing or invalid dates never become hotspot evidence", () => {
  for (const publishedAt of ["", "invalid", "2026-02-30"])
    assert.ok(run({}, [{ ...hot, publishedAt }]).findings.some(f => f.title === "热点缺少有效发布时间或提问时间"));
});

test("unused hot sources and explicit time disclaimers do not add alerts", () => {
  const future = { ...hot, id: "FUTURE", publishedAt: "2026-11-01" };
  assert.equal(run({ evidenceIds: ["S1", "HOT", "FUTURE"] }, [hot, future]).status, "supported");
  assert.equal(run({ askedAt: "2026-11-01T12:00:00+08:00", answer: base.answer + "这不是今天或最新消息。" }).status, "supported");
});

test("a dated historical reference does not contaminate a separate fresh claim", () => {
  const fresh = { ...hot, id: "FRESH", publishedAt: "2026-10-28" };
  const result = run({ evidenceIds: ["S1", "HOT", "FRESH"], askedAt: "2026-10-28T12:00:00+08:00",
    answer: base.answer + "最新热点[FRESH]是产品调整。" }, [hot, fresh]);
  assert.equal(result.status, "supported");
});

test("hotspot financial numbers never become official fact registrations", () => {
  const polluted = { ...hot, facts: EVIDENCE[0].facts.map(f => ({ ...f, value: 1 })) };
  assert.equal(run({}, [polluted]).status, "supported");
});
