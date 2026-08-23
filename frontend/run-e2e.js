// Fitness Tracker E2E Test Runner
// This script bypasses PowerShell execution policy issues

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function runCypress() {
  console.log('Starting Cypress E2E tests...');
  
  // Check if Cypress is available
  const cypressBin = path.join(__dirname, 'node_modules', '.bin', 'cypress.cmd');
  if (!fs.existsSync(cypressBin)) {
    console.error('ERROR: Cypress not found at', cypressBin);
    console.error('Available files in .bin:', fs.readdirSync(path.join(__dirname, 'node_modules', '.bin')).filter(f => f.includes('cypress')));
    process.exit(1);
  }
  
  // Run Cypress E2E tests
  const cypress = spawn(cypressBin, ['run', '--config', 'baseUrl=http://localhost:3000'], { stdio: 'inherit' });
  
  cypress.on('close', (code) => {
    console.log('Cypress tests completed with exit code:', code);
    process.exit(code);
  });
  
  cypress.on('error', (err) => {
    console.error('Failed to start Cypress:', err);
    process.exit(1);
  });
  
  // Handle process termination
  process.on('SIGINT', () => {
    console.log('\nTerminating Cypress...');
    cypress.kill('SIGINT');
    process.exit(130);
  });
}

// Run the tests
try {
  runCypress();
} catch (err) {
  console.error('Error running E2E tests:', err);
  process.exit(1);
}
