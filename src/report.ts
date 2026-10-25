import type { Context } from '@deepseek-ai/cordis'
import { collectInventory, type Inventory, type InventoryEntry } from './inventory.js'
import { auditPatchOverrides, collectFindings, type Finding } from './conflicts.js'
import { estimateCosts, type CostReport } from './cost.js'
import { checkCompat, type CompatReport, type CompatRow } from './compat.js'
import { discoverPatchFiles, readPatchRows } from './patch-audit.js'

export interface CensusReport {
  harnessVersion: string | null
  inventory: {
    hasLoader: boolean
    registryCount: number
    entries: InventoryEntry[]
  }
  findings: Finding[]
  cost: CostReport
  compat: CompatRow[]
  markdown: string
}

export async function buildReport(ctx: Context, options: { verbose?: boolean } = {}): Promise<CensusReport> {
  const inventory: Inventory = collectInventory(ctx)

  let cost: CostReport
  const findings: Finding[] = []
  try {
    cost = await estimateCosts(ctx)
  } catch (error) {
    cost = { rows: [], totalTokens: 0, contextWindow: null, contextWindowSource: 'unavailable' }
    findings.push({
      severity: 'warning',
      code: 'census.assemble-failed',
      message: `System-prompt assembly failed (${error instanceof Error ? error.message : String(error)}); cost figures are empty.`,
    })
  }

  findings.push(...collectFindings(inventory, cost.rows.filter((row) => row.kind === 'section').map((row) => row.name)))
  const patchGroups = discoverPatchFiles().map((file) => readPatchRows(file))
  findings.push(...auditPatchOverrides(patchGroups))

  const compat = checkCompat(inventory)
  for (const row of compat.rows) {
    if (row.status === 'mismatch') {
      findings.push({ severity: 'warning', code: 'compat.version-mismatch', message: `${row.moduleName}: ${row.note}.` })
    }
  }

  const markdown = renderMarkdown(inventory, findings, cost, compat.rows, options.verbose ?? false)
  return {
    harnessVersion: compat.harnessVersion,
    inventory: { hasLoader: inventory.hasLoader, registryCount: inventory.registryCount, entries: inventory.entries },
    findings,
    cost,
    compat: compat.rows,
    markdown,
  }
}

function renderMarkdown(
  inventory: Inventory,
  findings: Finding[],
  cost: CostReport,
  compat: CompatReport['rows'],
  verbose: boolean,
): string {
  const lines: string[] = []
  lines.push('# Plugin census')
  lines.push('')
  const failed = inventory.entries.filter((entry) => entry.phase === 'failed').length
  lines.push(
    `- Loader entries: ${inventory.entries.length} (${failed} failed), registered runtimes: ${inventory.registryCount}`,
  )
  lines.push(
    `- Context suffix cost: ~${cost.totalTokens} est. tokens` +
      (cost.contextWindow ? ` (${((cost.totalTokens / cost.contextWindow) * 100).toFixed(1)}% of ${cost.contextWindow} window)` : ' (context window unknown)'),
  )
  lines.push('')

  if (findings.length > 0) {
    lines.push('## Findings')
    lines.push('')
    for (const finding of findings) {
      lines.push(`- **${finding.severity}** \`${finding.code}\` — ${finding.message}`)
    }
    lines.push('')
  } else {
    lines.push('## Findings')
    lines.push('')
    lines.push('- No conflicts or failed entries detected.')
    lines.push('')
  }

  lines.push('## Context suffix cost (est. 4 chars/token)')
  lines.push('')
  lines.push('| kind | name | est. tokens |')
  lines.push('| --- | --- | --- |')
  for (const row of [...cost.rows].sort((a, b) => b.estTokens - a.estTokens)) {
    lines.push(`| ${row.kind} | ${row.name} | ${row.estTokens} |`)
  }
  if (cost.rows.length === 0) lines.push('| (no assembly available) | | |')
  lines.push('')

  if (verbose) {
    lines.push('## Loader entries')
    lines.push('')
    lines.push('| entry id | module | enabled | phase |')
    lines.push('| --- | --- | --- | --- |')
    for (const entry of inventory.entries) {
      lines.push(`| ${entry.entryId} | ${entry.moduleName} | ${entry.enabled} | ${entry.phase ?? '—'} |`)
    }
    lines.push('')
    lines.push('## Third-party compat')
    lines.push('')
    lines.push('| module | declared dsh target | status |')
    lines.push('| --- | --- | --- |')
    for (const row of compat) {
      lines.push(`| ${row.moduleName} | ${row.declaredTarget ?? '—'} | ${row.status} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

