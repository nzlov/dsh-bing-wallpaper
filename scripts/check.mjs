import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = readdirSync(join(root, 'src'), { recursive: true })
  .filter(path => path.endsWith('.js'));
const files = sources.map(path => join('src', path));
files.push('dist/client.js', 'dist/sharp-renderer.js');
for (const file of files) {
  execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' });
}
