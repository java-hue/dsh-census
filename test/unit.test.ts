import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { auditPatchOverrides, collectFindings, type PatchRowRef } from '../src/conflicts.js'
import { readPatchRows, discoverPatchFiles } from '../src/patch-audit.js'
import { estimateCosts } from '../src/cost.js'
import { checkCompat } from '../src/compat.js'
import { buildReport } from '../src/report.js'

describe('auditPatchOverrides', () => {
  it('warns when a row id is addressed by more than one layer', () => {
    const groups: PatchRowRef[][] = [
      [{ file: 'base.patch.yml', op: 'insert', id: 'llm', name: '@deepseek-ai/dsh-llm' }],
      [
        { file: 'user.patch.yml', op: 'update', id: 'llm', name: '@deepseek-ai/dsh-llm' },
        { file: 'user.patch.yml', op: 'insert', id: 'other', name: 'x' },
      ],
    ]
    const findings = auditPatchOverrides(groups)
    expect(findings).toHaveLength(1)
    expect(findings[0]!).toMatchObject({ severity: 'warning', code: 'patch.override-chain' })
    expect(findings[0]!.message).toContain('base.patch.yml')
    expect(findings[0]!.message).toContain('user.patch.yml')
  })

  it('is silent for unique ids', () => {
    const findings = auditPatchOverrides([[{ file: 'a.yml', op: 'insert', id: 'x' }]])
    expect(findings).toHaveLength(0)
  })
})

describe('collectFindings', () => {
  it('flags failed entries, relative specifiers, and duplicate sections', () => {
    const findings = collectFindings(
      {
        hasLoader: true,
        registryCount: 3,
        entries: [
          { entryId: 'broken', moduleName: './relative-plugin', enabled: true, phase: 'failed' },
          { entryId: 'off', moduleName: 'some-plugin', enabled: false, phase: null },
          { entryId: 'ok', moduleName: '@deepseek-ai/dsh-llm', enabled: true, phase: 'active' },
        ],
      },
      ['persona', 'persona'],
    )
    const codes = findings.map((f) => f.code)
    expect(codes).toContain('loader.entry-failed')
    expect(codes).toContain('loader.relative-specifier')
    expect(codes).toContain('loader.entry-disabled')
    expect(codes).toContain('system-prompt.duplicate-section')
  })

  it('warns when the loader is absent', () => {
    const findings = collectFindings({ hasLoader: false, registryCount: 0, entries: [] }, [])
    expect(findings.some((f) => f.code === 'census.no-loader')).toBe(true)
  })
})

describe('readPatchRows / discoverPatchFiles', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-census-test-'))
  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('extracts rows from insert and update operations', () => {
    const file = join(home, 'cordis.patch.yml')
    writeFileSync(
      file,
      [
        '- insert:',
        '    - id: census',
        '      name: dsh-census',
        '    - id: tools',
        '      name: "@deepseek-ai/dsh-tools"',
        '      config:',
        '        mode: native',
        '- update:',
        '    - id: census',
        '      config:',
        '        disabled: true',
        '',
      ].join('\n'),
    )
    const rows = readPatchRows(file)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.id)).toEqual(['census', 'tools', 'census'])
    expect(rows[0]).toMatchObject({ op: 'insert', name: 'dsh-census' })
  })

  it('discovers home-level patch files via DSH_HOME', () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const files = discoverPatchFiles()
      expect(files.some((f) => f.endsWith('cordis.patch.yml'))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})

describe('estimateCosts', () => {
  it('prices sections and tool schemas with the 4-chars-per-token heuristic', async () => {
    const fakeCtx = {
      systemPrompt: {
        assemble: async () => ({
          sections: [
            { name: 'identity', order: -100, text: 'x'.repeat(40) },
            { name: 'persona', order: 0, text: 'y'.repeat(8) },
          ],
          tools: [{ name: 'census', description: 'd'.repeat(16), parameters: { type: 'object' } }],
          variables: {},
        }),
      },
    } as unknown as Context

    const report = await estimateCosts(fakeCtx)
    const byName = Object.fromEntries(report.rows.map((r) => [r.name, r.estTokens]))
    expect(byName['identity']).toBe(10)
    expect(byName['persona']).toBe(2)
    expect(report.totalTokens).toBe(10 + 2 + report.rows.find((r) => r.name === 'census')!.estTokens)
    expect(report.contextWindow).toBeNull()
  })
})

describe('checkCompat', () => {
  it('reports unverifiable for non-npm specifiers and no-declaration without peers', () => {
    const report = checkCompat({
      hasLoader: true,
      registryCount: 0,
      entries: [
        { entryId: 'git', moduleName: 'github:owner/repo#abc123', enabled: true, phase: 'active' },
        { entryId: 'plain', moduleName: 'js-yaml', enabled: true, phase: 'active' },
      ],
    })
    expect(report.harnessVersion).toBeNull()
    expect(report.rows.map((r) => r.status)).toEqual(['unverifiable', 'no-declaration'])
  })
})

describe('buildReport', () => {
  it('degrades gracefully when the loader is missing and renders markdown', async () => {
    const fakeCtx = {
      systemPrompt: {
        assemble: async () => ({ sections: [{ name: 'identity', order: -100, text: 'hello world!' }], tools: [], variables: {} }),
      },
    } as unknown as Context

    const report = await buildReport(fakeCtx, { verbose: true })
    expect(report.findings.some((f) => f.code === 'census.no-loader')).toBe(true)
    expect(report.cost.rows.find((r) => r.name === 'identity')?.estTokens).toBe(3)
    expect(report.markdown).toContain('# Plugin census')
    expect(report.markdown).toContain('est. tokens')
  })
})
