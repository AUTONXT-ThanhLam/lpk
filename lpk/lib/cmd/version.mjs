// `lpk version`: the plugin version this CLI belongs to, from the manifest of the plugin the host
// launched (lib/host.mjs), which is this tree when lpk runs from its checkout.
import { readFileSync } from 'node:fs';
import { pluginManifest } from '../host.mjs';

export function main() {
  console.log(JSON.parse(readFileSync(pluginManifest(), 'utf8')).version);
  return 0;
}
