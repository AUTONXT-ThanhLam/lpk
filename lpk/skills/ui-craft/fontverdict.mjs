export function fontVerdict(stack, faces) {
  const generic = /^(system-ui|-apple-system|BlinkMacSystemFont|sans-serif|serif|monospace|ui-[a-z-]+|cursive|fantasy|Segoe UI|Roboto|Helvetica|Arial|Menlo|Consolas|SF Mono|SF Pro[A-Za-z ]*)$/i;
  const web = stack.split(',').map((n) => n.replace(/["']/g, '').trim()).filter((n) => n && !generic.test(n));
  if (web.length === 0) return 'system';
  const defined = (n) => faces.some((f) => f.family.replace(/["']/g, '') === n && f.status !== 'error');
  return web.every(defined) ? 'loaded' : 'NOT LOADED';
}
