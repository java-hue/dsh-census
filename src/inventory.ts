import type { Context } from '@deepseek-ai/cordis'

/**
 * One loader-tree plugin entry, projected with the same semantics as
 * `@deepseek-ai/dsh-host-plugin-inventory` (entryId / moduleName / enabled /
 * fiberPhase). DISPOSED fibers project to `null`, matching the official map.
 */
export interface InventoryEntry {
  entryId: string
  moduleName: string
  enabled: boolean
  phase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
}

/** Runtime mirror of the Cordis FiberState const enum (see dsh-host-plugin-inventory). */
const FIBER_PHASE: Record<number, InventoryEntry['phase']> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

export interface Inventory {
  entries: InventoryEntry[]
  /** Number of registered plugin runtimes in the Cordis registry. */
  registryCount: number
  /** True when `ctx.loader` was available (it always is inside dsh profiles). */
  hasLoader: boolean
}

/**
 * Enumerate the live loader tree and registry size. Read-only: loader entries
 * are the lifecycle authority and this touches nothing.
 */
export function collectInventory(ctx: Context): Inventory {
  const entries: InventoryEntry[] = []
  // Opportunistic ctx.get(): returns undefined when the service is absent,
  // so the census stays loadable in loader-less processes (e.g. bare tests).
  const probe = ctx as unknown as {
    get?: (name: string) => unknown
    registry?: { size?: number }
  }
  const loader = probe.get?.('loader') as
    | { entries?: () => Iterable<{ id: string; options: { name: string }; disabled?: boolean; fiber?: { state: number } | undefined }> }
    | undefined
  if (loader?.entries) {
    for (const entry of loader.entries()) {
      const phase = entry.fiber == null ? null : FIBER_PHASE[entry.fiber.state] ?? null
      entries.push({
        entryId: entry.id,
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        phase,
      })
    }
  }
  let registryCount = 0
  try {
    registryCount = probe.registry?.size ?? 0
  } catch {
    // Property access can be inject-gated; the count stays 0.
  }
  return {
    entries,
    registryCount,
    hasLoader: Boolean(loader?.entries),
  }
}

/** Module specifiers that are loader built-ins, not real external packages. */
export function isBuiltinSpecifier(name: string): boolean {
  return name.startsWith('cordis:')
}

/** Specifiers shipped and maintained inside the dsh production closure. */
export function isOfficialSpecifier(name: string): boolean {
  return name.startsWith('@deepseek-ai/')
}
