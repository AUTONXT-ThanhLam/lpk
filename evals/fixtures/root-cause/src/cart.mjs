// items: [{ price, qty }], price in dollars
export function cartTotal(items) {
  return items.reduce((total, item) => total + item.price * item.qty, 0);
}
