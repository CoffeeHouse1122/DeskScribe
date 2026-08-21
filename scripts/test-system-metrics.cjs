const assert = require("node:assert/strict");
const { calculateCpuPercent } = require("../dist/main/system-metrics.js");

assert.equal(calculateCpuPercent({ idle: 40, total: 100 }, { idle: 70, total: 200 }), 70);
assert.equal(calculateCpuPercent({ idle: 40, total: 100 }, { idle: 40, total: 100 }), 0);
assert.equal(calculateCpuPercent({ idle: 80, total: 100 }, { idle: 70, total: 200 }), 100);

console.log("System metrics regression checks passed.");
