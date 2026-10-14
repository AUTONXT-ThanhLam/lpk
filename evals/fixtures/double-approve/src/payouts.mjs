// Stand-in for the bank API.
export const sent = [];

export async function pay(requestId, amount) {
  sent.push({ requestId, amount });
}
