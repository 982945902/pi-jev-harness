import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent'

const GUIDANCE = [
	'When the next step is to read two or more already-known independent file paths or ranges, use one `eval` call with the Jev Harness `read_many` shortcut.',
	'Send these arguments, replacing only the example paths:',
	`\`${JSON.stringify({ language: 'js', code: 'read_many(["src/a.ts:1-30","src/b.ts:12-20:raw"])' })}\``,
	'Put the bare `read_many([...])` expression in the entire `code` field. Jev Harness expands it before JavaScript runs and prints the results automatically.',
	'Use native `read` for a single path or when a prior result determines the next path.',
	'Choose targeted line ranges. For broad scans, use `read_many({"paths":["a.ts","b.ts"],"maxCharsPerPath":4000})` for previews and follow up on useful ranges.'
].join('\n')

function batchCode(paths: readonly string[], maxChars?: number): string {
	const preview =
		maxChars === undefined
			? ''
			: `
		if (result.status === 'fulfilled' && !result.value?.hasError && typeof text === 'string' && text.length > ${maxChars}) {
			const end = text.lastIndexOf('\\n', ${maxChars} - 1) + 1 || ${maxChars};
			text = text.slice(0, end) + '\\n[read_many preview: ' + (text.length - end) + ' characters omitted. Read a narrower range for more.]';
		}`
	return `{
	const paths = ${JSON.stringify(paths)};
	const results = await Promise.allSettled(paths.map(path => tool.read({ path })));
	for (const [index, result] of results.entries()) {
		let text = result.status === 'rejected'
			? String(result.reason)
			: typeof result.value === 'string' ? result.value : result.value?.text;${preview}
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
		let inputArgs: unknown
		try {
			inputArgs = JSON.parse(args)
		} catch {
			return {
				block: true,
				reason: 'read_many expects JSON path strings or a preview options object.'
			}
		}
		const options =
			inputArgs && typeof inputArgs === 'object' && !Array.isArray(inputArgs)
				? inputArgs
				: undefined
		const paths = options && 'paths' in options ? options.paths : inputArgs
		const maxChars = options && 'maxCharsPerPath' in options ? options.maxCharsPerPath : undefined
		if (
			options &&
			(typeof maxChars !== 'number' || !Number.isSafeInteger(maxChars) || maxChars < 1)
		) {
			return {
				block: true,
				reason: 'read_many preview requires a positive integer maxCharsPerPath.'
			}
		}
		if (
			!Array.isArray(paths) ||
			!paths.length ||
			!paths.every((path: unknown) => typeof path === 'string' && path.trim())
		) {
			return { block: true, reason: 'read_many expects at least one non-empty path string.' }
		}
		return {
			input: {
				...input,
				code: batchCode(paths, typeof maxChars === 'number' ? maxChars : undefined)
			}
		}
	})
}
