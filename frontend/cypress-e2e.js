#!/usr/bin/env node
console.log("Starting Cypress E2E tests...");

const { spawn } = require('child_process');
const cypress = spawn('cypress', ['run', '--config', 'baseUrl=http://localhost:3000'], { stdio: 'inherit' });

cypress.on('close', (code) => {
  console.log('Cypress tests completed with exit code:', code);
  process.exit(code);
});
