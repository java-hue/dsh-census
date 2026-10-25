import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { Inventory } from './inventory.js'
import { isBuiltinSpecifier, isOfficialSpecifier } from './inventory.js'

export interface CompatRow {
  moduleName: string
  /** Declared dsh-target from the module's package.json, when readable. */
  declaredTarget: string | null
  status: 'ok' | 'unverifiable' | 'mismatch' | 'no-declaration'
  note: string
}

export interface CompatReport {
  /** Running harness version, when resolvable from the plugin's location. */
  harnessVersion: string | null
  rows: CompatRow[]
}

/**
 * Version audit. The harness version resolves from this package's own
 * location: bundle plugins install inside the dsh dependency closure, so
 * `@deepseek-ai/dsh/package.json` is reachable from there. Anything that
 * cannot resolve reports `unverifiable` — never a false all-clear.
 */
export function checkCompat(inventory: Inventory): CompatReport {
  const harnessVersion = readHarnessVersion()
  const rows: CompatRow[] = []

  const moduleNames = new Set(
    inventory.entries
      .map((entry) => entry.moduleName)
      .filter((name) => !isBuiltinSpecifier(name) && !isOfficialSpecifier(name)),
  )

  for (const moduleName of moduleNames) {
    const manifest = readPackageManifest(moduleName)
    if (!manifest) {
      rows.push({
        moduleName,
        declaredTarget: null,
        status: 'unverifiable',
        note: 'package.json not resolvable from this process (link:, git:, or non-npm specifier)',
      })
      continue
    }
    const declared = extractDshTarget(manifest)
    if (!declared) {
      rows.push({
        moduleName,
        declaredTarget: null,
        status: 'no-declaration',
        note: 'no @deepseek-ai/dsh* range in peerDependencies — cannot assert compatibility',
      })
      continue
    }
    if (harnessVersion && declared === harnessVersion) {
      rows.push({ moduleName, declaredTarget: declared, status: 'ok', note: 'declares exactly the running version' })
    } else if (harnessVersion) {
      rows.push({
        moduleName,
        declaredTarget: declared,
        status: 'mismatch',
        note: `declares ${declared}, harness runs ${harnessVersion} — preview cycle breaks plugins that look green`,
      })
    } else {
      rows.push({
        moduleName,
        declaredTarget: declared,
        status: 'unverifiable',
        note: 'running harness version unknown in this process',
      })
    }
  }

  return { harnessVersion, rows }
}

function readHarnessVersion(): string | null {
  const require = createRequire(import.meta.url)
  const manifestPath = resolveManifestPath(require, '@deepseek-ai/dsh')
  if (!manifestPath) return null
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string }
    return manifest.version ?? null
  } catch {
    return null
  }
}

function resolveManifestPath(require: NodeRequire, name: string): string | null {
  try {
    return require.resolve(`${name}/package.json`)
  } catch {
    try {
      const main = require.resolve(name)
      const candidates = main.replaceAll('\\', '/').split('/')
      const nodeModulesIndex = candidates.lastIndexOf('node_modules')
      if (nodeModulesIndex > 0) {
        const scopeOffset = candidates[nodeModulesIndex + 1]?.startsWith('@') ? 1 : 0
        const packageDir = candidates.slice(0, nodeModulesIndex + 2 + scopeOffset).join('/')
        return `${packageDir}/package.json`
      }
    } catch {
      // Not resolvable from this process.
    }
    return null
  }
}

function readPackageManifest(moduleName: string): Record<string, unknown> | null {
  try {
    const require = createRequire(import.meta.url)
    const path = require.resolve(`${moduleName}/package.json`)
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractDshTarget(manifest: Record<string, unknown>): string | null {
  const peers = manifest.peerDependencies as Record<string, string> | undefined
  if (!peers) return null
  for (const [key, value] of Object.entries(peers)) {
    if (key === '@deepseek-ai/dsh' || key.startsWith('@deepseek-ai/dsh-')) return value
  }
  return null
}
