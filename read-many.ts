import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent'

const GUIDANCE = [
	'When the next step is to read two or more already-known independent file paths or ranges, use one `eval` call with the Jev Harness `read_many` shortcut.',
	'Send these arguments, replacing only the example paths:',
	`\`${JSON.stringify({ language: 'js', code: 'read_many(["src/a.ts:1-30","src/b.ts:12-20:raw"])' })}\``,
	'Put the bare `read_many([...])` expression in the entire `code` field. Jev Harness expands it before JavaScript runs and prints the results automatically.',
	'Use native `read` for a single path or when a prior result determines the next path.'
].join('\n')

function batchCode(paths: readonly string[]): string {
	return `{
	const paths = ${JSON.stringify(paths)};
	const results = await Promise.allSettled(paths.map(path => tool.read({ path })));
	for (const [index, result] of results.entries()) {
		const text = result.status === 'rejected'
			? String(result.reason)
			: typeof result.value === 'string' ? result.value : result.value.text;
		print(JSON.stringify(paths[index]) + '\\n' + text);
	}
}`
}

export function registerReadMany(pi: ExtensionAPI, enabled: () => boolean): void {
	pi.on('before_agent_start', ({ systemPrompt }) => {
		if (!enabled()) return undefined
		const tools = pi.getActiveTools()
		if (!tools.includes('eval') || !tools.includes('read')) return undefined
		return { systemPrompt: [...systemPrompt, GUIDANCE] }
	})

	pi.on('tool_call', ({ toolName, input }) => {
		if (toolName !== 'eval' || input.language !== 'js' || !enabled()) return undefined
		if (typeof input.code !== 'string') return undefined
		const args = /^\s*read_many\s*\(([\s\S]*)\)\s*;?\s*$/.exec(input.code)?.[1]
		if (args === undefined) return undefined
		let paths: unknown
		try {
			paths = JSON.parse(args)
		} catch {
			return { block: true, reason: 'read_many expects a JSON array of path strings.' }
		}
		if (
			!Array.isArray(paths) ||
			!paths.length ||
			!paths.every((path: unknown) => typeof path === 'string' && path.trim())
		) {
			return { block: true, reason: 'read_many expects at least one non-empty path string.' }
		}
		return { input: { ...input, code: batchCode(paths) } }
	})
}
