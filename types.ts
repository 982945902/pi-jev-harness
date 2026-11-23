import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

import { resolveJevApiKey, type Question, type Result } from './jev.ts'

export type Mode = 'on' | 'log' | 'off' // log = ask Jev and record, change nothing

export type Config = {
	mode: Mode
	route: boolean
	routeStrategy?: 'compact' | 'full'
	prefetch: boolean
	trim: boolean
	loop: boolean
	guard: boolean
	prefetchFiles: number
	prefetchLines: number
	prefetchBudgetMs: number
	delegateBudgetMs: number
	trimMinChars: number
	keepHeadChars: number
	timeoutMs: number
	showStatus: boolean
	apiKey?: string
	baseUrl?: string
	model?: string
	delegateModel?: string
}

export type Stats = {
	jevCalls: number
	jevMs: number
	jevTokens: number
	errors: number
	turns: number
	prefetchSkipped: number
	toolsHidden: number
	prefetched: number
	trimmed: number
	charsSaved: number
	loopsCaught: number
	guardAsked: number
	guardBlocked: number
}

export type RecentCall = { tool: string; key: string; input: unknown }

export type Block = { block: true; reason: string }

export type Candidate = { path: string; matched: { term: string; line: string; at: number }[] }

export type Harness = {
	config: Config
	stats: Stats
	task: string
	allTools: string[] | null
	recent: RecentCall[]
	sent: Set<string>
	loopChecked: boolean
	status: (ctx: ExtensionContext, text?: string) => void
	log: (entry: Record<string, unknown>) => void
	jev: (
		what: string,
		state: unknown,
		questions: Record<string, Question>,
		ctx: { sessionManager: { getSessionId(): string }; signal?: AbortSignal | undefined },
		options?: { signal?: AbortSignal; metrics?: Record<string, number | string> }
	) => Promise<Result | null>
}

export const DELEGATE_TOOL = 'jev_delegate'

export const DISCOVER_TOOL = 'jev_find_tools'

export const THRESHOLD_ALWAYS_KEEP = ['read', DELEGATE_TOOL]

export const READ_TOOLS = ['read', 'grep', 'find', 'ls', DELEGATE_TOOL, DISCOVER_TOOL]

export const active = (h: Harness): boolean =>
	h.config.mode !== 'off' && !!resolveJevApiKey(h.config)

export const short = (value: unknown, max = 300): string => {
	const text = typeof value === 'string' ? value : JSON.stringify(value)
	return text.length > max ? `${text.slice(0, max)}…` : text
}
