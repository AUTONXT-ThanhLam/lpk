# lpk rule catalog

The defect classes a change must not carry when it reaches the tech lead. Built from the team
tech lead's merge-blocking reviews on 38 pull requests and from published evidence (failure
studies, OWASP and CWE rankings, Release It!, Google's review guide). Team and repo rules stay in
the repo's CLAUDE files; `reviews.md` beside this file adds the rules mined from 236 later pull
requests, and rules learned after that live in `~/.local/share/lpk/rules/`.

Each rule: `blocks` is how often this class blocked a merge (high, medium, low); `when` lines are
exact facts about the diff that load the rule (`always`, `added <regex>` on an added line of a
non-test file, `path <regex>` on a changed path, `removed` when non-test code lost or changed
lines); `find` lines are literal patterns `lpk check` reports as candidates on added lines. A
candidate is a place to look, not a verdict. `check` ends with the reproduction a finding needs.

## Guards and state

### entry-paths: every path to protected state passes the same guard
- blocks: high
- when: always
- rule: A guard, validation or invariant holds on every path that reaches the state it protects: each route and its twin in another interface (REST, GraphQL, RPC, MCP tool, CLI), resume, answer, retry and decision routes, scripts, seed and bootstrap, import, restore and bulk paths, and the UI form. It lives in the lowest function they all pass through, not in each caller.
- check: `lpk map --routes --guard <guard>` lists every route and whether the guard appears in its handler; `lpk map <field>` lists every writer of the state. Any path that reaches the state without the guard, or with a weaker one, is a finding. Repro: call that path and show the state change while the guard never ran.

### atomic-transition: the expected prior state is checked inside the write
- blocks: high
- when: added `\b(status|state|update|upsert|merge|cancel|approve|reject|revoke|resume|answer|finish|lock|unlock|claim|rotate)\b`
- find: `\bSET\s+\"?(status|state)\"?\s*=(?![^;]*\bWHERE\b[^;]*\b(status|state)\b)`
- rule: A state change checks its precondition inside the atomic write (compare-and-set `WHERE`, unique constraint, `ON CONFLICT`, row lock), never in an `if` before it. A terminal or user-stopped state is never revived by a later event, and leaving or detaching is not cancelling.
- check: for each new status or lifecycle verb, list the transitions that can race it. Repro: fire two calls at once (`Promise.all`, two curls) and show both succeed or the stopped item come back.

### fail-closed: a missing or failing check refuses
- blocks: high
- when: added `(auth|token|permission|role|admin|lock|guard|allow|deny|policy|verify|quota|process\.env|os\.environ|getenv)`
- find: `catch\s*(\([^)]*\))?\s*\{\s*return\s+(true|next\(\))|except\b[^:\n]*:\s*return\s+True\b` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- find: `(process\.env\.|getenv\(\s*['\"]|environ(\.get\(\s*|\[)['\"])\w*(SECRET|TOKEN|KEY|PASSWORD|AUTH)\w*['\"]?\]?\)?\s*(\|\||\?\?|,\s*['\"]|or\s)` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- rule: When a check, its key or config, or the service it asks is missing, slow, failing or answers garbage, the protected action is refused with a clear error. It never proceeds as if allowed, and an auth check that becomes a no-op when its env var is unset is a defect even where older routes behave that way.
- check: for each guard, state what happens when the dependency is unreachable, times out, answers 5xx, or the env var is unset. Repro: point the dependency at a closed port or unset the variable, and show the action still goes through.

### route-authz: every route and tool checks who is calling
- blocks: high
- when: added `(\b(app|router|server|fastify|api)\.(get|post|put|patch|delete|all|route)\(|@(app|router)\.(get|post|put|patch|delete)|\.tool\(|registerTool|addRoute)`
- rule: Every new or changed route, handler and tool authenticates the caller, checks they may act on that object (owner, tenant, role, admin for admin actions) on the server, and rate-limits unauthenticated writes. A server credential never acts for an unchecked caller.
- check: call it with no token, another user's token and a non-admin token. Repro: the request and the status that should have been 401 or 403.

## Failure handling

### no-silent-failure: a failure never reads as success
- blocks: high
- when: always
- rule: An error reaches a caller, the user or a log with context; a failure never comes back as success, empty, default or "not found". Detached work is held and observed, and cleanup sits in `finally`.
- check: for every new `catch`, `.catch`, `.then` without a rejection path, fire-and-forget promise, `create_task`, `allSettled`, fallback branch and error response, say what the caller sees on failure. Repro: make the call fail and show the success-looking result.
- find: `\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*(undefined|null|void 0|false|\[\]|\{\s*\})\s*\)`
- find: `catch\s*(\([^)]*\))?\s*\{\s*\}`
- find: `^\s*(_\s*,\s*)*_\s*=\s*[\w.]+\(|^\s*let\s+_\s*=|\.ok\(\)\s*;|\brescue\s+nil\b|\btry\?\s`
- find: `^\s*void\s+[\w.]+\(`
- find: `except[^:\n]*:\s*(pass|\.\.\.)\s*$`
- find: `\bcreate_task\(`
- find: `Promise\.allSettled\(`

### partial-write: a write that stops halfway or runs twice stays valid
- blocks: medium
- when: added `\b(insert|update|delete|upsert|save|create|merge|set|write|transaction|begin|commit|publish|send|enqueue)\b`
- find: `\b(\$transaction|begin_nested)\(` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- rule: A change that writes more than once (two tables, two databases, a store and a queue or external API, a file and a row) is atomic or leaves every intermediate state valid and recoverable. No external call runs while a transaction or lock is held. A step that can run twice (retry, redelivery, double click, restart) is idempotent.
- check: mark each `await` between two writes and ask what happens if it throws there or the whole step runs twice. Repro: inject a failure after the first write, or submit twice, and show the broken state.

### timeouts-retries: outbound calls end, and retries are capped
- blocks: medium
- when: added `(fetch\(|axios|got\(|request\(|https?\.|new \w*Client\(|driver\(|Pool\(|retry|backoff|anthropic|openai|messages\.create|callTool)`
- find: `\b(fetch|axios(\.(get|post|put|patch|delete|request))?|got|requests\.(get|post|put|patch|delete|request)|httpx\.(get|post|put|patch|delete|request))\((?!.*\b(timeout|signal)\b)` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- rule: Every outbound call has a timeout shorter than its caller's deadline. Retries are capped, back off, retry only transient causes, keep one meaning per status code, and are not stacked across layers.
- check: count the worst-case requests and seconds when every call fails the same way. Repro: a dependency that never answers, or always answers 429 or 500, and the request count or hang it causes.

## Bounds and time

### bounded-work: every input, loop, poll and budget has a bound
- blocks: high
- when: added `(while\s*\(|for\s*\(|setInterval|setTimeout|refetchInterval|poll|Promise\.all\(|\.map\(async|budget|max_?tokens|limit|findMany|match\s*\(|select\s|z\.array|z\.string|readFile|\.json\(\))`
- rule: Every input, result set, loop, poll, fan-out, queue, retained log and per-turn budget has an explicit bound, checked before the expensive work and sized to the measured working point; a bound set too low (restart policy, watchdog, timeout, context window) is a defect too. Budgets do not multiply per member or per retry. Polling pauses in hidden tabs, never overlaps itself, and hits an index.
- check: list each new collection, loop and timer with its bound and who chooses its size. Repro: the huge input, or the timer with no line that pauses it when `document.hidden` is true.
- find: `setInterval\(`
- find: `refetchInterval`

### stale-async: late results never overwrite newer state
- blocks: high
- when: added `(await |useEffect|\.then\(|setState|EventSource|WebSocket|subscribe|onmessage)`
- find: `\.then\(\s*\(?\s*\w*\s*\)?\s*=>\s*set[A-Z]\w*\(` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- rule: Late, out-of-order or duplicated async results never overwrite newer state or land in another context (another thread, a closed modal, another user). State read before an `await` is re-checked after it, and one event has one emitter.
- check: for each async effect or handler, ask what happens if it resolves after the user moved on, or two run at once. Repro: delay the response, switch context, and show the wrong screen or row.

### resource-lifecycle: what is acquired is released on every path
- blocks: medium
- when: added `(connect\(|\.session\(|addEventListener|setInterval|subscribe\(|spawn\(|createReadStream|acquire|begin|new Worker)`
- find: `\b(createReadStream|createWriteStream|\.acquire)\(|\bnew\s+(WebSocket|EventSource|Worker)\(|addEventListener\((?!.*\bonce\s*:\s*true)` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- rule: Every connection, session, transaction, listener, interval, subscription, child process, lock and temp file is released on every path, including errors, cancellation, unmount and shutdown.
- check: pair each acquire with its release and find the error path that skips it. Repro: throw midway and show the handle still open.

## Inputs and trust

### degenerate-input: edge-shaped input has defined behaviour
- blocks: medium
- when: added `(JSON\.parse|\.split\(|req\.(body|query|params)|parse|\[0\]|\.length|args\.|input\.)`
- find: `\.split\([^)]*\)\s*\[\s*[1-9]` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- rule: Each new parse, map or format step has defined and tested behaviour for empty, null, missing, one element, zero, negative, duplicate, mixed type, no separator and huge input. External input is schema-validated at the boundary and only the validated value is used.
- check: run the step on each of those shapes. Repro: the input and the crash or wrong output.

### untrusted-to-structure: outside text never becomes structure
- blocks: high
- when: added `(\$\{|exec\(|execSync|spawn\(|innerHTML|dangerouslySetInnerHTML|path\.(join|resolve)|redirect|setHeader|new RegExp|eval\(|new Function|match \(|select |insert |cypher|\.query\(|shell\s*=|os\.system|subprocess|exec\.Command|Runtime\.getRuntime|Process\.Start|system\()`
- rule: Text from users, files, models or other services never becomes structure by concatenation: SQL or Cypher, shell, HTML, markdown headings, headers, paths, URLs, regexes, key paths. Parameters, allowlists and escaping sit at the boundary; a sandbox the text promises is enforced by the platform; server-side fetches of user-influenced URLs are allowlisted.
- check: trace each such string to where it becomes structure and try a newline, a quote, `..`, `#`, `${` and a 10 MB value. Repro: the input and the structure it injects.
- find: `dangerouslySetInnerHTML|\.innerHTML\s*=`
- find: `\bexec(Sync)?\(\s*\x60`
- find: `shell\s*=\s*True|\bos\.system\(|exec\.Command\(\s*"(ba|z)?sh"\s*,\s*"-c"|Runtime\.getRuntime\(\)\.exec\(`
- find: `\bf["'](SELECT|INSERT|UPDATE|DELETE)\b[^"']*\{|\.(query|execute|raw|exec)\(\s*\x60[^\x60]*\$\{|["'](SELECT|INSERT|UPDATE|DELETE)\b[^"']*["']\s*(\+|%\s)`

### secret-egress: secrets and personal data stay in
- blocks: high
- when: added `(token|secret|password|passwd|api_?key|credential|private|hash|console\.|logger\.|log\.(info|debug|warn|error)|export|backup|audit)`
- find: `\b(console\.\w+|logger?\.\w+|log\.\w+|print)\(.*\b([Pp]assw(or)?d|[Ss]ecret|[Tt]oken(?!s\b)|[Aa]pi_?[Kk]ey|[Aa]uthorization|[Cc]redential)s?\b(?!\s*(count|length|of|in a row))` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- rule: Credentials, hashes and personal data never leave through responses, exports, backups, audit records, logs, error text, client bundles, URLs or model prompts. Production refuses to store a secret in plaintext when its encryption key is missing.
- check: trace each secret field to every serializer, log line and export. Repro: the response, export or log line that contains it.

### agent-safety: model and tool output is data, loops stop
- blocks: medium
- when: added `(tool|prompt|agent|llm|model|mcp|messages\.create)`
- find: `(?<![.\w])(eval|exec|execSync)\(\s*[a-z_]\w*\s*[,)]|\bnew\s+Function\(` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- rule: Model and tool output is parsed with a schema and authorized like user input before it drives a query, path, command or id. Agent loops cap turns, tokens and repeated calls and stop with a report at the cap. "Done" comes from observed state, not from the model's claim. MCP tools validate input, bound output and return errors as errors.
- check: feed malformed output, a tool error and a run that hits the cap. Repro: the output and the wrong action or silent stop.

## Contracts and regressions

### consumer-contract: every consumer still works
- blocks: high
- when: removed
- when: path `(openapi|swagger|schema|types?\.|dto|proto|graphql|routes?|/api/|events?|tools?|migrations?)`
- rule: A removed, renamed or re-meant field, status, enum value, route, tool output, setting or default keeps every consumer working, in this repo and its sibling repos, or they change in the same change or a paired PR with the merge and deploy order stated. New enum values reach the schema and every `switch`.
- check: `impact.md` and `lpk map <name>` for each changed name; read the consumer at its main branch. Repro: the consumer line that now breaks and the input that reaches it.

### regression-vs-main: what main accepted still works
- blocks: high
- when: removed
- rule: Everything main accepted, served, indexed, defaulted or allowed still works unless the request says otherwise, and each deliberate regression is named in the PR. Replay paths (restore, import, re-index, resume) are checked against newly tightened rules.
- check: for each removed or changed line, name inputs main handled there, including edge and malformed ones, and run them on main and on the branch with `lpk compare --run "<harness>" --inputs <dir>`. Repro: the input, main's result and the branch's result.

### sibling-parity: two readers of one value agree
- blocks: medium
- when: added `(parse|normali[sz]e|validat|schema|z\.object|serializ|format|split\(|join\()`
- rule: Places that interpret the same value (validator and runtime, form and server, REST and MCP, two parsing lanes, the table a writer fills and the one a reader reads) agree, ideally by calling one function. A fix applied in one copy is applied in every copy of the same bug.
- check: grep the other readers of the value and the same pattern elsewhere; compare what each accepts and how each fails. Repro: a value one side accepts and the other rejects or reads differently.

### per-user-scope: per-user data is keyed per user
- blocks: medium
- when: added `(owner|tenant|user_?id|session|cache|new Map\(|global|singleton)`
- find: `^(export\s+)?(const|let|var)\s+[a-z]\w*\s*=\s*new\s+Map\(\s*\)|^[a-z_]\w*\s*(:\s*[\w\[\], ]+)?\s*=\s*(\{\}|dict\(\))\s*$` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- rule: Ids, caches, stores and defaults that hold per-user data are keyed per user, and every sibling query applies the same scope.
- check: two users with the same name or id. Repro: the two calls and what one sees or overwrites of the other.

### partial-results: a dropped part is reported
- blocks: medium
- when: added `(limit|slice\(|take|truncat|skip|ignor|\.filter\()`
- find: `catch\s*(\([^)]*\))?\s*\{\s*continue\s*;?\s*\}|except\b[^:\n]*:\s*continue\b` in path `^(?!.*(^|/)(tests?|spec|__tests__)/)(?!.*[._-](test|spec)\.)`
- rule: When an operation drops, skips, truncates or ignores part of its input, the result says so, and what is kept is deterministic (sorted before the limit).
- check: an input larger than the limit or with an ignored field. Repro: the call that returns success while part of it was lost.

## Tests and delivery

### tests-prove: tests fail when the change is undone
- blocks: high
- when: always
- rule: Each acceptance scenario and each new error branch has a test that drives the entry point the user or caller uses, asserts the specific outcome (which item, which status, which row), uses the data shape the bug needs, and runs real SQL or IO where the bug lives. Asserting a count, truthiness or a mock the test itself set up does not count.
- check: `lpk mutate --test "<command>"` reverts each changed source file in a scratch copy and runs the tests; a file whose revert leaves them green is not proved by any test.
- find: `\b(it|test|describe)\.(only|skip)\(|\b[xf](it|describe)\(|\bt\.Skip(Now|f)?\(|@pytest\.mark\.skip|@unittest\.skip|#\[ignore\]|@(Disabled|Ignore)\b`

### ci-runs-it: CI runs the new checks and still starts
- blocks: high
- when: path `(test|spec|__tests__|\.github/workflows|package\.json|pyproject|Makefile|tox\.ini|vitest|jest|playwright|tsconfig)`
- rule: New tests and scripts run in a CI job that starts, on the runtime version the dependencies need, also when the PR's base is not the default branch (a stacked PR whose base the gate skips). No gate is skipped, loosened or made non-blocking to pass, and tests avoid sleeps, wall-clock time, shared rows and fixed ports.
- check: find each new test file or script in a CI command (`lpk facts` lists them) and read workflow contexts at the level they are used. Repro: the CI command list that never reaches the file.
- find: `continue-on-error:\s*true|\|\|\s*true\b`

### deploy-wiring: new config reaches the running container
- blocks: high
- when: added `(process\.env|os\.environ|getenv|import\.meta\.env|Deno\.env)`
- when: path `(docker|compose|\.env|helm|k8s|deploy|platform[^/]*\.ya?ml)`
- rule: A new env var, flag or default reaches every deployed container (compose, platform yml, env templates, helm), and the code default is safe wherever it is unset.
- check: `lpk check` lists env names that added code reads and no deploy file mentions. Repro: the service block that never receives it.

### migration-safe: a migration survives the deploy
- blocks: high
- when: path `(migrat|\.sql$|schema\.prisma|constraint|\.cypher$)`
- find: `\b(DROP\s+(TABLE|COLUMN)|RENAME\s+(COLUMN|TO)|ALTER\s+COLUMN\s+\w+\s+(SET\s+NOT\s+NULL|TYPE)|ADD\s+COLUMN\s+(?![^,;]*DEFAULT)[^,;]*NOT\s+NULL)` in path `(migrat|\.sql$)`
- rule: A migration works with the code still running during deploy (expand, then contract), avoids long locks and table rewrites, is reversible or says it is not, and new constraints hold on existing data.
- check: run it on a copy with production-shaped data and run the old code against the new schema. Repro: the statement and the failure.

### mechanical-gates: the deterministic gates pass on the final tip
- blocks: medium
- when: always
- rule: Format, lint, typecheck, licence headers, `git diff --check`, commit subjects of at most 72 characters, linear history and a PR title of at most 72 characters all pass on the commit that is delivered.
- check: run each with the exact command CI uses.

## Claims and scope

### triage-closed: every review comment is answered on the current head
- blocks: medium
- when: always
- rule: Every comment a reviewer or review bot leaves on the PR is fixed in a named commit or declined with the reason, and the answers are rechecked against each bot's newest review after every push: a bot that re-reviewed later can reopen an item answered earlier.
- check: `gh api repos/<o>/<r>/pulls/<n>/reviews` gives each review's `commit_id`; for each bot, its newest review is on the head, and each of its comments has a row in the triage comment. Repro: the comment and the review on the head that still raises it.

### truthful-claims: words state only what the code checks
- blocks: high
- when: always
- rule: Error messages, guard names, comments, docblocks, docs, API schemas, UI copy, commit messages and the PR body state only what the code checks, and change when the code beneath them changes. Dead branches go with their producer.
- check: for each new message or comment, point at the line that makes each noun and verb true. Repro: the input that makes the text false.

### disclose-and-order: the PR says what changes and in what order
- blocks: medium
- when: always
- rule: The PR body describes the final diff: every behaviour change and default shift against main, risky ones behind config, and any other PR, deploy or restart that must happen first, in order.
- check: compare the removed defaults, caps and paths with the body, after the last commit.

### scoped-change: one request per change
- blocks: medium
- when: always
- rule: A change carries one request and one ticket: no unrelated reformatting, submodule bumps, lockfile churn, artefacts or extra features, and no host names, IPs, deployment state or customer names in source, seeds or images.
- check: list each changed file the request does not need, and each ticket beyond the first that the branch name or the commit subjects `lpk facts` prints name. After review starts, a fix changes only what its finding needs; a refactor, a rewrite or another ticket is a new PR, and no other feature branch is merged into this one.
- find: `\b(\d{1,3}\.){3}\d{1,3}\b`
- find: `\.lan\b`

### reuse-first: nothing is built that the repo or an installed dependency already does
- blocks: medium
- when: always
- rule: A mechanism the change builds (a loop, lock, retry, queue, poller, cache, event stream, table, script, component) is not already done by a helper in the repo, the public API of an installed dependency at its installed version, the standard library or the platform; a design from the owner or the tech lead is no exception. A dependency's internals (its scripts, keys or private fields) are not written to where its public API does the job.
- check: for each new mechanism, read the public API of each installed dependency that works in the same domain (its types or docs where it is installed) and grep the repo for a helper that does it. Repro: the export or path, and a run where it does what the change builds by hand.

### ui-states: every async view shows every state
- blocks: medium
- when: path `\.(tsx|jsx|vue|svelte|dart)$`
- find: `\bonClick=\{\s*async\b` in path `\.(tsx|jsx)$`
- rule: Each async view shows loading, error, empty and success distinctly; errors are visible and say what to do; a submit cannot fire twice; after an action fails or is cancelled, its busy state clears and the controls work again; destructive actions confirm; the layout main had (scroll, spacing, focus) still works.
- check: on the page, try a slow network, a failing API, empty data and a double click; make an action fail once, then retry it without reloading. Repro: the screenshot.
