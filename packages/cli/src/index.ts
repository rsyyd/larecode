import { VERSION } from '@lumpscode/core';

const args = process.argv.slice(2);

if (args[0] === '--version' || args[0] === '-v') {
  console.log(VERSION);
  process.exit(0);
}

console.log(`lumpscode ${VERSION} — scaffold ready (T-01)`);
console.log('Configuration directory: ~/.lumpscode/');
console.log('Full CLI arrives with M1 tasks. See PRD.md for the roadmap.');
