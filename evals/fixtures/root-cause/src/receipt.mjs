import { cartTotal } from './cart.mjs';

export const receiptTotal = (items) => 'Total: $' + cartTotal(items);
