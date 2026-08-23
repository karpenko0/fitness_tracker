$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process

Write-Host "Starting Fitness Tracker E2E Tests..."

$frontendPath = "frontend"
if (-not (Test-Path "frontend/node_modules/.bin/cypress.cmd")) {
    Write-Host "ERROR: Cypress not found at frontend/node_modules/.bin/cypress.cmd"
    exit 1
}

# Run Cypress E2E tests
Write-Host "Running Cypress E2E tests..."
try {
    $cypress = Start-Process -FilePath "frontend/node_modules/.bin/cypress.cmd" -ArgumentList "run", "--config", "baseUrl=http://localhost:3000" -Wait -PassThru
    exit $cypress.ExitCode
} catch {
    Write-Host "ERROR: Failed to run Cypress tests: $_"
    exit 1
}
