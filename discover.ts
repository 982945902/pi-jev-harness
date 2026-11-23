import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent'

import { noul } from './jev.ts'
import { active, DISCOVER_TOOL, short, type Harness } from './types.ts'

const LIMIT = 12

function words(text: string): string[] {
	return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

export function registerToolDiscovery(pi: ExtensionAPI, h: Harness): void {
	pi.registerTool({
		name: DISCOVER_TOOL,
		label: 'Find tools',
		description:
			'Find enabled specialist tools for an operation when the available tool or MCP service is unclear. Include the service name if known and describe the action.',
		loadMode: 'essential',
		approval: 'read',
		parameters: pi.zod.object({ query: pi.zod.string().trim().min(1).max(300) }),
		async execute(_id, { query }, signal, _onUpdate, ctx) {
			const terms = new Set(words(query).filter((term) => term.length > 1))
			const enabled = new Set(pi.getActiveTools())
			const candidates = pi.getAllTools().flatMap((tool) => {
				if (tool.name === DISCOVER_TOOL || !enabled.has(tool.name)) return []
				const name = new Set(words(`${tool.name} ${tool.mcpServerName ?? ''}`))
				const description = new Set(words(tool.description))
				let score = 0
				for (const term of terms) score += name.has(term) ? 3 : Number(description.has(term))
				return score ? [{ name: tool.name, description: short(tool.description, 200), score }] : []
			})
			candidates.sort((a, b) => b.score - a.score)
			const tools = candidates
				.slice(0, LIMIT)
				.map(({ name, description }) => ({ name, description }))
			const questions = Object.fromEntries(
				tools.map(({ name }) => [
					name,
					noul(`Does the ${name} tool match the requested operation?`)
				])
			)
			const result =
				tools.length > 1 && active(h)
					? await h.jev('tool_search', { query, tools }, questions, ctx, signal ? { signal } : {})
					: null
			const ranked = tools.map((tool) => {
				const answer = result?.answers[tool.name]
				return { ...tool, relevance: answer?.type === 'noul' ? answer.noul : 0 }
			})
			ranked.sort((a, b) => b.relevance - a.relevance)
			const text = ranked
				.slice(0, 5)
				.map((tool) => `${tool.name}: ${tool.description}`)
				.join('\n')
			return {
				content: [
					{
						type: 'text',
						text:
							text || 'No matching enabled tools. Try the service name or a more specific action.'
					}
				]
			}
		}
	})
}
