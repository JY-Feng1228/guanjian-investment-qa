import {test} from "node:test";
import assert from "node:assert/strict";
import {containsSensitivePattern} from "../lib/privacy.ts";
test("financial amounts are not mistaken for phone numbers",()=>{
  for(const value of ["营业收入为13900000000.25元。","营业收入为13900000000元。","13900000000.25 万元","13900000000亿元"])
    assert.equal(containsSensitivePattern(value),false,value);
});
test("phone, identity and API-key patterns remain blocked",()=>{
  for(const value of ["电话13800000000","13800000000","身份证110101199001010011","sk-synthetic0123456789012"])
    assert.equal(containsSensitivePattern(value),true,value);
});
