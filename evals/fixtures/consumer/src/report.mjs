import { formatPrice } from './money.mjs';
import { invoiceLine } from './invoice.mjs';

// Totals are recomputed from the printed lines, which are what the customer signed off.
export function totalFromLines(lines) {
  return lines.reduce((sum, line) => {
    const m = line.match(/\$(\d+)\.(\d{2})$/);
    return m ? sum + Number(m[1]) * 100 + Number(m[2]) : sum;
  }, 0);
}

export function summary(items) {
  const lines = items.map(invoiceLine);
  return { lines, total: formatPrice(totalFromLines(lines)) };
}
