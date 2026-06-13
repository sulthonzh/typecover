#!/usr/bin/env node
'use strict';

const { analyze, formatReport } = require('./index.js');
const path = require('path');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
typecover — Measure TypeScript type coverage

Usage:
  typecover [dir] [options]

Options:
  --json           Output as JSON
  --min-severity   Minimum severity to report (error|warning|info) [default: info]
  --ignore <str>   Comma-separated patterns to ignore in dir names
  -h, --help       Show this help

Examples:
  typecover ./src
  typecover ./src --min-severity error --json
`);
  process.exit(0);
}

const dir = args.find(a => !a.startsWith('--')) || '.';
const jsonOutput = args.includes('--json');
const minSevIdx = args.indexOf('--min-severity');
const minSeverity = minSevIdx !== -1 ? args[minSevIdx + 1] : 'info';
const ignoreIdx = args.indexOf('--ignore');
const ignore = ignoreIdx !== -1 ? (args[ignoreIdx + 1] || '').split(',').filter(Boolean) : [];

const absDir = path.resolve(dir);
const result = analyze(absDir, { ignore, minSeverity });

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatReport(result));
}

if (result.summary.grade === 'F' || result.summary.grade === 'D') {
  process.exit(1);
}
