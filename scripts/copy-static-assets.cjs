const { cpSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');

for (const directory of ['portal/ui', 'dev/ui']) {
  const source = join(root, 'src', directory);
  const destination = join(root, 'dist', 'src', directory);
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
}

