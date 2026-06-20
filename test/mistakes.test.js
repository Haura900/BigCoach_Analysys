const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyMajorMistake, listMajorMistakes } = require("../src/lib/mistakes");

test("Q値差と実打確率の両方で大悪手を判定する", () => {
  const mistake = { actual: "1m", recommended: "2m", qGap: 2.5, actualProbability: 0.001 };
  assert.equal(classifyMajorMistake(mistake).isMajor, true);
  assert.equal(classifyMajorMistake({ ...mistake, qGap: 1.9 }).isMajor, false);
  assert.equal(classifyMajorMistake({ ...mistake, actualProbability: 0.02 }).isMajor, false);
});

test("大悪手一覧は基準を設定で変更できる", () => {
  const source = [
    { actual: "1m", recommended: "2m", qGap: 1.5, actualProbability: 0.02 },
    { actual: "3m", recommended: "4m", qGap: 3, actualProbability: 0.001 }
  ];
  assert.equal(listMajorMistakes(source).length, 1);
  assert.equal(listMajorMistakes(source, { majorMistakeQGap: 1, majorMistakeMaxProbability: 0.03 }).length, 2);
});
