import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LAUNCHER = (node) => `using System;
using System.Diagnostics;
using System.IO;
static class Stub {
  static int Main() {
    string line = Environment.CommandLine;
    int i = 0;
    if (line.Length > 0 && line[0] == '"') { i = line.IndexOf('"', 1); i = i < 0 ? line.Length : i + 1; }
    else { while (i < line.Length && !char.IsWhiteSpace(line[i])) i++; }
    string tail = line.Substring(i).TrimStart(' ');
    string script = Path.ChangeExtension(Process.GetCurrentProcess().MainModule.FileName, ".mjs");
    ProcessStartInfo psi = new ProcessStartInfo(@"${node.replaceAll('"', '""')}", "\\"" + script + "\\" " + tail);
    psi.UseShellExecute = false;
    using (Process p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode; }
  }
}
`;

let launcher;
function launcherExe() {
  if (launcher) return launcher;
  const dir = mkdtempSync(join(tmpdir(), 'lpk-stub-'));
  const windir = process.env.windir || 'C:\\Windows';
  const csc = ['Framework64', 'Framework'].map((f) => join(windir, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find(existsSync);
  if (!csc) throw new Error('no .NET Framework csc.exe found: a Windows stub executable cannot be built');
  writeFileSync(join(dir, 'launcher.cs'), LAUNCHER(process.execPath));
  execFileSync(csc, ['/nologo', '/target:exe', `/out:${join(dir, 'launcher.exe')}`, join(dir, 'launcher.cs')], { stdio: ['ignore', 'pipe', 'pipe'] });
  launcher = join(dir, 'launcher.exe');
  return launcher;
}

export function stubBin(dir, name, source) {
  const body = source.replace(/^#!.*\n/, '');
  if (process.platform !== 'win32') {
    const bin = join(dir, name);
    writeFileSync(bin, `#!/usr/bin/env node\n${body}`);
    chmodSync(bin, 0o755);
    return bin;
  }
  writeFileSync(join(dir, `${name}.mjs`), body);
  copyFileSync(launcherExe(), join(dir, `${name}.exe`));
  return join(dir, `${name}.exe`);
}
