import { expect, load } from './lib.mjs';
export default async function (ws) {
  const f = [];
  const money = await load(ws, 'src/money.mjs');
  const report = await load(ws, 'src/report.mjs');
  await expect(f, 'thousands separator', () => money.formatPrice(123456) === '$1,234.56' || money.formatPrice(123456));
  await expect(f, 'small amounts unchanged', () => money.formatPrice(5) === '$0.05' || money.formatPrice(5));
  await expect(f, 'report total still adds up', () => { const s = report.summary([{ name: 'A', cents: 123456 }, { name: 'B', cents: 100 }]); return s.total === '$1,235.56' || s.total; });
  return f;
}
