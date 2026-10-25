import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { load } from 'js-yaml'
import type { PatchRowRef } from './conflicts.js'

/**
 * Discover patch layers we can audit from this process: the home-level
 * `cordis.yml` / `cordis.patch.yml` plus one level of subdirectory patches.
 * Profile-internal layers are intentionally out of scope for 0.1.
 */
export function discoverPatchFiles(): string[] {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  if (!existsSync(home)) return []
  const files: string[] = []
  for (const name of ['cordis.yml', 'cordis.patch.yml']) {
    const candidate = join(home, name)
    if (existsSync(candidate)) files.push(candidate)
  }
  try {
    for (const child of readdirSync(home, { withFileTypes: true })) {
      if (!child.isDirectory()) continue
      const candidate = join(home, child.name, 'cordis.patch.yml')
      if (existsSync(candidate)) files.push(candidate)
    }
  } catch {
    // An unreadable home directory yields no extra files.
  }
  return files
}

/**
 * Extract every row that carries a string `id` from a patch file. The patch
 * operation vocabulary (insert/update/remove/...) is intentionally open: any
 * array-valued key is scanned, because unknown ops still address rows by id.
 */
export function readPatchRows(file: string): PatchRowRef[] {
  let doc: unknown
  try {
    doc = load(readFileSync(file, 'utf8'))
  } catch {
    return []
  }  const refs: PatchRowRef[] = []
  if (!Array.isArray(doc)) return refs
  const label = basename(file)
  for (const opGroup of doc) {
    if (opGroup == null || typeof opGroup !== 'object') continue
    for (const [op, rows] of Object.entries(opGroup as Record<string, unknown>)) {
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        if (row == null || typeof row !== 'object') continue
        const id = (row as Record<string, unknown>).id
        if (typeof id !== 'string') continue
        const name = (row as Record<string, unknown>).name
        refs.push({ file: label, op, id, name: typeof name === 'string' ? name : undefined })
      }
    }
  }
  return refs
}

