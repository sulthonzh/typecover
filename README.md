# typecover

Measure TypeScript type coverage. Find `any`, untyped params, missing return types, and `@ts-ignore` abuse.

## Why?

TypeScript's compiler only tells you about errors — it doesn't tell you how *well-typed* your code is. A project can compile clean while being riddled with `any`, untyped parameters, and zero return type annotations.

`typecover` scans your `.ts`/`.tsx` files and gives you a coverage score: what percentage of your code actually has proper types.

## Install

```bash
npm install -g typecover
```

Or use without installing:

```bash
npx typecover ./src
```

## Usage

```bash
# Scan a directory
typecover ./src

# JSON output for CI
typecover ./src --json

# Only show errors (no warnings/info)
typecover ./src --min-severity error

# Ignore certain directories
typecover ./src --ignore generated,vendor
```

## What It Detects

| Check | Severity | Description |
|-------|----------|-------------|
| `explicit-any` | error | Direct use of `any` type annotation |
| `as-any` | error | `as any` type casts |
| `untyped-param` | warning | Function parameters without type annotations |
| `ts-ignore` | warning | `@ts-ignore` directives |
| `ts-nocheck` | error | `@ts-nocheck` disabling type checking |
| `missing-return-type` | info | Functions without return type annotations |
| `untyped-var` | info | Variables declared without type or initializer |

## Output

```
  ╔══════════════════════════════════════╗
  ║        TypeCover Analysis            ║
  ╚══════════════════════════════════════╝

  Files scanned:    24
  Issues found:     13
  Lines of code:    892

  Coverage
  ────────
  Parameters:   [██████████] 100%
  Return types: [██████░░░░] 62.5%
  Overall:      [█████████░] 91.2%

  Grade: 🟢 A
```

## Programmatic API

```js
const { analyze, formatReport } = require('typecover');

const result = analyze('./src', {
  ignore: ['generated'],
  minSeverity: 'warning',
});

console.log(formatReport(result));
// or use result.summary, result.files directly
```

## CI Integration

The CLI exits with code 1 if the grade is D or F, making it easy to add to CI:

```yaml
# GitHub Actions
- name: Type coverage check
  run: npx typecover ./src --min-severity error
```

## Grade Scale

| Grade | Score | Meaning |
|-------|-------|---------|
| A | 95-100% | Excellent type coverage |
| B | 85-94% | Good, minor gaps |
| C | 70-84% | Fair, could improve |
| D | 50-69% | Poor, significant `any` usage |
| F | 0-49% | Critical, types mostly missing |

## How It Works

Static regex-based scanning (no TypeScript compiler dependency). Fast, zero-config, works on any `.ts`/`.tsx` project. Skips `.d.ts` declaration files and `node_modules`.

## License

MIT
