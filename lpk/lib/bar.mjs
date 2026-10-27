export const BARS = ['increment', 'production'];
export const isIncrement = (run) => run?.bar === 'increment';
export const barFor = (open, asked) => (asked === 'production' ? 'production' : open ? open.bar : 'increment');
