@echo off
cd /d "%~dp0"

:: Fitness Tracker E2E Tests Runner
:: This script bypasses PowerShell execution policy issues

echo Starting Cypress E2E tests...

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is not available
    exit /b 1
)

where npx >nul 2>nul
if errorlevel 1 (
    echo ERROR: npx is not available
    exit /b 1
)

:: Check if Cypress is available
if not exist "node_modules\cypress" (
    echo ERROR: Cypress not found in node_modules
    echo Installing Cypress dependencies...
    npm install >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Failed to install dependencies
        exit /b 1
    )
)

:: Run Cypress E2E tests
npx cypress run --config baseUrl=http://localhost:3000

exit /b %errorlevel%
