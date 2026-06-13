#!/usr/bin/env node
'use strict';

const { analyze, formatReport, checkCI } = require('./index.js');
const path = require('path');

const args = process.argv.slice(2);
let target = '.';
let threshold = 80;
let verbose = true;
let showFindings = false;
let jsonOutput = false;
let patterns = null;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--threshold':
    case '-t':
      threshold = parseFloat(args[++i]) || 80;
      break;
    case '--json':
    case '-j':
      jsonOutput = true;
      break;
    case '--quiet':
    case '-q':
      verbose = false;
      break;
    case '--findings':
    case '-f':
      showFindings = true;
      break;
    case '--patterns':
    case '-p':
      patterns = args[++i].split(',');
      break;
    case '--help':
    case '-h':
      console.log(`
  typecover — TypeScript Type Coverage Analyzer

  Usage:
    typecover [path] [options]

  Options:
    -t, --threshold <n>   CI threshold percentage (default: 80)
    -q, --quiet           Hide per-file breakdown
    -f, --findings        Show individual findings
    -j, --json            JSON output
    -p, --patterns <ids>  Only check specific patterns (comma-separated)
    -h, --help            Show this help

  Patterns:
    any-keyword, any-array, any-return, as-cast, angle-bracket-cast,
    ts-ignore, ts-expect-error, ts-nocheck, non-null-assertion, force-unwraps

  Examples:
    typecover src/
    typecover . --threshold 95 --findings
    typecover src/ --patterns any-keyword,ts-ignore --json
`);
      process.exit(0);
    default:
      if (!args[i].startsWith('-')) target = args[i];
  }
}

const result = analyze(path.resolve(target), { patterns });

if (result.error) {
  console.error(`Error: ${result.error}`);
  process.exit(1);
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatReport(result, { verbose, showFindings }));
}

const passed = checkCI(result, threshold);
if (!passed) {
  if (!jsonOutput) {
    console.log(`\n  ❌ Coverage ${result.summary.coverage}% is below threshold ${threshold}%\n`);
  }
}

process.exit(passed ? 0 : 1);
