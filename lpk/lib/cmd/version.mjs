// `lpk version`: the plugin version this CLI belongs to.
import { readFileSync } from 'node:fs';

export function main() {
  console.log(JSON.parse(readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version);
  return 0;
}
