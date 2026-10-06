# Builds the Windows installer and publishes it as a GitHub release.
# Installed copies of Aion Books pick the new version up automatically.
#
# Before running: bump "version" in package.json (e.g. 1.2.0 -> 1.3.0),
# commit and push, and make sure you're signed in with `gh auth login`.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$gh = Get-Command gh -ErrorAction SilentlyContinue
$ghPath = if ($gh) { $gh.Source } else { 'C:\Program Files\GitHub CLI\gh.exe' }
if (-not (Test-Path $ghPath)) { throw 'GitHub CLI (gh) not found. Install it with: winget install GitHub.cli' }

$token = & $ghPath auth token
if (-not $token) { throw 'Not signed in to GitHub. Run: gh auth login' }
$env:GH_TOKEN = $token

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "Publishing Aion Books v$version ..."
npx electron-builder --win nsis --publish always
if ($LASTEXITCODE -ne 0) { throw "Build or upload failed (exit $LASTEXITCODE)" }
Write-Host "Done: https://github.com/TheGreatAion/aion-books/releases/tag/v$version"
