# lpk rules learned from defects found after the line was written

Rules and extra `when` and `find` lines learned from the tech lead's later reviews and from
audits of lpk itself, in the format `catalog.md` describes. A block under an id another file
already has holds only the extra lines.

### shared-state: state that concurrent processes share is owned, atomic and never silently replaced
- blocks: high
- when: added `(writeFileSync|fs\.writeFile|\.write_text\(|os\.WriteFile|fs::write|XDG_STATE_HOME|\.local/state|lockfile|\.pid\b|run\.json|marker)`
- rule: A file, marker, lock or directory that several processes, sessions or repos read is keyed to the owner it governs (one repo's state never gates another repo), written to a temporary name and renamed into place, and a second writer for another owner is refused with who holds it, never allowed to overwrite it.
- check: for each shared path, name its owner key, how it is written, and what a second writer or a reader mid-write sees. Repro: two processes (two sessions, two repos, a reader looping while a writer rewrites) and the wrong gate, lost state or half-read file.
Seen: lpk audit 2026-10-13 (a run in one repo blocked commits in another; non-atomic run.json read as "no run"; a second `run start` replaced another session's run)

### fail-closed
- when: added `(spawnSync\(|execFileSync\(|execSync\(|subprocess\.(run|check_output|Popen)\(|exec\.Command\(|Command::new\()`
- when: added `(expire|expiry|\bttl\b|stale)`
Seen: lpk audit 2026-10-13 (gitleaks missing let a push with a secret through; a run older than a day silently stopped gating)

### partial-write
- when: added `(paginate|per_page|page=|nextPageToken|cursor|--slurp)`
Seen: lpk audit 2026-10-13 (`reviews fetch` wrote nothing until every page was read; an interrupt lost minutes of fetching)

### engine-limits: numbers and arrays stay inside the runtime's limits
- blocks: medium
- when: added `(set(Timeout|Interval)\(|Math\.(max|min)\(|Number\.isInteger|\.\.\.[\w.]+\)|recurs|function\s+visit\b|def\s+visit\b)`
- find: `Math\.(max|min)\(\s*([\w.]+\s*,\s*)*\.\.\.`
- find: `\.push\(\s*\.\.\.`
- find: `String\.fromCharCode\(\s*\.\.\.`
- find: `\bNumber\.isInteger\(`
- rule: A value that reaches a runtime limit is kept inside it: a timer delay taken from input or props is clamped below 2^31-1 ms (above it `setTimeout` fires at once), an integer check uses `Number.isSafeInteger`, an array of unbounded length is never spread into a call's arguments (`Math.max(...a)`, `push(...a)`), and recursion whose depth follows the data is iterative or capped.
- check: feed each new timer a delay of 3e9 ms, each integer check 2^53+2, each spread a 200000-element array and each recursive walk a 10000-deep chain. Repro: the timer that fires at once, the value stored as the wrong type, or the `RangeError: Maximum call stack size exceeded`.
Seen: tech lead review

### keyboard-reachable: every pointer action has a keyboard path
- blocks: medium
- when: added `(\bon(Click|MouseDown|DoubleClick)=|onKeyDown=|tabIndex=|scrollIntoView|aria-activedescendant)`
- find: `<(td|tr|div|span|li)\b[^>]*\bonClick=`
- rule: Whatever a mouse can act on (a row, a cell, a card, a tab) is focusable and fires on Enter or Space; the element that takes focus by default is never a disabled control; and a highlight moved by the arrow keys is scrolled into view.
- check: on the page, reach and operate each new action with Tab, the arrow keys, Enter and Space only, with the selected item disabled and with more results than fit. Repro: the action no key fires, the strip the keyboard cannot enter, or the highlight out of sight.
Seen: tech lead review

### fault-isolation: one item's failure never stops the loop that serves the others
- blocks: high
- when: added `(while\s*\(?\s*(True|true|1)\b|\bfor\b.*\b(in|of)\b.*\b(cases|items|jobs|tasks|workers|clients|sessions|entries|batch)\b)`
- rule: A long-running loop that serves several cases, clients or jobs catches and logs the failure of one (setup, a file scan, a socket bind, `close()`, reload and shutdown included) and goes on with the others; a resource collision that is expected, such as a port only one case may bind, degrades that one case with a log line instead of dropping it or the process.
- check: for each call inside the loop and in its setup, reload and shutdown paths, ask what one failing item does to the rest. Repro: remove one item's file mid-scan, make its `close()` throw or start two cases on the same port, and show the other cases stop.
Seen: tech lead review

### exclusive-bind: a port one instance must own is bound exclusively
- blocks: medium
- when: added `(SO_REUSE(ADDR|PORT)|\.bind\(\(|createSocket\(|\.listen\(\s*\d)`
- find: `SO_REUSE(ADDR|PORT)`
- rule: A socket that one instance must own is bound without `SO_REUSEADDR` or `SO_REUSEPORT` on UDP (with them a second binder succeeds and the kernel delivers every datagram to the last one), so a collision raises and is reported, never shared silently.
- check: bind the port from two instances and send to it. Repro: both binds succeed and the first instance receives nothing with no log line.
Seen: tech lead review

### cross-thread-data: data a callback thread writes is locked or copied before it is read
- blocks: high
- when: added `(threading\.|\bThread\(|\.listen\(\s*(lambda\b|self\._?\w+\)|_\w+\()|add_done_callback|call_soon_threadsafe|\bgo\s+func\b|std::thread)`
- rule: A dict, list or map that a callback, sensor or worker thread writes is read under the same lock or from a snapshot taken under it, never iterated live while that thread can insert.
- check: for each structure a new callback writes, name the lock its readers hold. Repro: fire the callback in a tight loop while the reader iterates, and show `dictionary changed size during iteration` or the concurrent-map fault.
Seen: tech lead review

### rights-revocation: a removed right also ends the credentials issued with it
- blocks: high
- when: added `\b(is_?admin|isAdmin|role_?(assignment|permission|id)s?|permissions?|unassign\w*|revoke\w*|deactivat\w*|demot\w*|grant\w*)\b`
- rule: When a right is taken away (admin switched off, a role unassigned, a team left, a permission removed from a role, a role or permission deleted, an account deactivated), the refresh tokens of everyone it affected are revoked on every path that can remove it (API, script, seed, trigger), and tokens already issued carry a version that services compare so an older one is refused.
- check: list every path that removes a right and the token revocation each one runs; sign in, remove the right through each path, then refresh and call another service with the old token. Repro: the call that still succeeds with the removed right.
Seen: tech lead review

### migration-history: fresh and upgraded databases end at the same schema
- blocks: high
- when: path `(^|/)migrations?/`
- rule: A migration that may already have run anywhere is not edited to change the schema; the change goes in a new migration, so a database built fresh from the branch and one upgraded from main end with the same tables, constraints and indexes.
- check: `git diff --name-status <base> -- '*migrations*'` lists each existing migration the change modifies (status M or R); for each, build one database from main then migrate to the branch, build another fresh from the branch, and diff the two schema dumps. Repro: the constraint or column present in one and missing in the other.
Seen: tech lead review
