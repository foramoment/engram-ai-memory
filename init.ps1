# =============================================================================
# Project: Engram — Cognitive Memory System
# Description: Development environment initialization script (Windows)
# =============================================================================

$ErrorActionPreference = "Stop"

Write-Host "🧠 Starting Engram development environment..." -ForegroundColor Cyan

# --- Node.js Dependency Installation ---
if (Test-Path "package.json") {
    Write-Host "📦 Installing Node.js dependencies..." -ForegroundColor Yellow
    npm install
} else {
    Write-Host "⚠️ package.json not found!" -ForegroundColor Red
    exit 1
}

# --- Create data directory ---
if (-not (Test-Path "data")) {
    Write-Host "📁 Creating data directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path "data" | Out-Null
}

# --- Run Tests ---
Write-Host "🧪 Running tests..." -ForegroundColor Yellow
npm test

Write-Host ""
Write-Host "✅ Development environment ready!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Quick Reference:" -ForegroundColor Cyan
Write-Host "   - Progress Log: claude-progress.txt"
Write-Host "   - Feature List: feature_list.json"
Write-Host "   - Run tests:    npm test"
Write-Host "   - Continue:     /continue"
Write-Host "   - CLI:          node src/cli.js --help"
