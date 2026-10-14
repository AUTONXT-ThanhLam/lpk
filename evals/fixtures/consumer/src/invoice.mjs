import { formatPrice } from './money.mjs';

export const invoiceLine = (item) => `${item.name}: ${formatPrice(item.cents)}`;
