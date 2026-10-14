import { expect, load } from './lib.mjs';
export default async function (ws) {
  const f = [];
  const items = [{ price: 0.1, qty: 1 }, { price: 0.2, qty: 1 }];
  const { receiptTotal } = await load(ws, 'src/receipt.mjs');
  const { chargeAmount } = await load(ws, 'src/tax.mjs');
  await expect(f, 'receipt shows $0.30', () => receiptTotal(items) === 'Total: $0.30' || receiptTotal(items));
  await expect(f, 'the payment amount is exact too', () => chargeAmount([{ price: 0.1, qty: 3 }], 0) === 0.3 || chargeAmount([{ price: 0.1, qty: 3 }], 0));
  await expect(f, 'whole amounts still work', () => receiptTotal([{ price: 2, qty: 3 }]) === 'Total: $6.00' || receiptTotal([{ price: 2, qty: 3 }]));
  return f;
}
