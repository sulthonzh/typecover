'use strict';

const fs = require('fs');
const path = require('path');
const { analyze, analyzeFile, grade, formatReport } = require('./index.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const tmpDir = path.join(__dirname, '__test_tmp__');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

fs.writeFileSync(path.join(tmpDir, 'good.ts'), `
export function add(a: number, b: number): number {
  return a + b;
}

export const multiply = (x: number, y: number): number => x * y;

interface User {
  name: string;
  age: number;
}

export function greet(user: User): string {
  return 'Hello ' + user.name;
}
`);

fs.writeFileSync(path.join(tmpDir, 'bad.ts'), `
export function process(data: any): any {
  return data;
}

export const parse = (input: any) => {
  return JSON.parse(input as any);
}

export function untyped(x, y) {
  return x + y;
}

// @ts-ignore
export const thing: any = {};
`);

fs.writeFileSync(path.join(tmpDir, 'nocheck.ts'), `// @ts-nocheck
export function broken(): any {
  return null;
}
`);

fs.writeFileSync(path.join(tmpDir, 'empty.ts'), ``);

fs.writeFileSync(path.join(tmpDir, 'complex.ts'), `
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function tryParse(text: string): Result<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'Parse error' };
  }
}

export async function fetchData(url: string): Promise<Response> {
  return fetch(url);
}

const items = [1, 2, 3];
const untyped;
`);

// --- Tests ---
console.log('Testing analyzeFile on good.ts...');
const goodResult = analyzeFile(path.join(tmpDir, 'good.ts'));
assert(goodResult.stats.anyCount === 0, 'good.ts should have 0 any');
assert(goodResult.coverage.overall >= 80, 'good.ts coverage should be >= 80');

console.log('Testing analyzeFile on bad.ts...');
const badResult = analyzeFile(path.join(tmpDir, 'bad.ts'));
assert(badResult.stats.anyCount >= 2, `bad.ts should have >= 2 any, got ${badResult.stats.anyCount}`);
assert(badResult.stats.asAnyCount >= 1, `bad.ts should have >= 1 as any, got ${badResult.stats.asAnyCount}`);
assert(badResult.stats.implicitAny >= 2, `bad.ts should have >= 2 untyped params, got ${badResult.stats.implicitAny}`);
assert(badResult.coverage.overall < 80, 'bad.ts coverage should be < 80');

const anyIssues = badResult.issues.filter(i => i.type === 'explicit-any');
const asAnyIssues = badResult.issues.filter(i => i.type === 'as-any');
const untypedParams = badResult.issues.filter(i => i.type === 'untyped-param');
assert(anyIssues.length >= 2, 'Should find explicit any issues');
assert(asAnyIssues.length >= 1, 'Should find as-any issues');
assert(untypedParams.length >= 2, 'Should find untyped param issues');

console.log('Testing analyzeFile on nocheck.ts...');
const nocheckResult = analyzeFile(path.join(tmpDir, 'nocheck.ts'));
const nocheckIssues = nocheckResult.issues.filter(i => i.type === 'ts-nocheck');
assert(nocheckIssues.length >= 1, `Should detect @ts-nocheck, found ${nocheckIssues.length}`);

console.log('Testing analyzeFile on empty.ts...');
const emptyResult = analyzeFile(path.join(tmpDir, 'empty.ts'));
assert(emptyResult.stats.linesOfCode === 0, 'Empty file should have 0 lines');
assert(emptyResult.issues.length === 0, 'Empty file should have 0 issues');

console.log('Testing analyzeFile on complex.ts...');
const complexResult = analyzeFile(path.join(tmpDir, 'complex.ts'));
assert(complexResult.stats.totalFunctions >= 1, `Should detect at least 1 function, got ${complexResult.stats.totalFunctions}`);
assert(complexResult.stats.untypedVars >= 1, 'Should detect untyped var');

console.log('Testing full analyze()...');
const fullResult = analyze(tmpDir);
assert(fullResult.files.length === 5, 'Should find 5 files');
assert(fullResult.summary.totalFiles === 5, 'Summary should show 5 files');
assert(fullResult.summary.totalIssues > 0, 'Should have issues');
assert(typeof fullResult.summary.coverage.overall === 'number', 'Overall coverage should be a number');
assert(fullResult.summary.grade !== undefined, 'Should have a grade');
assert(['A','B','C','D','F'].includes(fullResult.summary.grade), 'Grade should be A-F');

console.log('Testing grade()...');
assert(grade(100) === 'A', '100 = A');
assert(grade(95) === 'A', '95 = A');
assert(grade(90) === 'B', '90 = B');
assert(grade(85) === 'B', '85 = B');
assert(grade(80) === 'C', '80 = C');
assert(grade(70) === 'C', '70 = C');
assert(grade(60) === 'D', '60 = D');
assert(grade(50) === 'D', '50 = D');
assert(grade(40) === 'F', '40 = F');
assert(grade(0) === 'F', '0 = F');

console.log('Testing min-severity filter...');
const errOnly = analyze(tmpDir, { minSeverity: 'error' });
const allInfo = analyze(tmpDir, { minSeverity: 'info' });
assert(errOnly.summary.totalIssues <= allInfo.summary.totalIssues, 'Error-only should have <= issues');

console.log('Testing formatReport()...');
const report = formatReport(fullResult);
assert(report.includes('TypeCover'), 'Report should have title');
assert(report.includes('Coverage'), 'Report should have coverage section');
assert(report.includes('Grade'), 'Report should have grade');
assert(typeof report === 'string' && report.length > 100, 'Report should be a decent string');

console.log('Testing issue source lines...');
for (const issue of badResult.issues) {
  assert(issue.line > 0, 'Issue should have line number');
  assert(issue.source !== undefined, 'Issue should have source line');
  assert(issue.severity !== undefined, 'Issue should have severity');
}

// JSON output test
const json = JSON.stringify(fullResult);
const parsed = JSON.parse(json);
assert(parsed.summary.totalFiles === 5, 'JSON round-trip works');

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
