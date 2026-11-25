# pi-jev-harness

A [Pi](https://pi.dev) extension where [TypeSafe's Jev](https://typesafe.ai) does the reasoning around tool calls, so the main model spends its tokens on generation only.

Jev is a System One model: it never writes text, it only answers typed questions (Choice, Score, yes/no Noul) with probabilities and confidence, in about 300 ms, at $0.042 per million input tokens. It cannot write a bash command or an edit. It can decide which tool a turn needs, which of forty files are worth reading, whether a 9,000-character test log matters, and whether the agent is going in circles. Those decisions are most of what a frontier model burns tokens on between the moments it actually writes something.

## Install

```
pi install git:github.com/MoonTory/pi-jev-harness
export TYPESAFE_API_KEY=...    # https://console.typesafe.ai/keys
```

No runtime dependencies. Node 22.18 or newer. `rg` (ripgrep) on the path for context pre-fetch.

## What it does

Five things, each one Jev request, each switchable in config.

**1. Route the turn** (`before_agent_start`, opt-in). OMP defaults to compact routing, which asks Jev for the turn kind and, when eligible, whether a delegate would help. The tool list stays stable. Use `jev_find_tools` to look up specialist tools by service and operation. It searches enabled tools locally and asks Jev to rerank at most 12 matches. `routeStrategy: "full"` uses the original per-tool scoring. Full routing can hide tools for the turn when no delegate is configured.

**2. Pre-fetch context** (`before_agent_start`, when pre-fetch is enabled). Code pulls terms from a vague prompt and sends matching lines from up to forty files to Jev. If the prompt names a file and `rg --files` finds it, pre-fetch stops: the model can make a cheaper targeted read itself. Otherwise Jev ranks the candidates. At most two files qualify when Jev's `first` confidence or file score reaches 0.6. The harness injects 15-line windows around matching lines, merges overlapping windows, and caps the total at 120 lines per file. It never injects a file twice in one session. The injected message stays out of the transcript; the footer lists its file ranges.

**3. Trim results** (`tool_result`, for bash, grep, find, ls output over 6,000 chars; file reads are never judged, the model asked for exactly that). Jev sees the head and tail of the output with the task and answers: did it succeed, is it relevant, and how much should the model see (all, head, drop). Irrelevant output is replaced by a one-line note with the relevance score and how to get it back; repetitive output is cut to its first 2,000 chars. The model never pays for output it did not need. The judgement waits on Jev before the model sees the result, so the floor is high on purpose: only long test logs, wide greps and big listings are worth the round trip.

**4. Loop control** (`tool_call`). When the same call with the same input shows up three times in the last twelve, Jev sees the recent calls and answers whether the agent is stuck and whether a different approach would be better. If so the call is blocked with a reason the model can act on. Checked once per turn.

**5. Guard** (`tool_call`, non-read tools). A compact version of [pi-jev-guard](https://github.com/MoonTory/pi-jev-guard) in the same request as loop control: a risk Score (read only, reversible, hard to reverse, destructive) and a secrets Noul. Hard to reverse or destructive calls get a confirm dialog with Jev's reason; with no UI they are blocked so the model asks the user.

### When it helps

Pre-fetch pays off on vague prompts that would take several tool calls to locate. On prompts that name a file, the model's own read is cheaper, so the harness stays out of the way.

The footer shows the last Jev verdict. Every Jev call is logged with its answers to `~/.jev-harness/log.jsonl`.

### Delegate a project investigation in omp

Set `delegateModel` to an exact `provider/model` from `omp models`. Use a model
that supports native tool calls or a gateway routing group such as
`magpie/group/jev-delegate`. For a single run, set `PI_JEV_DELEGATE_MODEL` instead.
In `on` mode with `route: true`, Jev scores whether a self-contained project
investigation would benefit from a delegate. For an `explore` route and a score
of at least 0.65, the harness runs the delegate before the main model responds
and includes its findings as context. The main model is instructed to answer
from complete, cited findings and reopen files to resolve a specific gap or
contradiction. It can also invoke `jev_delegate` with a focused question.

With `delegateModel` set, routes are advisory. The harness appends the route and
delegate findings to the turn's message history and leaves tools and the system
prompt stable across routed turns to preserve the cacheable prefix.

The delegate runs in memory in the same project and can use the caller's enabled
`read`, `grep` and `glob` tools. Automatic delegation waits up to 12 seconds by
default, then the main model continues. Explicit `jev_delegate` calls have a
30-second execution budget. The log includes elapsed time, tool names and child
model usage for successful runs, plus the reason and elapsed time for failed
automatic runs.

```sh
PI_JEV_DELEGATE_MODEL=magpie/group/jev-delegate omp --no-extensions -e ./index.ts -p \
  'Use jev_delegate to find how route.ts decides which tools to keep.'
```

### Execute a multi-step lookup in omp

With Jev Harness in `on` mode, pass a scoped goal and active tool names as the
entire `code` of a JavaScript `eval` call:

```text
jev_execute({"goal":"Find the active version and last completed rollout for this deployment URL.","tools":["mcp__browseros_neo_run"]})
```

The `@smol` agent runs the lookup over the existing session tool bridge. It can
ask Jev to choose among two to five concrete next steps using a scope summary
and the evidence it has gathered. When Jev is unavailable or uncertain, the
agent receives an undecided result and can verify the state or return a blocker.
The result includes the worker's elapsed time and timings for its bridged calls.

Use `PI_JEV_EXECUTOR_MODEL` to select a different fast model. The executor accepts
file lookup tools, MCP tools advertised as read-only, and BrowserOS Neo `run`
for read-only browser work. Give the agent the URLs, allowed actions, and
completion condition. Keep BrowserOS session handles across calls when required.

### Read multiple paths in one omp eval call

With Jev Harness in `on` mode, pass this as the entire `code` of a JavaScript
`eval` call:

```text
read_many(["src/a.ts:1-30", "src/b.ts:12-20:raw"])
```

Use a JSON array of path strings. Jev Harness expands the standalone call before
JavaScript runs and prints the results automatically. Each path, including its
selectors, goes to omp's native `read` through the eval bridge and follows the
session's `read` approval policy. Results appear in input order, with an error
for each read that fails. The outer call also follows the session's `eval`
approval policy.

For broad scans, the optional preview form caps successful text per path while
preserving per-path errors. Use targeted line ranges for the evidence you need.

```text
read_many({"paths":["src/a.ts","src/b.ts"],"maxCharsPerPath":4000})
```

## Commands

```
/jev-harness on      # default: pre-fetch, trim, loop control, guard (route is opt-in)
/jev-harness log     # ask Jev and log every answer, change nothing
/jev-harness off
/jev-harness         # stats: turns seen, files pre-fetched, turns skipped, results trimmed, Jev cost
                     # and model tokens saved, loops caught, guard verdicts, Jev calls, latency, tokens, cost
```

Run in `log` mode for a day first. The log shows what it would have hidden, pre-fetched, or cut without changing anything.

## Config

Optional `~/.pi/agent/jev-harness.json`:

```json
{
	"mode": "on",
	"route": false,
	"prefetch": true,
	"trim": true,
	"loop": true,
	"guard": true,
	"prefetchFiles": 2,
	"prefetchLines": 120,
	"prefetchBudgetMs": 1200,
	"delegateBudgetMs": 12000,
	"trimMinChars": 6000,
	"keepHeadChars": 2000,
	"timeoutMs": 3000,
	"showStatus": true
}
```

For a System One gateway, set `baseUrl` to its full System One endpoint and
`model` to the gateway's model ID. Set `apiKey` in the same file when the gateway
requires its own bearer key. With no gateway configured, the extension uses
TypeSafe and `TYPESAFE_API_KEY`.

On OMP, omit `routeStrategy` to use compact routing when `route` is enabled. On Pi,
the default is `full`. Set `PI_JEV_ROUTE_STRATEGY=compact`, `full`, or `off` to
override routing for a single process. Prefetch's budget covers file discovery
and the Jev request together. `timeoutMs` still caps each Jev request.
Thresholds live in `jev.ts` next to the questions.

To move eligible MCP tools into OMP eval namespaces for a comparison, run OMP
with a `--config` overlay containing `mcp.evalNamespaces: true`. Tool discovery
still searches enabled tools, including those presented in namespaces.

## Files

- `jev.ts`: the client and every question and threshold. Read this first.
- `route.ts`: term extraction, candidate files, routing, pre-fetch.
- `tools.ts`: loop control, guard, result trimming.
- `types.ts`: config, stats, shared types.
- `index.ts`: wiring, stats, the command.
- `delegate.ts`: omp tool registration and the read-only delegate session.
- `try.ts`: dry run of routing and pre-fetch on a prompt against the current directory.

## Try it without pi

```
cd some-repo
node ~/code/pi-jev-harness/try.ts "where is the tick loop and how does the veto work in bot.ts"
```

It reports `named file in prompt → no pre-fetch` for a prompt that names a file. For vague prompts, it reports the ranked files and the matching line ranges it would inject.

On the jev-snake repo:

```
kind: explore (1.00)  744ms 884 tok
  keep read   0.95
  keep bash   0.35
  hide edit   0.15
  hide write  0.11
  keep grep   0.82
  hide find   0.33
  keep ls     0.39
```

## Benchmark

Compare plain Pi with the harness on a fixed prompt set. Pi JSON mode writes per-turn usage and tool events to stdout; the benchmark sums final assistant-message usage and tool starts. It counts harness Jev calls from `~/.jev-harness/log.jsonl` whose timestamps fall within each harness run. After all runs finish, Jev grades each answer against its plain-English facts, so pass rates do not depend on exact code names or wording. Grader tokens print separately and do not count as run cost.

```
npm run bench -- --repo ~/code/jev-snake --prompts bench/prompts.jev-snake.json --runs 3 --model gpt-5.6-sol
```

Use `--arm both|harness|plain`, `--parallel 2`, `--out bench/results`, or `--only named-tick-loop,named-veto` to narrow a run. Use `node bench.ts --regrade bench/results/example.json` to grade saved answers without running Pi. Each result JSON records raw answers, per-fact Jev scores, model and run Jev token use, tool calls, and wall time. The report prints per-prompt and per-kind medians; pass rate means every fact scored at least 0.6.

## Development

```
npm install
npm run check    # typecheck, oxlint --type-aware, prettier --check
```

Linting follows the adminty ruleset: oxlint with the correctness and suspicious categories as errors, the typescript type-aware rules, and a copy of adminty's custom `oxlint-rules` plugin (no unexplained type assertions, no empty catch without a comment, readable spacing, no nested ternaries, functions under 60 lines). Formatting is prettier with tabs, no semicolons, single quotes.

## Limits

- Jev sees trimmed inputs: the prompt, tool descriptions cut to 200 chars, result head and tail, recent calls cut to 160 chars. It does not see the conversation.
- Hiding a tool is a bet. If the model says it needs one, the system prompt note tells it to say so; the tool comes back next turn. `ALWAYS_KEEP` in `types.ts` pins `read`.
- Trimming replaces content the model never saw. The note always says how many chars were cut and the relevance score, and the full output stays in the pane.
- Confidence drifts by a few hundredths between identical calls, so near a threshold the same output can be kept one time and cut the next.
- Token savings shown by the stats command are chars saved divided by four, an estimate.
