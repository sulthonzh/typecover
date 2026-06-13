'use strict';

const fs = require('fs');
const path = require('path');

const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);

function walkDir(dir, ignorePatterns = []) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (ignorePatterns.some(p => entry.name.includes(p))) continue;
      results.push(...walkDir(fullPath, ignorePatterns));
    } else if (TS_EXTS.has(path.extname(entry.name))) {
      if (entry.name.endsWith('.d.ts')) continue;
      results.push(fullPath);
    }
  }
  return results;
}

function analyzeFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf-8');
  const lines = source.split('\n');
  const issues = [];
  const stats = {
    totalFunctions: 0,
    typedFunctions: 0,
    totalParams: 0,
    typedParams: 0,
    anyCount: 0,
    asAnyCount: 0,
    implicitAny: 0,
    untypedVars: 0,
    linesOfCode: 0,
  };

  // Strip block comments from entire source first
  let cleanSource = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip string contents
  cleanSource = cleanSource.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  cleanSource = cleanSource.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  cleanSource = cleanSource.replace(/`(?:[^`\\]|\\.)*`/g, '``');

  const cleanLines = cleanSource.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const cleanLine = (cleanLines[i] || '').replace(/\/\/.*$/, '');

    // Check raw line for ts directives (before any filtering)
    if (rawLine.includes('@ts-ignore')) {
      issues.push({ line: i + 1, col: rawLine.indexOf('@ts-ignore') + 1, type: 'ts-ignore', message: '@ts-ignore suppresses type checking', severity: 'warning', source: rawLine.trim() });
    }
    if (rawLine.includes('@ts-nocheck')) {
      issues.push({ line: i + 1, col: rawLine.indexOf('@ts-nocheck') + 1, type: 'ts-nocheck', message: '@ts-nocheck disables type checking for entire file', severity: 'error', source: rawLine.trim() });
    }

    if (!cleanLine.trim()) continue;
    stats.linesOfCode++;

    // Count `any` usage
    const anyMatches = cleanLine.matchAll(/\bany\b/g);
    for (const m of anyMatches) {
      const before = cleanLine.slice(Math.max(0, m.index - 10), m.index);
      const after = cleanLine.slice(m.index + 3, m.index + 10);
      if (/\bas\s*$/.test(before)) {
        stats.asAnyCount++;
        issues.push({ line: i + 1, col: m.index + 1, type: 'as-any', message: '`as any` cast', severity: 'error', source: rawLine.trim() });
      } else if (/[<:,\[(]/.test(before.slice(-1)) || /[>\[\],)]/.test(after[0]) || after.startsWith('>') || before.endsWith('<')) {
        stats.anyCount++;
        issues.push({ line: i + 1, col: m.index + 1, type: 'explicit-any', message: 'Explicit `any` type', severity: 'error', source: rawLine.trim() });
      }
    }

    // Detect untyped function parameters: function name(param, param2) {
    const funcParamRegex = /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?)\s*\(([^)]*)\)/g;
    let fm;
    while ((fm = funcParamRegex.exec(cleanLine)) !== null) {
      if (!fm[1].trim()) continue;
      const params = fm[1].split(',');
      for (const param of params) {
        const trimmed = param.trim();
        if (!trimmed) continue;
        stats.totalParams++;
        const body = trimmed.startsWith('...') ? trimmed.slice(3) : trimmed;
        if (body.includes(':')) {
          stats.typedParams++;
        } else {
          stats.implicitAny++;
          issues.push({ line: i + 1, col: fm.index + 1, type: 'untyped-param', message: `Parameter '${body.split('=')[0].trim()}' lacks type annotation`, severity: 'warning', source: rawLine.trim() });
        }
      }
    }

    // Arrow function params: (params) => ...
    const arrowParamRegex = /(?:async\s+)?\(([^)]*)\)\s*=>/g;
    let am;
    while ((am = arrowParamRegex.exec(cleanLine)) !== null) {
      if (!am[1].trim()) continue;
      const params = am[1].split(',');
      for (const param of params) {
        const trimmed = param.trim();
        if (!trimmed) continue;
        stats.totalParams++;
        if (trimmed.includes(':')) {
          stats.typedParams++;
        } else {
          stats.implicitAny++;
          issues.push({ line: i + 1, col: am.index + 1, type: 'untyped-param', message: `Parameter '${trimmed.split('=')[0].trim()}' lacks type annotation`, severity: 'warning', source: rawLine.trim() });
        }
      }
    }

    // Single-param arrow: x => ...
    const singleArrowRegex = /(?:async\s+)?(\w+)\s*=>/g;
    let sm;
    while ((sm = singleArrowRegex.exec(cleanLine)) !== null) {
      const before = cleanLine.slice(Math.max(0, sm.index - 3), sm.index);
      if (/[=(,:\s]/.test(before.slice(-1)) || sm.index === 0) {
        // Avoid matching inside other constructs
        if (cleanLine.slice(sm.index, sm.index + 20).includes('=>')) {
          stats.totalParams++;
          stats.implicitAny++;
          issues.push({ line: i + 1, col: sm.index + 1, type: 'untyped-param', message: `Parameter '${sm[1]}' lacks type annotation`, severity: 'warning', source: rawLine.trim() });
        }
      }
    }

    // Detect missing return types on named functions
    const funcSigRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)[^{]*{/g;
    let fsig;
    while ((fsig = funcSigRegex.exec(cleanLine)) !== null) {
      stats.totalFunctions++;
      // Check if there's a return type annotation between ) and {
      const afterParen = cleanLine.slice(cleanLine.indexOf(')', fsig.index) + 1).trim();
      if (afterParen.startsWith(':')) {
        stats.typedFunctions++;
      } else {
        issues.push({ line: i + 1, col: fsig.index + 1, type: 'missing-return-type', message: `Function '${fsig[1]}' missing return type annotation`, severity: 'info', source: rawLine.trim() });
      }
    }

    // Untyped variables
    const varRegex = /(?:const|let|var)\s+(\w+)\s*;/g;
    let vm;
    while ((vm = varRegex.exec(cleanLine)) !== null) {
      stats.untypedVars++;
      issues.push({ line: i + 1, col: vm.index + 1, type: 'untyped-var', message: `Variable '${vm[1]}' declared without type or initializer`, severity: 'info', source: rawLine.trim() });
    }
  }

  const paramCoverage = stats.totalParams > 0 ? stats.typedParams / stats.totalParams : 1;
  const returnCoverage = stats.totalFunctions > 0 ? stats.typedFunctions / stats.totalFunctions : 1;
  const anyScore = stats.anyCount + stats.asAnyCount + stats.implicitAny + stats.untypedVars;
  const overallCoverage = stats.linesOfCode > 0 ? Math.max(0, 1 - anyScore / stats.linesOfCode) : 1;

  return {
    filePath,
    issues,
    stats,
    coverage: {
      params: Math.round(paramCoverage * 10000) / 100,
      returns: Math.round(returnCoverage * 10000) / 100,
      overall: Math.round(overallCoverage * 10000) / 100,
    },
  };
}

function grade(score) {
  if (score >= 95) return 'A';
  if (score >= 85) return 'B';
  if (score >= 70) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

function analyze(dir, options = {}) {
  const { ignore = [], minSeverity = 'info' } = options;
  const files = walkDir(dir, ignore);
  if (files.length === 0) {
    return { files: [], summary: { totalFiles: 0, totalIssues: 0, totalStats: {}, coverage: { params: 100, returns: 100, overall: 100 }, grade: 'A' } };
  }

  const severityOrder = { error: 3, warning: 2, info: 1 };
  const minSev = severityOrder[minSeverity] || 1;

  const results = files.map(f => {
    const result = analyzeFile(f);
    result.issues = result.issues.filter(i => (severityOrder[i.severity] || 1) >= minSev);
    return result;
  });

  const totalStats = {
    totalFunctions: 0, typedFunctions: 0,
    totalParams: 0, typedParams: 0,
    anyCount: 0, asAnyCount: 0, implicitAny: 0,
    untypedVars: 0, linesOfCode: 0,
  };

  let totalIssues = 0;
  for (const r of results) {
    for (const k of Object.keys(totalStats)) totalStats[k] += r.stats[k];
    totalIssues += r.issues.length;
  }

  const paramCov = totalStats.totalParams > 0 ? totalStats.typedParams / totalStats.totalParams * 100 : 100;
  const retCov = totalStats.totalFunctions > 0 ? totalStats.typedFunctions / totalStats.totalFunctions * 100 : 100;
  const anyTotal = totalStats.anyCount + totalStats.asAnyCount + totalStats.implicitAny + totalStats.untypedVars;
  const overall = totalStats.linesOfCode > 0 ? Math.max(0, 100 - anyTotal / totalStats.linesOfCode * 100) : 100;

  const summary = {
    totalFiles: files.length,
    totalIssues,
    totalStats,
    coverage: {
      params: Math.round(paramCov * 100) / 100,
      returns: Math.round(retCov * 100) / 100,
      overall: Math.round(overall * 100) / 100,
    },
    grade: grade(overall),
  };

  return { files: results, summary };
}

function bar(pct) {
  const filled = Math.round(pct / 10);
  return '[' + '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, 10 - filled)) + ']';
}

function gradeBadge(g) {
  const colors = { A: '🟢', B: '🟡', C: '🟠', D: '🔴', F: '💀' };
  return `${colors[g] || '⚪'} ${g}`;
}

function formatReport(result) {
  const { files, summary } = result;
  const lines = [];
  lines.push('');
  lines.push('  ╔══════════════════════════════════════╗');
  lines.push('  ║        TypeCover Analysis            ║');
  lines.push('  ╚══════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Files scanned:    ${summary.totalFiles}`);
  lines.push(`  Issues found:     ${summary.totalIssues}`);
  lines.push(`  Lines of code:    ${summary.totalStats.linesOfCode}`);
  lines.push('');
  lines.push('  Coverage');
  lines.push('  ────────');
  lines.push(`  Parameters:   ${bar(summary.coverage.params)} ${summary.coverage.params}%`);
  lines.push(`  Return types: ${bar(summary.coverage.returns)} ${summary.coverage.returns}%`);
  lines.push(`  Overall:      ${bar(summary.coverage.overall)} ${summary.coverage.overall}%`);
  lines.push('');
  lines.push(`  Grade: ${gradeBadge(summary.grade)}`);
  lines.push('');

  if (summary.totalStats.anyCount > 0 || summary.totalStats.asAnyCount > 0) {
    lines.push(`  ⚠ any types:      ${summary.totalStats.anyCount} explicit, ${summary.totalStats.asAnyCount} 'as any' casts`);
  }
  if (summary.totalStats.implicitAny > 0) {
    lines.push(`  ⚠ Untyped params: ${summary.totalStats.implicitAny}`);
  }
  if (summary.totalStats.untypedVars > 0) {
    lines.push(`  ℹ Untyped vars:   ${summary.totalStats.untypedVars}`);
  }
  if (summary.totalIssues > 0) {
    lines.push('');
    lines.push('  Issues by file');
    lines.push('  ──────────────');
    for (const f of files) {
      if (f.issues.length === 0) continue;
      lines.push('');
      lines.push(`  ${f.filePath} (${f.issues.length} issues)`);
      for (const issue of f.issues.slice(0, 20)) {
        const icon = issue.severity === 'error' ? '✖' : issue.severity === 'warning' ? '⚠' : 'ℹ';
        lines.push(`    ${icon} L${issue.line}: ${issue.message}`);
      }
      if (f.issues.length > 20) lines.push(`    ... and ${f.issues.length - 20} more`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = { analyze, analyzeFile, grade, formatReport };
