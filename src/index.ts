import type { Context, Plugin } from '@deepseek-ai/cordis'
import { createCensusTool } from './tool.js'

export const censusPlugin: Plugin.Object = {
  name: 'dsh-census',
  inject: ['tools', 'systemPrompt'],
  apply(ctx: Context) {
    // Registration disposes with the calling fiber (dsh-tools contract).
    ctx.tools.register(createCensusTool(ctx))
  },
}

export default censusPlugin
