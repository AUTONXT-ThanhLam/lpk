import { follow } from '../follow.mjs';
import { parseArgs } from '../out.mjs';

const USAGE = 'usage: cc-switch run node <lpk>/bin/lpk follow-account [--except <session id>]';

export async function main(argv) {
  const a = parseArgs(argv, ['--except']);
  if (a.error || a.words.length) { console.error(`${a.error ? `lpk: ${a.error}\n` : ''}${USAGE}`); return 2; }
  try {
    return await follow({ except: a.opt('--except') });
  } catch (err) {
    console.error(`lpk: ${err.message}`);
    return 1;
  }
}
