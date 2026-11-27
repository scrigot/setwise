import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const output = 'dist/phone';
execFileSync('npx', ['--no-install', 'expo', 'export', '--platform', 'web', '--output-dir', output], { stdio: 'inherit' });
const index = output + '/index.html';
const html = readFileSync(index, 'utf8').replace(/<title>.*?<\/title>/s, '');
const head = [
  '<title>Setwise</title>',
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="/setwise-icon.png">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Setwise">',
  '<meta name="theme-color" content="#121212">'
].join('\n');
writeFileSync(index, html.replace('</head>', head + '\n</head>'));
