# dsh-census

Plugin census for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): **what is loaded, what it costs, what collides** — in one read-only tool call.

Community plugins add real capability, but nothing tells you what each one charges against your context window, whether two of them collide, or whether they still declare the harness version they were built against. Census answers those three questions deterministically, without mutating anything.

## Install

```bash
dsh plugin --profile <name> add dsh-census
```

Or from a local checkout (repository-plugin style, absolute path required):

```bash
dsh plugin --profile <name> add link:/absolute/path/to/dsh_plugin
```

## The `census` tool

One tool, one call, no prompt-section overhead. The report contains:

- **Inventory** — every loader entry (id, module specifier, enablement, fiber phase) with the same projection semantics as the official `pluginInventory/list` Remote; failed entries surface as errors, not silence.
- **Findings** — failed entries, relative specifiers (repository plugins require absolute paths), duplicate system-prompt section names in one assembly, patch rows addressed by more than one layer (patches replace a row's whole config — last write wins), and third-party plugins whose declared dsh target does not match the running harness.
- **Context suffix cost** — per-section and per-tool-schema token estimates for one assembly (fixed 4-chars-per-token heuristic), plus the share of the resolved context window when the model route advertises one.

Pass `verbose: true` for per-entry inventory and per-module compat tables.

## Scope and non-goals

- **Read-only** — census never enables, disables, patches, or repairs anything. Recovery flows already exist elsewhere (`dsh-doctor`); census deliberately does not compete with them.
- **Host-side only in 0.1** — client-UI mount-path conflicts live in browser-land and need a client half; not covered yet.
- **Heuristic cost** — the estimator mirrors the official `dsh-token-meter` fixed heuristic (4 chars/token) and inherits its documented weakness: CJK text and JSON schemas underprice badly. Treat every figure as an estimate.

## Model Experience

None. Census registers exactly one tool (`census`) and contributes no sections, contexts, or prompt text of its own. Its output reaches the model only when a call is made.

## KV Cache effect

The tool's own schema is a single short entry. Calling `census` appends one tool result to the session surface; it registers no durable messages and no runtime contexts. The report's purpose is to make **other** plugins' KV-cache cost visible: per-section and per-tool token estimates quantify exactly how much suffix each plugin's prompt contribution adds on every request.

## Development

```bash
npm install
npm run check   # typecheck
npm test        # unit + real-cordis integration tests
npm run build   # emit lib/
npm pack --dry-run
```

The integration test boots a real `@deepseek-ai/cordis` context, loads the official `dsh-system-prompt` and `dsh-tools` plugins, registers census, and executes it through the real tool pipeline.

## License

MIT
