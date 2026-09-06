import { readFileSync, writeFileSync } from 'node:fs';
const build = readFileSync('.next/BUILD_ID','utf8').trim();
const path = 'public/sw.js';
writeFileSync(path, readFileSync(path,'utf8').replace(/const SHELL = '[^']+';/, `const SHELL = 'mdg-shell-${build}';`));
