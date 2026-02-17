#!/usr/bin/env pwsh
# /remember helper — save a memory via engram CLI.
# Self-contained: resolves paths relative to the skill folder.
#
# Usage:
#   ./scripts/remember.ps1 -Type reflex -Title "Title" -Content "Content" [-Tags "a,b"] [-Permanent]
#
# Or call engram directly:
#   engram add reflex "Title" -c "Content" -t "tags" --permanent

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("reflex", "episode", "fact", "preference", "decision")]
    [string]$Type,

    [Parameter(Mandatory=$true)]
    [string]$Title,

    [Parameter(Mandatory=$false)]
    [string]$Content,

    [Parameter(Mandatory=$false)]
    [string]$Tags,

    [Parameter(Mandatory=$false)]
    [switch]$Permanent
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillDir = Split-Path -Parent $scriptDir

Push-Location $skillDir

$cmd = @("src/cli.js", "add", $Type, $Title)

if ($Content) {
    $cmd += @("-c", $Content)
}

if ($Tags) {
    $cmd += @("-t", $Tags)
}

if ($Permanent) {
    $cmd += "--permanent"
}

& node @cmd

Pop-Location
