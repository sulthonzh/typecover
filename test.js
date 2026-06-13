'use strict';

const fs = require('fs');
const path = require('path');
const { analyze, analyzeFile, formatReport, checkCI, coverageToGrade, walkDir } = require('./index.js');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const TMP = path.join(__dirname, '__test_fixtures__');
const clean = () => { if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true }); };
clean();
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.join(TMP, 'subdir'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'node_modules', 'pkg'), { recursive: true });

// Fixtures
fs.writeFileSync(path.join(TMP, 'clean.ts'),
  'interface User { name: string; age: number; }\nfunction greet(user: User): string { return "Hello " + user.name; }\nconst x: number = 42;\n');

fs.writeFileSync(path.join(TMP, 'unsafe.ts'),
  'const data: any = fetchData();\nconst items: any[] = [];\nfunction parse(): any { return JSON.parse(str); }\nconst val = data as unknown as string;\nconst num = <number>val;\n// @ts-ignore\nconst foo = bar.baz;\n// @ts-expect-error\nconst qux = broken;\n// @ts-nocheck\nconst forced = obj!.prop;\nconst unwrap = arr!\n');

fs.writeFileSync(path.join(TMP, 'subdir', 'nested.ts'),
  'export function safe(a: string): number { return a.length; }\n');

fs.writeFileSync(path.join(TMP, 'node_modules', 'pkg', 'index.ts'),
  'export const x: any = 1;\n');

fs.writeFileSync(path.join(TMP, 'react.tsx'),
  'const App: React.FC = () => <div />;\n');

console.log('\n  typecover tests\n');

// 1. Clean file high coverage
const cr = analyzeFile(path.join(TMP, 'clean.ts'));
assert(cr.coverage >= 95, `Clean coverage should be >= 95%, got ${cr.coverage}%`);
assert(cr.findings.length === 0, `Clean file 0 findings, got ${cr.findings.length}`);

// 2. Unsafe file detects patterns
const ur = analyzeFile(path.join(TMP, 'unsafe.ts'));
const ids = ur.findings.map(f => f.ruleId);
assert(ids.includes('any-keyword'), 'Should detect any-keyword');
assert(ids.includes('any-array'), 'Should detect any-array');
assert(ids.includes('any-return'), 'Should detect any-return');
assert(ids.includes('as-cast'), 'Should detect as-cast');
assert(ids.includes('ts-ignore'), 'Should detect ts-ignore');
assert(ids.includes('ts-expect-error'), 'Should detect ts-expect-error');
assert(ids.includes('ts-nocheck'), 'Should detect ts-nocheck');
assert(ur.coverage < 80, `Unsafe coverage < 80%, got ${ur.coverage}%`);

// 3. Directory analysis
const dr = analyze(TMP);
assert(dr.results.length === 4, `Should find 4 files (clean,unsafe,nested,react), got ${dr.results.length}`);
assert(dr.summary.totalLines > 0, 'Should have total lines');
assert(dr.summary.coverage > 0 && dr.summary.coverage <= 100, 'Coverage should be 0-100');
assert(dr.summary.grade, 'Should have a grade');

// 4. Coverage grades
assert(coverageToGrade(100) === 'A+', '100% = A+');
assert(coverageToGrade(95) === 'A', '95% = A');
assert(coverageToGrade(90) === 'A-', '90% = A-');
assert(coverageToGrade(85) === 'B+', '85% = B+');
assert(coverageToGrade(80) === 'B', '80% = B');
assert(coverageToGrade(75) === 'B-', '75% = B-');
assert(coverageToGrade(70) === 'C+', '70% = C+');
assert(coverageToGrade(65) === 'C', '65% = C');
assert(coverageToGrade(60) === 'C-', '60% = C-');
assert(coverageToGrade(50) === 'D', '50% = D');
assert(coverageToGrade(40) === 'F', '40% = F');

// 5. CI check
assert(checkCI({ summary: { coverage: 90 } }, 80) === true, '90% passes 80');
assert(checkCI({ summary: { coverage: 70 } }, 80) === false, '70% fails 80');
assert(checkCI({ summary: { coverage: 80 } }, 80) === true, '80% passes 80');

// 6. Format report
const report = formatReport(dr, { verbose: true, showFindings: false });
assert(report.includes('Coverage:'), 'Report shows coverage');
assert(report.includes('By Severity:'), 'Report shows severity');
assert(report.includes('By Rule:'), 'Report shows rules');
assert(report.includes('Per-File Coverage:'), 'Verbose shows per-file');

// 7. Quiet report
const quiet = formatReport(dr, { verbose: false });
assert(!quiet.includes('Per-File Coverage:'), 'Quiet no per-file');

// 8. Pattern filtering
const filtered = analyze(TMP, { patterns: ['any-keyword', 'ts-ignore'] });
const fids = filtered.results.flatMap(r => r.findings.map(f => f.ruleId));
assert(fids.every(r => ['any-keyword', 'ts-ignore'].includes(r)), 'Filtered patterns only');

// 9. Missing path
const missing = analyze('/nonexistent/path');
assert(missing.error, 'Missing path returns error');

// 10. Ignores node_modules
const walked = walkDir(TMP);
assert(!walked.some(f => f.includes('node_modules')), 'Ignores node_modules');

// 11. Detects .tsx
assert(walked.some(f => f.endsWith('.tsx')), 'Detects .tsx files');

// 12. Summary structures
assert(typeof dr.summary.byRule === 'object', 'byRule is object');
assert(typeof dr.summary.bySeverity === 'object', 'bySeverity is object');
assert(Object.keys(dr.summary.bySeverity).length > 0, 'bySeverity has entries');

// 13. JSON CLI output
const { execSync } = require('child_process');
try {
  const out = execSync(`node ${path.join(__dirname, 'cli.js')} ${TMP} --json --quiet`, { encoding: 'utf-8' });
  const p = JSON.parse(out);
  assert(p.summary && p.results, 'JSON has summary+results');
} catch (e) {
  if (e.stdout) {
    const p = JSON.parse(e.stdout);
    assert(p.summary && p.results, 'JSON parses even on CI fail');
  }
}

// 14. Findings in report
const fr = formatReport(dr, { verbose: false, showFindings: true });
assert(fr.includes('Top Findings') || dr.summary.totalFindings === 0, 'Show findings works');

// 15. Safe lines calculation
assert(dr.summary.safeLines >= 0, 'Safe lines >= 0');
assert(dr.summary.safeLines <= dr.summary.totalLines, 'Safe lines <= total');

// Cleanup
clean();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
