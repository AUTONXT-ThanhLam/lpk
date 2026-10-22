# lpk rules mined from the tech lead's reviews

New rules, and extra `when` and `find` lines for rules in `catalog.md`, from the tech lead's
merge-blocking reviews on 236 pull requests across the team's repos. A block under an id that
`catalog.md` already has holds only the extra lines: lpk adds them to that rule. The format is the
one `catalog.md` describes.

## Guards and state

### route-authz
- when: added `(@(app|router)\.websocket\(|add_websocket_route\(|new WebSocketServer\(|\.ws\()`
- find: `\.get\(\s*['"\x60][^'"\x60]*(logout|signout|sign-out|revoke|delete|remove|disable)`

### atomic-transition
- when: added `(\battempts?\b|retr(y|ies)_?count|json\.dump\(|writeFile(Sync)?\()`
- find: `\battempts\s*\+\s*1\b`

### client-session: a browser session is stored safely, expires cleanly and reaches every request
- blocks: medium
- when: added `(localStorage|sessionStorage|new (WebSocket|EventSource)\(|axios\.create\(|interceptors\.|Authorization)`
- rule: A browser client keeps session tokens out of script-readable storage or states the threat model it accepts; it checks expiry and answers a 401 by clearing the session and sending the user to sign in and back to where they were; every HTTP client instance and every stream (WebSocket, SSE) carries the credential by a mechanism that API supports, created from one shared factory, and the refresh and profile flows it builds are wired into that path.
- check: sign in, expire or delete the token, reload each page and open each stream with the network panel open; list every `axios.create`, `fetch` wrapper, `WebSocket` and `EventSource` and the header or cookie each sends. Repro: the request that goes out without the credential, or the page left broken after expiry.

### owned-cleanup: cleanup touches only what this component created
- blocks: high
- when: added `(prune|destroy|teardown|cleanup|purge|sweep|DETACH DELETE|deleteMany|rm\s+-rf)`
- find: `docker\s+(network|system|volume|image|container)\s+prune`
- rule: Cleanup, teardown and reset act only on resources this component created and recorded (the ids it spawned, a namespace or label it owns), never on host-wide state or on everything that matches a shared name, so one case, tenant or service cannot destroy another's live objects.
- check: run two instances (two cases, two tenants, two services) against the same world, host or store and trigger one's cleanup. Repro: the other instance's object that disappears.

## Failure handling

### no-silent-failure
- find: `\]\s*&&\s*[^|&\n]+\|\|\s*\S` in path `^(?!.*\.github/workflows/).*(Makefile|\.mk|Dockerfile[^/]*|package\.json|\.ya?ml)$`
- find: `\]\s*&&\s*[^|&\n]+\|\|\s*\S`

### timeouts-retries
- when: added `(readTx|writeTx|executeRead|executeWrite|session\.run\(|createTransport\(|sendMail\(|httpx\.(Async)?Client\(|requests\.(get|post|put|patch|delete)\(|urlopen\(|WAIT_FOREVER)`

## Bounds and time

### bounded-work
- when: added `(on-failure|restart_?policy|MaximumRetryCount|max_?retries|allowList|\bMATCH\s*\(|new Map\(|\bcache\b)`
- find: `on-failure:\d\b|MaximumRetryCount['"]?\s*[:=]\s*\d\b`

### resource-lifecycle
- when: added `(\b[A-Z]\w*Client\(|createWriteStream\(|asynccontextmanager|lifespan|__aexit__|\.cancel\(\))`

### stale-async
- when: added `(threading\.Thread\(|add_done_callback\(|call_soon_threadsafe\(|\.listen\(|getIntent\(\))`

### setup-once: clients, schema and lookups are set up once, not per call
- blocks: medium
- when: added `(new \w*(Driver|Pool|Client)\(|\.driver\(|\bpipeline\(|create(Pool|Client|Connection)\(|CREATE\s+(TABLE|INDEX)|await import\()`
- find: `['"\x60]\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS`
- rule: Clients, pools, drivers, models and schema are created once (at startup, at module scope or in a migration) and reused. A request, tool call or loop iteration does not open a new driver, rebuild a pipeline, run DDL, import a module dynamically, or query once per item when one batched query or a row already fetched would do.
- check: count connections opened, DDL statements and queries for one request and for a request over N items. Repro: the request and the count that grows with each call or with N.

## Inputs and trust

### degenerate-input
- when: added `(\.r?partition\(|json\.loads?\(|yaml\.(safe_)?load\(|Array\.isArray\(|\.get\(\s*['"][^'"]+['"]\s*,\s*(\{\}|\[\])\s*\))`

### untrusted-to-structure
- when: added `\b(base_?url|baseURL)\b`

### secret-egress
- when: path `(^|/)Dockerfile[^/]*$`
- find: `^\s*COPY\s+(--\S+\s+)*\S*\.env(\.\w+)?\s`
- find: `\.json\(\s*\{\s*error:\s*\w+\.message|detail\s*=\s*str\(\s*e\w*\s*\)`

### agent-safety
- find: `type:\s*['"]\w+,\s`

### no-default-credentials: no credential lives in source or ships as a default
- blocks: high
- when: added `(password|passwd|secret|api_?key|credential|_PW\b|://[^\s/:@]+:[^\s/@]+@)`
- when: path `(^|/)(\.env[^/]*|[^/]*compose[^/]*\.ya?ml|alembic\.ini|settings\.py|[^/]*seed[^/]*|migrations?/[^/]+\.sql)$`
- find: `\b[a-z][a-z0-9+]*://[^\s:/@'"$]+:[^\s@/'"$]+@[\w.-]+`
- find: `\bcp\s+\S*\.env\.example\s+\S*\.env\b`
- find: `(PASSWORD|_AUTH)\w*['"]?\s*[:=]\s*['"]?(\w+/)?(password|admin|changeme|change-me|secret)\w*`
- find: `(process\.env\.\w*(PASSWORD|_PW|SECRET|TOKEN|API_?KEY)\w*|os\.(environ\.get|getenv)\(\s*['"]\w*(PASSWORD|SECRET|TOKEN|API_?KEY)\w*['"]\)?)\s*(\?\?|\|\||,|\bor\b)\s*['"][^'"]+['"]`
- rule: No credential literal, and no non-empty fallback for one, appears in source, config templates, compose files, ini files, seeds, migrations, tests or images. A missing credential stops startup with a message naming the variable and is never replaced by a dummy value; a placeholder from an example file never reaches a deployed environment; when a default credential is retired, hosts that still hold it are warned until it changes; a value that was ever committed is rotated.
- check: grep the diff for credential names followed by `||`, `??`, `or` or a second `getenv` argument, and for `user:pass@` URLs; start the service with each credential unset and with the example env copied as-is. Repro: the line with the literal or fallback, and the service that starts or authenticates with it.

### config-validated: every setting is checked at load and its default fits its consumer
- blocks: medium
- when: added `(process\.env|os\.environ|getenv|import\.meta\.env|\bPORT\b)`
- when: path `(^|/)(\.env[^/]*|[^/]*config[^/]*\.(ya?ml|json|toml)|settings\.py)$`
- find: `^[A-Z][A-Z0-9_]*=[^\s#'"]+#`
- rule: Each setting is parsed and checked when it loads (type, range, allowed values, settings that must come together) and a bad value fails with a message naming the setting. A default belongs to the option that uses it and is valid for the client that consumes it; a specific setting overrides the generic one it falls back to; an optional dependency or config key that can be unset or null gets a defined default or is required at construction, never stored as undefined. Config templates list each key once with values the loader reads exactly as written, and services deployed together have distinct default ports that every reference agrees on.
- check: start the service with each new setting unset, empty, null in YAML, zero, negative, a misspelt enum value, and with the template copied unchanged; diff the ports in Dockerfile, compose, health checks and code defaults. Repro: the value and the crash, wrong routing or silent misconfiguration it causes.

## Contracts and regressions

### sibling-parity
- when: added `(axios\.create\(|\.tool\(|registerTool\(|server\.tool\(|\bSYSTEM_PROMPT\b)`

### partial-results
- when: added `\b[A-Z][A-Z0-9_]*LIMIT\b\s*=\s*\d+`

### mergeable-on-main: the branch merges cleanly and is tested on the merge
- blocks: medium
- when: always
- rule: The branch merges into current main without conflicts and is tested on the merge result. No other open PR edits the same code without an agreed order; a submodule pointer names a commit pushed to its remote and built on main's pointer; and when main gained behaviour or tests after the branch point, the change keeps them or states which design wins.
- check: `git fetch origin main`, then `git merge-tree --write-tree origin/main HEAD` and the test command on that merge; `git -C <submodule> branch -r --contains <sha>` for each submodule bump; `gh pr list --state open --search <changed path>` for overlapping PRs. Repro: the conflicting hunk, the test that fails only on the merge, or the submodule commit no remote branch contains.

## Tests and delivery

### ci-runs-it
- when: path `(eslint\.config|\.eslintrc|prettier|ruff\.toml|setup\.cfg|\.pre-commit-config|commitlint)`

### migration-safe
- when: added `CREATE\s+(TABLE|INDEX)\b`
- find: `['"]\d{4}_\w+\.sql['"]`

### mechanical-gates

### clean-checkout-runs: a fresh clone runs with only the documented steps
- blocks: medium
- when: path `(^|/)(README[^/]*|[^/]+\.sh|Makefile|Dockerfile[^/]*|[^/]*compose[^/]*\.ya?ml|\.env\.example)$`
- when: added `(__file__|process\.cwd\(\)|os\.getcwd\(\)|\$\(dirname|\bopen\(\s*['"]\.?/?[\w-]+/)`
- find: `=\s*['"](\./)?[\w-]+/[\w./-]+\.(json|db|sqlite|csv)['"]` in path `^(?!.*\.(m?[jt]sx?|cjs|py)$)`
- rule: A fresh clone works by following only the documented steps, from any working directory. Default paths resolve from the module or from config, never from the current directory; parent directories are created before a write; every config fragment, build output and file a script or service needs exists in the repo or image when it starts; defaults in code and templates work against the real client; and a module the tests import does not hard-import a dependency CI does not install.
- check: clone into an empty directory, follow the README or run the script exactly as written, once from another working directory, then run the test command. Repro: the command and its first error.

### dependency-change-proven: a dependency change installs, builds and is exercised
- blocks: medium
- when: path `(^|/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile)$`
- rule: A dependency change installs with the exact CI install command against a committed lockfile, builds the image, and runs a test that exercises each API the change touches. A major bump states which breaking changes were reviewed and which call sites were adapted; a version is never lowered unless the request says so; peer dependencies stay compatible; audit findings that remain are fixed or accepted with a reason.
- check: on a clean checkout run the CI install (`npm ci`, `uv sync --frozen`), the image build and the tests; read the changelog of each major bump and grep the repo for its changed APIs. Repro: the install or build error, or the call site the changelog breaks with the request that reaches it.

### container-hygiene: images are pinned, unprivileged and observable
- blocks: low
- when: path `(^|/)(Dockerfile[^/]*|[^/]*compose[^/]*\.ya?ml)$`
- find: `image:\s*['"]?[\w./-]+:latest\b`
- find: `^FROM\s+(?!scratch\b)[a-z][\w.-]*(/[\w.-]+)*(\s+AS\s+\w+)?\s*$`
- find: `docker\.sock`
- rule: Every image and base stage is pinned to an explicit tag, never `latest` or untagged, and manifests are pinned or locked. The service runs as a non-root user from a WORKDIR; long-running services have a healthcheck and a restart policy matching their siblings; mounting the host Docker socket is stated as a trust boundary in the PR.
- check: read each `FROM`, `image:`, `USER`, `WORKDIR`, `healthcheck` and `restart` line the change adds or touches, and `docker inspect` the built image's user. Repro: the unpinned or root line and the service it affects.

## Claims and scope

### scoped-change
- find: `\b\w*(URL|Url|HOST|Host|ENDPOINT|Endpoint|URI|Uri)\w*['"]?\s*[:=,]\s*['"\x60]?(https?|bolt|neo4j|wss?|redis|postgres(ql)?)://(?!localhost\b|127\.0\.0\.1\b|0\.0\.0\.0\b|example\.)[\w-]+\.[\w.-]+`

### committed-artifacts: binaries, build output and data stay out of git
- blocks: medium
- when: path `\.(png|jpe?g|gif|webp|mp3|mp4|mov|wav|apk|aab|jar|whl|zip|tar|tgz|gz|7z|bin|so|dll|exe|pdf|csv|parquet|sqlite|db)$`
- when: path `(^|/)(outputs?|logs?|target|generated)/`
- rule: Binaries, build outputs, generated files, data dumps, runtime data and scratch files stay out of git: they are built in CI, fetched by a script, or stored outside the repo (LFS, a release asset). The change that removes one, or could re-add one, lists it in `.gitignore`; a binary the app truly needs is sized for its use and committed once, not copied from another repo.
- check: list each added or changed binary or generated path with its size and the command that produces it (`git diff --stat --cached`, `git ls-files -s`). Repro: the path, its size and the regenerating command.

### no-dead-code: nothing ships that does nothing
- blocks: low
- when: added `^\s*(//|#)\s*(const|let|var|import|from|await|return)\b`
- when: path `(^|/)(package\.json|requirements[^/]*\.txt|pyproject\.toml)$`
- rule: The change leaves no commented-out code, unreachable statements, uncalled functions or exports, unused parameters or dependencies, settings that have no effect on the configured platform, or two libraries for one purpose. A flow the change builds is wired into the path users take, and a library, file or setting it replaces is removed in the same change.
- check: for each new export, file, dependency and setting, grep for its references; read the lines after each `return`. Repro: the definition and the empty reference list, or the commented-out block.
