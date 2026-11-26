export const NEO_RUN = 'mcp__browseros_neo_run'

export type FollowInput = {
	goal: string
	url: string
	observe: string
	maxClicks: number
}

export function followCode(
	{ goal, url, observe, maxClicks }: FollowInput,
	judgeTool: string
): string {
	return `{
	const goal = ${JSON.stringify(goal)};
	const url = ${JSON.stringify(url)};
	const observe = ${JSON.stringify(observe)};
	const maxClicks = ${maxClicks};
	const steps = [];
	const evidence = [];
	const started = performance.now();
	let pageId, session, click, previous, status, reason;
	const run = async (name, args) => {
		const start = performance.now();
		const result = await tool[name](args);
		return {result, ms: Math.round(performance.now() - start)};
	};
	const neo = async (code) => {
		const {result, ms} = await run(${JSON.stringify(NEO_RUN)}, {code, ...(session ? {session} : {}), timeout: 18000});
		const out = result?.details?.structuredContent;
		session = out?.session ?? session;
		if (!out?.ok) throw new Error(out?.error ?? result?.content?.[0]?.text ?? 'Neo returned no result');
		return {value: out.value, ms};
	};
	const ownPage = () => 'const tab = (await browser.pages.list()).find(t => t.pageId === ' + pageId + ' && t.ownership === "mine");';
	try {
		for (let i = 0; ; i++) {
			const open = pageId === undefined;
			const code = open ? 'const page = await browser.open(' + JSON.stringify(url) + ');' :
				ownPage() + 'if (!tab) throw new Error("The workflow tab is no longer available"); const page = browser.page(tab.pageId);';
			const scope = open ? '' : 'if (!tab.url.startsWith(' + JSON.stringify(new URL(url).origin + '/') + ')) throw new Error("The workflow tab left its origin");';
			const action = click ? 'const action = await page.click(' + JSON.stringify(click) + '); if (action?.dialogOpen || action?.fileChooserOpen) throw new Error("Click opened a dialog or file picker");' : '';
			const {value, ms} = await neo(code + ' try {' + scope + action +
				'const previous = ' + (JSON.stringify(previous) ?? 'undefined') + ';' +
				'const observation = await (async () => {\\n' + observe + '\\n})();' +
				'return {pageId:page.id, observation};' +
				'} catch (error) { return {pageId:page.id, error:String(error)}; }');
			if (Number.isSafeInteger(value?.pageId) && pageId === undefined) pageId = value.pageId;
			const step = {neoMs: ms, ...(click ? {click} : {})};
			steps.push(step);
			if (value?.error) throw new Error(value.error);
			const observation = value?.observation;
			if (pageId === undefined || !observation || typeof observation.state !== 'string' || !observation.state.trim()) {
				throw new Error('Neo observation requires a nonempty state');
			}
			previous = observation.evidence;
			evidence.push(previous);
			step.state = observation.state.slice(0, 1600);
			if (observation.done === true) {
				status = 'completed';
				break;
			}
			if (i === maxClicks) throw new Error('Click limit reached');
			const candidates = observation.candidates;
			if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 4 ||
				candidates.some(c => !c || typeof c.ref !== 'string' || !/^e[0-9]+$/.test(c.ref) || typeof c.label !== 'string' || !c.label.trim()) ||
				new Set(candidates.map(c => c.ref)).size !== candidates.length) {
				throw new Error('Neo observation requires one to four distinct click refs and labels');
			}
			const labels = candidates.map(c => c.label.trim().slice(0, 240));
			const {result, ms: judgeMs} = await run(${JSON.stringify(judgeTool)}, {
				goal, state: step.state, candidates: labels
			});
			const decision = result?.details?.decision;
			if (!decision) throw new Error('Jev did not return a structured decision');
			step.judgeMs = judgeMs;
			step.decision = decision;
			const selected = decision?.status === 'chosen' ? candidates[decision.index - 1] : undefined;
			if (!selected) throw new Error('Jev could not select a click');
			click = selected.ref;
		}
	} catch (error) {
		status = 'blocked';
		reason = String(error);
	} finally {
		if (pageId !== undefined) {
			try {
				await neo(ownPage() + 'if (tab) await browser.page(tab.pageId).close();');
			} catch (error) {
				reason = [reason, 'Neo cleanup: ' + String(error)].filter(Boolean).join(' | ');
			}
		}
	}
	print({status, reason, evidence, steps, elapsedMs: Math.round(performance.now() - started)});
}`
}
