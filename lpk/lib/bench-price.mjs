const PER_MTOK = 1e6;
const FIVE_MINUTE_WRITE = 1.25;
const ONE_HOUR_WRITE = 2;

const FABLE_5_1 = { input: 10, output: 50, cacheRead: 0.25 };
const LIST_PRICE_USD_PER_MTOK = {
  'claude-fable-5-1': FABLE_5_1,
  'claude-mythos-5-1': FABLE_5_1,
  'claude-fable-5': { ...FABLE_5_1, cacheRead: 1 },
  'claude-mythos-5': { ...FABLE_5_1, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
};
const HAIKU_5_5 = [
  { upTo: 100000, input: 0.1, output: 0.5, cacheRead: 0.01 },
  { upTo: Infinity, input: 0.5, output: 2.5, cacheRead: 0.05 },
];

const priceOf = (model, prompt) => {
  const id = String(model || '').replace(/\[.*\]$/, '');
  if (id === 'claude-haiku-5-5') return HAIKU_5_5.find((tier) => prompt <= tier.upTo);
  return LIST_PRICE_USD_PER_MTOK[id] || null;
};

export function usdOf([input, cacheWrite, cacheRead, output, , model, hourWrite]) {
  const p = priceOf(model, input + cacheWrite + cacheRead);
  if (!p) return null;
  const hour = Math.min(hourWrite, cacheWrite);
  const writes = (cacheWrite - hour) * FIVE_MINUTE_WRITE + hour * ONE_HOUR_WRITE;
  return ((input + writes) * p.input + cacheRead * p.cacheRead + output * p.output) / PER_MTOK;
}
