#!/usr/bin/env pwsh
# Session start — load core context for the agent.
# Outputs markdown context to stdout. Run silently at conversation start.
#
# Usage: ./scripts/session-start.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillDir = Split-Path -Parent $scriptDir

# Run engram from the skill directory
Push-Location $skillDir

Write-Host "## Session Context"
Write-Host ""

# 1. Reflexes (if-X-do-Y rules, gotchas)
Write-Host "### Reflexes"
& node src/cli.js recall "reflexes gotchas bug patterns rules" -t reflex -b 1500 2>$null
Write-Host ""

# 2. Preferences (user environment, communication style)
Write-Host "### Preferences"
& node src/cli.js recall "user preferences environment communication IDE" -t preference -b 1000 2>$null
Write-Host ""

# 3. Active projects
Write-Host "### Active Projects"
& node src/cli.js recall "active projects current work stack status" -t fact -b 1500 2>$null

Pop-Location
