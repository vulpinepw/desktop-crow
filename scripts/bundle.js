'use strict';

const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const entries = {
  overlay: 'src/renderer/overlay.js',
  setup: 'src/renderer/setup.js',
  settings: 'src/renderer/settings.js',
  rename: 'src/renderer/rename.js',
  qa: 'scripts/qa/qa-page.js',
  turntable: 'scripts/qa/turntable-page.js',
  icons: 'scripts/qa/icons-page.js',
};

async function main() {
  const only = process.argv.slice(2);
  const fs = require('fs');
  const list = Object.entries(entries).filter(([name, file]) => (!only.length || only.includes(name)) && fs.existsSync(path.join(root, file)));
  await Promise.all(
    list.map(([name, file]) =>
      esbuild.build({
        entryPoints: [path.join(root, file)],
        outfile: path.join(root, 'app-dist', `${name}.bundle.js`),
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: ['chrome130'],
        sourcemap: false,
        minify: false,
        minifyWhitespace: true,
        legalComments: 'none',
        logLevel: 'warning',
      })
    )
  );
  console.log(`bundled: ${list.map(([n]) => n).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
