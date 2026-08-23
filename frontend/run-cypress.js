#!/usr/bin/env node
const { spawn } = require('child_process');
console.log('Starting Cypress E2E tests...');
const cypress = spawn('cypress', ['run', '--config', 'baseUrl=http://localhost:3000'], { stdio: 'inherit' });
cypress.on('close', (code) => {
  console.log('Cypress tests completed with exit code:', code);
  process.exit(code);
});
