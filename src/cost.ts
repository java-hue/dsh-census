import type { Context } from '@deepseek-ai/cordis'

export interface CostRow {
  kind: 'section' | 'tool'
  name: string
  chars: number
  estTokens: number
}

export interface CostReport {
  rows: CostRow[]
  totalTokens: number
  /** Provider-advertised context window for the current model route, when resolvable. */
  contextWindow: number | null
  contextWindowSource: 'llm.resolveModelInfo' | 'unavailable'
}

/**
 * Estimate the model-visible suffix cost contributed by the system-prompt
 * assembly and the tool catalog.
 *
 * Estimator mirrors the official fixed heuristic of `@deepseek-ai/dsh-token-meter`
 * (four characters per token). Their docs note CJK text and JSON schemas
 * underprice badly under this rule, so figures are labeled estimates.
 */
export async function estimateCosts(ctx: Context): Promise<CostReport> {
  const rows: CostRow[] = []

  const systemPrompt = ctx.systemPrompt
  if (systemPrompt) {
    // Read-only assembly for one caller: providers must tolerate a bare,
    // scope-less AssembleContext (documented contract of dsh-system-prompt).
    const assembly = await systemPrompt.assemble()
    for (const section of assembly.sections) {
      pushRow(rows, 'section', section.name, section.text.length)
    }
    for (const tool of assembly.tools) {
      pushRow(rows, 'tool', tool.name, stableJsonSize(tool))
    }
  }

  let contextWindow: number | null = null
  let contextWindowSource: CostReport['contextWindowSource'] = 'unavailable'
  try {
    // Opportunistic: neither service is in the inject list, so resolve both
    // defensively. resolveModelInfo is async and takes the exact route —
    // calling it bare (no args, no await) rejects unhandled and kills the
    // process, which is exactly the failure the first real-harness run hit.
    const probe = ctx as unknown as { get?: (name: string) => unknown }
    const agentDefaultModel = probe.get?.('agentDefaultModel') as
      | { currentSelection?: () => { provider?: string; model?: string } | undefined }
      | undefined
    const llm = probe.get?.('llm') as
      | { resolveModelInfo?: (provider: string, model: string, signal?: AbortSignal) => Promise<{ context?: number } | undefined> }
      | undefined
    if (
      typeof agentDefaultModel?.currentSelection === 'function' &&
      typeof llm?.resolveModelInfo === 'function'
    ) {
      const selection = agentDefaultModel.currentSelection()
      if (selection?.provider && selection?.model) {
        const info = await llm.resolveModelInfo(selection.provider, selection.model, AbortSignal.timeout(5000))
        const context = info?.context
        if (typeof context === 'number' && context > 0) {
          contextWindow = context
          contextWindowSource = 'llm.resolveModelInfo'
        }
      }
    }
  } catch {
    // No route, no credentials, or adapter lookup failed — the window stays unknown.
  }

  const totalTokens = rows.reduce((sum, row) => sum + row.estTokens, 0)
  return { rows, totalTokens, contextWindow, contextWindowSource }
}

function pushRow(rows: CostRow[], kind: CostRow['kind'], name: string, chars: number) {
  rows.push({ kind, name, chars, estTokens: Math.ceil(chars / 4) })
}

/**
 * Stable projection size for one tool schema: exactly the fields the registry
 * whitelists as model-visible (name / description / parameters).
 */
function stableJsonSize(tool: { name: string; description?: string; parameters?: unknown }): number {
  return JSON.stringify({ name: tool.name, description: tool.description ?? '', parameters: tool.parameters ?? {} }).length
}
