import type { Context } from '@deepseek-ai/cordis'
import type { Inventory } from './inventory.js'

export type Severity = 'error' | 'warning' | 'info'

export interface Finding {
  severity: Severity
  /** Stable machine code, e.g. `loader.entry-failed`. */
  code: string
  message: string
}

export interface PatchRowRef {
  file: string
  op: string
  id: string
  name?: string
}

/**
 * Deterministic checks over the live census:
 * - loader entries whose fiber failed (the plugin will never come up);
 * - loader entries pinned by a relative specifier (repository plugins require
 *   absolute paths — a documented loader pitfall);
 * - system-prompt section names that survived the merge more than once.
 */
export function collectFindings(inventory: Inventory, sectionNames: string[]): Finding[] {
  const findings: Finding[] = []

  for (const entry of inventory.entries) {
    if (entry.phase === 'failed') {
      findings.push({
        severity: 'error',
        code: 'loader.entry-failed',
        message: `Plugin entry "${entry.entryId}" (module ${entry.moduleName}) is in FAILED state — it will not serve any capability.`,
      })
    }
    if (!entry.enabled) {
      findings.push({
        severity: 'info',
        code: 'loader.entry-disabled',
        message: `Plugin entry "${entry.entryId}" (${entry.moduleName}) is disabled.`,
      })
    }
    if (!isAbsoluteLikeSpecifier(entry.moduleName)) {
      findings.push({
        severity: 'warning',
        code: 'loader.relative-specifier',
        message: `Plugin entry "${entry.entryId}" uses a relative specifier "${entry.moduleName}". Repository-plugin patches require absolute paths; relative paths fail to resolve.`,
      })
    }
  }

  const seen = new Map<string, number>()
  for (const name of sectionNames) {
    seen.set(name, (seen.get(name) ?? 0) + 1)
  }
  for (const [name, count] of seen) {
    if (count > 1) {
      findings.push({
        severity: 'warning',
        code: 'system-prompt.duplicate-section',
        message: `System-prompt section "${name}" appears ${count}x in one assembly — a shadowing layer may be stacking text instead of replacing it.`,
      })
    }
  }

  if (!inventory.hasLoader) {
    findings.push({
      severity: 'warning',
      code: 'census.no-loader',
      message: 'ctx.loader is not available; inventory is empty and structural findings are incomplete.',
    })
  }

  return findings
}

function isAbsoluteLikeSpecifier(specifier: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(specifier)) return true // Windows drive path
  if (specifier.startsWith('/') || specifier.startsWith('file:')) return true
  if (specifier.startsWith('link:')) return true
  if (specifier.startsWith('github:') || specifier.startsWith('git+')) return true
  if (!specifier.startsWith('.')) return true // bare package name / cordis: builtin
  return false
}

/**
 * Audit patch files for rows addressed by more than one layer. Patches replace
 * a row's whole `config` (last write wins), so an override chain is a common
 * source of silent misconfiguration.
 */
export function auditPatchOverrides(groups: PatchRowRef[][]): Finding[] {
  const findings: Finding[] = []
  const byId = new Map<string, PatchRowRef[]>()
  for (const group of groups) {
    for (const ref of group) {
      const list = byId.get(ref.id) ?? []
      list.push(ref)
      byId.set(ref.id, list)
    }
  }
  for (const [id, refs] of byId) {
    if (refs.length > 1) {
      const chain = refs.map((r) => `${r.op}@${r.file}`).join(' → ')
      findings.push({
        severity: 'warning',
        code: 'patch.override-chain',
        message: `Patch row "${id}" is addressed by ${refs.length} layers (${chain}); the last layer replaces the row's whole config.`,
      })
    }
  }
  return findings
}
