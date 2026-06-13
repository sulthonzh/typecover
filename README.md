# typecover

Analyze TypeScript codebases for type safety coverage.

Scans your `.ts`/`.tsx` files for unsafe patterns like `any`, type assertions, `@ts-ignore`, non-null assertions, and more. Gives you a coverage percentage and letter grade so you can track type safety over time.

## Why?

TypeScript's compiler tells you about errors, but it doesn't tell you how *safe* your types actually are. A codebase can compile cleanly while being full of `any`, `as` casts, and `@ts-ignore` escapes. `typecover` measures the gap.

## Install

```bash
npm install -g typecover
# or
npx typecover ./src
```

## Usage

```bash
# Analyze current directory
typecover

# Analyze specific path
typecover src/

# Set CI threshold (fails if coverage below 90%)
typecover src/ --threshold 90

# Show individual findings
typecover src/ --findings

# JSON output for tooling
typecover src/ --json

# Only check specific patterns
typecover src/ --patterns any-keyword,ts-ignore

# Quiet mode (summary only)
typecover src/ --quiet
```

## What It Detects

| Pattern | Severity | Description |
|---------|----------|-------------|
| `any-keyword` | High | `const x: any` |
| `any-array` | High | `const x: any[]` |
| `any-return` | High | `function foo(): any` |
| `as-cast` | Medium | `x as string` |
| `angle-bracket-cast` | Medium | `<string>x` |
| `ts-ignore` | High | `// @ts-ignore` |
| `ts-expect-error` | Medium | `// @ts-expect-error` |
| `ts-nocheck` | Critical | `// @ts-nocheck` |
| `non-null-assertion` | Low | `obj!.prop` |
| `force-unwraps` | Low | `arr!` |

## Coverage Grades

| Range | Grade |
|-------|-------|
| 98-100% | A+ |
| 95-97% | A |
| 90-94% | A- |
| 85-89% | B+ |
| 80-84% | B |
| 75-79% | B- |
| 70-74% | C+ |
| 65-69% | C |
| 60-64% | C- |
| 50-59% | D |
| 0-49% | F |

## Programmatic API

```js
const { analyze, formatReport, checkCI } = require('typecover');

const result = analyze('./src');
console.log(formatReport(result, { verbose: true, showFindings: true }));

if (!checkCI(result, 85)) {
  process.exit(1);
}
```

## CI Integration

Add to your CI pipeline:

```yaml
- name: Type coverage check
  run: npx typecover src/ --threshold 90
```

Exit code is 1 if coverage falls below the threshold.

## Zero Dependencies

No external dependencies. Pure Node.js.

## License

MIT
