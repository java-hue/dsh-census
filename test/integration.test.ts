import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import censusPlugin from '../src/index.js'

describe('census integration (real cordis + official plugins)', () => {
  it('registers the census tool and executes a full report', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(censusPlugin)

    const schemas = ctx.tools.schemas()
    expect(schemas.some((schema) => schema.name === 'census')).toBe(true)

    const result = await ctx.tools.execute({
      callId: CallId('test-census-1'),
      name: 'census',
      arguments: { verbose: true },
      signal: new AbortController().signal,
    })

    const text = result.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(result.isError).toBe(false)
    expect(text).toContain('# Plugin census')
    expect(text).toContain('est. tokens')
  })
})
