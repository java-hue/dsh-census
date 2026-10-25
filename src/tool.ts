import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { buildReport } from './report.js'

/**
 * One tool, one call: the census is read-only and independent per invocation
 * (no shared state), so concurrent calls are safe.
 */
export function createCensusTool(ctx: Context) {
  return defineTool({
    name: 'census',
    description:
      'Take a read-only census of this DeepSeek Harness profile: which plugin entries are loaded and which failed, ' +
      'estimated KV-cache cost of every system-prompt section and tool schema (4 chars/token, labeled estimates), ' +
      'conflict findings (failed entries, relative specifiers, duplicate prompt sections, patch override chains), ' +
      'and third-party plugin compat declarations vs the running harness version.',
    parameters: {
      verbose: {
        type: 'boolean',
        description: 'Include per-entry inventory detail and per-module compat tables (default: summary only).',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        const report = value as { markdown?: string }
        const blocks: ContentBlock[] = [{ type: 'text', text: report.markdown ?? JSON.stringify(value, null, 2) }]
        return blocks
      },
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const verbose = Boolean(args?.verbose)
      const report = await buildReport(ctx, { verbose })
      return report as unknown as Record<string, JsonValue>
    },
  })
}
