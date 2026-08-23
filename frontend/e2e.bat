REM Fitness Tracker E2E Tests Runner
REM This script bypasses PowerShell execution policy issues

cd /d "%~dp0"

echo Starting Cypress E2E tests...

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is not available
    exit /b 1
)

REM Create and run a simple Node.js script that directly runs Cypress
(
echo const { spawn } = require('child_process');
echo console.log('Starting Cypress E2E tests...');
echo const cypress = spawn('cypress.cmd', ['run', '--config', 'baseUrl=http://localhost:3000'], { stdio: 'inherit' });
echo cypress.on('close', (code) => { console.log('Cypress tests completed with exit code:', code); process.exit(code); });
) > temp-cypress.js

node temp-cypress.js

if exist "temp-cypress.js" (
    del "temp-cypress.js"
)

exit /b %errorlevel%
