# Boundary rules

Defect classes at the edges where a change meets another system or a user's own data: a provider's
webhook, a token, a database policy, a stream, a shared cache, a clock, money. Adapted from the
QA skills in https://github.com/PramodDutta/qaskills (MIT) where the catalog had no rule for them,
in the format `catalog.md` describes.

## Trust at the edge

### webhook-verified: a webhook is verified over the raw body and handled once
- blocks: high
- when: added `(webhook|svix|stripe-signature|x-hub-signature|x-signature|constructEvent)`
- rule: A webhook handler verifies the provider's signature over the raw request body (never over a re-serialised parse), rejects a missing or wrong signature and a stale timestamp, and handles each event id once, because providers redeliver.
- check: send the handler a body with a wrong signature, the same body re-serialised, a timestamp from yesterday, and the same signed event twice. Repro: the request and the second effect, or the status that should have been 400 or 401.

### token-verification: a token or session is verified before it authorises
- blocks: high
- when: added `(jwt|jsonwebtoken|\bjose\b|\bjws\b|set-cookie|express-session|req\.session|\.decode\()`
- rule: A token's signature is verified with the accepted algorithms pinned, and `exp` and `aud` or `iss` are checked; a decoded-only token never authorises. A login issues a new session id, a session cookie is `HttpOnly`, `Secure` and `SameSite`, logout invalidates the session on the server, and every HTTP method of a protected route is checked, not only GET.
- check: call with a token whose algorithm is `none`, one signed with another key, an expired one and a wrong audience; log in twice and compare session ids; replay the old cookie after logout. Repro: the request that was accepted.

### rls-policies: a database policy enables itself and checks what it writes
- blocks: high
- when: added `(create\s+policy|enable\s+row\s+level|create\s+table)`
- rule: A new table that holds per-user rows enables row level security, a write policy carries `WITH CHECK` and not only `USING`, and no policy reads a claim the user can edit (`user_metadata`). A denied write returns zero rows without an error, so no error is not success.
- check: as user A insert a row owned by user B, update B's row and read B's rows; assert the row counts, not the absence of an error. Repro: the statements and the row that changed.

## Values and time

### exact-values: money, time and text lengths are computed in their own unit
- blocks: medium
- when: added `(price|amount|total|currency|money|setHours|getTimezoneOffset|86400|3600|toLocale|maxlength|substring\()`
- rule: Money is integer minor units or a decimal type, never a float. A day or a month is computed in the user's time zone with a calendar library, not as `24 * 3600` seconds, and a date-only string is not mixed with a date-time string (one parses as UTC, the other as local). A length limit counts what the limit means (characters a person sees), not UTF-16 units or bytes.
- check: price `0.1 + 0.2`, a day that crosses a daylight saving switch, a leap day and month end, and a name of emoji at the limit. Repro: the input and the wrong total, boundary or truncation.

## Streams and caches

### realtime-streams: a stream consumer keeps its frames whole and reconnects safely
- blocks: medium
- when: added `(text/event-stream|EventSource|new WebSocket|WebSocket\(|getReader\(|\.on\(['"]data['"])`
- rule: A consumer keeps a buffer across chunks (a frame can split mid-line), decodes UTF-8 as a stream, honours backpressure and a client disconnect, and surfaces a mid-stream error instead of treating it as the end. A reconnect backs off with jitter, checks the socket is open before it sends, queues or fails sends made meanwhile, and resumes from an id so no message repeats or is lost.
- check: split one multibyte character or one JSON line across two chunks, kill the connection mid-message, and drop the socket during a send. Repro: the chunks and the corrupted or lost message.

### service-worker-cache: a service worker never pins an old app
- blocks: high
- when: path `(^|/)(sw|service-?worker)[^/]*\.[jt]s$`
- when: added `(serviceWorker\.register|caches\.open)`
- find: `caches\.open\(\s*['"][^'"\d]+['"]\s*\)`
- rule: A service worker names its cache with a version, deletes the older caches when it activates, and serves HTML and `/api/` network first, so users do not keep a stale shell or stale signed-in data after a deploy.
- check: load v1, deploy v2 over it in the lpk Chrome, reload twice. Repro: the page that still serves v1.
