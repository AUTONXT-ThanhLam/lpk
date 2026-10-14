import { cartTotal } from './cart.mjs';

// Amount sent to the payment provider, in dollars.
export const chargeAmount = (items, taxRate) => cartTotal(items) * (1 + taxRate);
