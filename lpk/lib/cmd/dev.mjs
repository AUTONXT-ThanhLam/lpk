const SUBS = {
  'bench': 'what the recorded runs cost and found',
  'meter': 'tokens per agent of one session',
  'escapes': 'review comments that reached PRs after delivery',
};

export const MOVED = Object.keys(SUBS);

export async function main(argv) {
  const [sub, ...rest] = argv;
  if (!Object.hasOwn(SUBS, sub)) {
    console.error(`usage: lpk dev <${MOVED.join('|')}> ...\n${MOVED.map((k) => `  lpk dev ${k}: ${SUBS[k]}`).join('\n')}`);
    return 2;
  }
  return (await import(`../dev/${sub}.mjs`)).main(rest);
}
