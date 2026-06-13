'use strict';

const fs = require('fs');
const path = require('path');

const UNSAFE_PATTERNS = [
  { id: 'any-keyword', regex: /(?<!\w):\s*any\b(?!\s*\[)/g, desc: 'Explicit `any` type annotation', severity: 'high' },
  { id: 'any-array', regex: /:\s*any\[\]/g, desc: '`any[]` type annotation', severity: 'high' },
  { id: 'any-return', regex: /\)\s*:\s*any\b/g, desc: 'Function returns `any`', severity: 'high' },
  { id: 'as-cast', regex:/\bas\s+[A-Za-z]\w*/g, desc: '`as` type assertion', severity: 'medium' },
  { id: 'angle-bracket-cast', regex: /<[A-Za-z]\w+>\s*\(/g, desc: 'Angle-bracket type assertion', severity: 'medium' },
  { id: 'ts-ignore', regex: /\/\/\s*@ts-ignore/g, desc: '`@ts-ignore` suppresses errors', severity: 'high' },
  { id: 'ts-expect-error', regex: /\/\/\s*@ts-expect-error/g, desc: '`@ts-expect-error` suppresses errors', severity: 'medium' },
  { id: 'ts-nocheck', regex: /\/\/\s*@ts-nocheck/g, desc: '`@ts-nocheck` disables checking for entire file', severity: 'critical' },
  { id: 'non-null-assertion', regex: /\w+!+\.\w+/g, desc: 'Non-null assertion (`!.`)', severity: 'low' },
  { id: 'force-unwraps', regex: /\w+!+\[|!\!/g, desc: 'Force unwrap operator', severity: 'low' },
];

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
  'out', '.cache', '.vscode', '.idea', '__snapshots__', 'vendor',
]);

function isTypeScriptFile(filepath) {
  return /\.(ts|tsx|mts|cts)$/.test(filepath);
}

function countLines(content) {
  return content.split('\n').length;
}

function stripComments(content) {
  // Simple approach: keep single-line comments for @ts-* detection
  // but strip multi-line strings/comments that could false-positive
  return content;
}

function analyzeFile(filepath, options = {}) {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = countLines(content);
  const findings = [];

  for (const pattern of UNSAFE_PATTERNS) {
    if (options.patterns && !options.patterns.includes(pattern.id)) continue;

    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    const linesArr = content.split('\n');
    linesArr.forEach((line, idx) => {
      // Skip string literals for some patterns
      if (pattern.id === 'any-keyword' && line.trimStart().startsWith('//')) return;
      const match = regex.test(line);
      regex.lastIndex = 0;
      if (match) {
        findings.push({
          file: filepath,
          line: idx + 1,
          column: 0,
          ruleId: pattern.id,
          description: pattern.desc,
          severity: pattern.severity,
          source: line.trim(),
        });
      }
    });
  }

  const safeLines = lines - findings.length;
  const coverage = lines > 0 ? ((safeLines / lines) * 100) : 100;

  return {
    file: filepath,
    lines,
    safeLines: Math.max(0, safeLines),
    findings,
    coverage: Math.round(coverage * 100) / 100,
  };
}

function walkDir(dir, ignoreDirs = DEFAULT_IGNORE_DIRS) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoreDirs.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, ignoreDirs));
    } else if (isTypeScriptFile(full)) {
      results.push(full);
    }
  }
  return results;
}

function analyze(targetPath, options = {}) {
  const resolved = path.resolve(targetPath);

  if (!fs.existsSync(resolved)) {
    return { error: `Path not found: ${resolved}`, results: [], summary: {} };
  }

  const files = fs.statSync(resolved).isDirectory()
    ? walkDir(resolved, options.ignoreDirs ? new Set(options.ignoreDirs) : DEFAULT_IGNORE_DIRS)
    : isTypeScriptFile(resolved) ? [resolved] : [];

  if (files.length === 0) {
    return { error: 'No TypeScript files found', results: [], summary: {} };
  }

  const results = files.map(f => analyzeFile(f, options));

  const totalLines = results.reduce((s, r) => s + r.lines, 0);
  const totalFindings = results.reduce((s, r) => s + r.findings.length, 0);
  const totalSafe = results.reduce((s, r) => s + r.safeLines, 0);
  const overallCoverage = totalLines > 0 ? Math.round((totalSafe / totalLines) * 10000) / 100 : 100;

  const byRule = {};
  for (const r of results) {
    for (const f of r.findings) {
      byRule[f.ruleId] = (byRule[f.ruleId] || 0) + 1;
    }
  }

  const bySeverity = {};
  for (const r of results) {
    for (const f of r.findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    }
  }

  const summary = {
    files: files.length,
    totalLines,
    totalFindings,
    safeLines: totalSafe,
    coverage: overallCoverage,
    grade: coverageToGrade(overallCoverage),
    byRule,
    bySeverity,
  };

  return { results, summary };
}

function coverageToGrade(coverage) {
  if (coverage >= 98) return 'A+';
  if (coverage >= 95) return 'A';
  if (coverage >= 90) return 'A-';
  if (coverage >= 85) return 'B+';
  if (coverage >= 80) return 'B';
  if (coverage >= 75) return 'B-';
  if (coverage >= 70) return 'C+';
  if (coverage >= 65) return 'C';
  if (coverage >= 60) return 'C-';
  if (coverage >= 50) return 'D';
  return 'F';
}

function formatReport(analysis, options = {}) {
  const { results, summary } = analysis;
  const lines = [];

  lines.push(`\n  typecover — TypeScript Type Coverage Report\n`);
  lines.push(`  Coverage: ${summary.coverage}% (${summary.grade})`);
  lines.push(`  Files:    ${summary.files} | Lines: ${summary.totalLines} | Unsafe: ${summary.totalFindings}`);
  lines.push('');

  // By severity
  const severityOrder = ['critical', 'high', 'medium', 'low'];
  lines.push('  By Severity:');
  for (const sev of severityOrder) {
    if (summary.bySeverity[sev]) {
      lines.push(`    ${sev.padEnd(10)} ${summary.bySeverity[sev]}`);
    }
  }
  lines.push('');

  // By rule
  const sortedRules = Object.entries(summary.byRule).sort((a, b) => b[1] - a[1]);
  lines.push('  By Rule:');
  for (const [rule, count] of sortedRules) {
    lines.push(`    ${rule.padEnd(24)} ${count}`);
  }
  lines.push('');

  // Per-file breakdown
  if (options.verbose !== false) {
    const sorted = [...results].sort((a, b) => a.coverage - b.coverage);
    lines.push('  Per-File Coverage:');
    lines.push(`  ${'Coverage'.padEnd(10)} ${'File'.padEnd(50)} Issues`);
    lines.push(`  ${'--------'.padEnd(10)} ${'----'.padEnd(50)} ------`);
    for (const r of sorted) {
      const cov = `${r.coverage}%`.padEnd(10);
      const rel = r.file.replace(process.cwd() + '/', '');
      const fname = rel.length > 48 ? '...' + rel.slice(-45) : rel;
      lines.push(`  ${cov} ${fname.padEnd(50)} ${r.findings.length}`);
    }
    lines.push('');
  }

  // Top findings
  if (options.showFindings) {
    const allFindings = results.flatMap(r => r.findings);
    const sorted = allFindings.sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (sevOrder[a.severity] || 9) - (sevOrder[b.severity] || 9);
    });
    const top = sorted.slice(0, 50);
    lines.push(`  Top Findings (showing ${top.length} of ${allFindings.length}):`);
    for (const f of top) {
      const rel = f.file.replace(process.cwd() + '/', '');
      lines.push(`    ${f.severity.padEnd(9)} ${rel}:${f.line}  ${f.description}`);
      lines.push(`             ${f.source}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function checkCI(analysis, threshold = 80) {
  return analysis.summary.coverage >= threshold;
}

module.exports = { analyze, analyzeFile, formatReport, checkCI, coverageToGrade, UNSAFE_PATTERNS, walkDir };
