// `lpk hook <name>`: every hook of the plugin, fed the hook's JSON on stdin, answering on stdout.
// A gate hook whose own code fails inside a run denies, naming the error and the owner's waiver as
// the way out, so a broken gate never passes what it guards; outside a run, and for every hint
// hook, a failure lets the call go on and says what is missing.
import { readFileSync, realpathSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lib = (m) => import(new URL(`../${m}.mjs`, import.meta.url));

// The safety tripwires on a tool call. The literal ones hold in every session; connector writes and
// the git tripwire hold for the session that holds a run, until the owner waives them.
async function pre(input) {
  const s = await lib('safety');
  const now = s.credentialTrip(input) || s.waiverTrip(input) || s.fileUrl(input) || s.writeGuard(input);
  if (now?.hookSpecificOutput?.permissionDecision === 'deny') return now;
  const tool = s.connectorTool(input.tool_name);
  const trip = s.gitTrip(input);
  if (tool || trip) {
    const { runOf } = await lib('hooks');
    const { waived, waiverHow } = await lib('waiver');
    const { run } = runOf(input, false);
    const id = tool ? `connector:${tool}` : `git:${trip}`;
    if (run && !(await waived(run, id))) {
      return s.deny(tool ? `\`${input.tool_name}\` changes what other people read in Jira or Confluence, and connector writes wait until the run ends. ${waiverHow(id)}`
        : `\`git ${trip}\` throws work away or skips the repo's checks, and this session holds an lpk run. This is a tripwire on that literal command, not a lock. ${waiverHow(id)}`);
    }
  }
  if (/^(Agent|Task)$/.test(input.tool_name || '') && [undefined, '', 'general-purpose', 'claude', 'lpk:builder'].includes(input.tool_input?.subagent_type)) {
    const early = (await lib('hooks')).spawnRule(input);
    if (early) return early;
  }
  return now || s.stripModel(input);
}

const NOBODY_ANSWERS = 'lpk: nobody answers a permission prompt raised inside a subagent, so this call was denied and did NOT run. '
  + 'Ask why the step needs it. If it is an rm on a shell variable, rewrite the target as "${VAR:?}" or a literal path and run it again. '
  + 'If the step is not needed, go on without it. Otherwise finish the rest and report what you wanted to run and why, so the lead decides.';

const unattended = (i) => (i.agent_id && i.permission_mode === 'bypassPermissions'
  ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: NOBODY_ANSWERS, interrupt: false } } }
  : null);

const HOOKS = {
  pre: { gate: true, run: pre },
  commit: { gate: true, run: async (i) => (await lib('hooks')).beforeCommit(i) },
  stamp: { gate: true, run: async (i) => (await lib('stamp')).stampHookOutput(i) },
  post: { run: async (i) => (await lib('hooks')).afterTool(i) },
  typecheck: { run: async (i) => (await lib('typecheck')).afterTsEdit(i) },
  trim: { run: async (i) => (await lib('trim')).trimBash(i) },
  subject: { run: async (i) => (await lib('hooks')).afterCommit(i) },
  stop: { run: async (i) => (await lib('hooks')).beforeStop(i) },
  start: { run: async (i) => (await lib('card')).resumeCard(i) },
  card: { run: async (i) => (await lib('card')).runCard(i) },
  prompt: { run: async (i) => (await lib('hooks')).onPrompt(i) },
  ask: { run: async (i) => unattended(i) },
  waive: {
    run: async (i) => {
      const w = await lib('waiver');
      const repo = (await lib('git')).top(i.cwd || '.');
      const run = w.waiverRun(i) || (repo ? (await lib('run')).runHere(repo) : null);
      const got = w.picks(i.tool_input, i.tool_response);
      const n = await w.recordWaiver(i, run);
      if (!n && got.length && !run && (await lib('run')).sessionRuns(i.session_id).length > 1) return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: "lpk: the owner's waiver was NOT recorded: this session holds several runs and the question was asked outside the repo of the run it belongs to. Ask again from inside that repo." } };
      return n ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `lpk: recorded the owner's waiver of ${got.map((p) => `\`${p.what}\``).join(', ')} for this run.` } } : null;
    },
  },
};

const CONTEXT_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'SessionStart', 'SubagentStart', 'UserPromptSubmit', 'Stop']);

// What a failed hook answers: a deny for a gate inside a run (unless the owner waived that hook in
// this run), else a note to the model that the hook's work is missing this time.
async function failed(name, input, e) {
  const err = String(e?.message || e).split('\n')[0].slice(0, 300);
  if (HOOKS[name].gate) {
    let run = null, inside = true;
    try {
      const h = await lib('hooks');
      inside = h.inRun(input);
      run = inside ? h.runOf(input, false).run : null;
    } catch { /* the run cannot be read either: treat the call as inside one */ }
    if (inside) {
      const id = `gate:${name}`;
      let ok = false;
      try { ok = Boolean(run) && await (await lib('waiver')).waived(run, id); } catch { /* no waiver readable */ }
      if (ok) return null;
      let how = '';
      try { how = (await lib('waiver')).waiverHow(id); } catch { how = `The owner can waive it with an AskUserQuestion whose metadata.source is "lpk:waive" and an option labelled exactly \`${id}\`.`; }
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `lpk: the ${name} gate failed (${err}), and inside an lpk run a gate that cannot decide denies. Fix the cause it names. ${how}` } };
    }
  }
  const event = input.hook_event_name;
  return CONTEXT_EVENTS.has(event) ? { hookSpecificOutput: { hookEventName: event, additionalContext: `lpk: the ${name} hook failed (${err}); what it adds is missing this time.` } } : null;
}

export async function main(argv) {
  const name = argv[0];
  if (!HOOKS[name]) {
    process.stderr.write(`usage: lpk hook ${Object.keys(HOOKS).join(' | ')}   (JSON on stdin)\n`);
    return 2;
  }
  let input = { cwd: process.cwd() };
  let out;
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    out = await HOOKS[name].run(input);
  } catch (e) {
    out = await failed(name, input, e);
  }
  // Written synchronously: the dispatcher exits right after this returns.
  if (out) writeSync(1, `${JSON.stringify(out)}\n`);
  return 0;
}

// hooks.json runs this file directly, so a hook loads only the modules it uses: a broken module
// elsewhere in the CLI never silences the safety hooks.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
