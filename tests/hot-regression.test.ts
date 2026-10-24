import { test } from "node:test";
import { checkHotRegression } from "../scripts/check-hot-context-regression.ts";

test("rules-1.3.0 preserves all 32 seeds, 12 validation cases, three challenges and frozen files", () => {
  checkHotRegression();
});
