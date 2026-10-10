# Builds the Windows installer and publishes it as a GitHub release.
# Installed copies of AionBooks pick the new version up automatically.
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
$tag = "v$version"

# Never publish a build that fails its tests: installed copies update themselves.
Write-Host "Running tests before releasing $tag ..."
npm test
if ($LASTEXITCODE -ne 0) { throw "Tests failed - not releasing $tag" }

# GitHub only accepts a published release for a tag that already exists, so tag
# the current commit and push the tag first (skipped if it's already there).
$git = Get-Command git -ErrorAction SilentlyContinue
$gitPath = if ($git) { $git.Source } else { 'C:\Program Files\Git\cmd\git.exe' }
& $gitPath fetch --tags --quiet origin
if (-not (& $gitPath tag --list $tag)) {
  & $gitPath tag $tag
  & $gitPath push origin $tag
  if ($LASTEXITCODE -ne 0) { throw "Couldn't push tag $tag" }
}

# Create the release up front. electron-builder uploads files in parallel, and
# if the release doesn't exist yet each upload can create its own copy.
# (gh reports "release not found" on stderr, which Windows PowerShell would
# otherwise treat as fatal under 'Stop'.)
$ErrorActionPreference = 'Continue'
& $ghPath release view $tag --repo TheGreatAion/aion-books *> $null
$exists = $LASTEXITCODE -eq 0
$ErrorActionPreference = 'Stop'
if (-not $exists) {
  & $ghPath release create $tag --repo TheGreatAion/aion-books --title "AionBooks $version" --notes "AionBooks $version"
  if ($LASTEXITCODE -ne 0) { throw "Couldn't create release $tag" }
}

Write-Host "Publishing AionBooks $tag ..."
npx electron-builder --win nsis --publish always
if ($LASTEXITCODE -ne 0) { throw "Build or upload failed (exit $LASTEXITCODE)" }
Write-Host "Done: https://github.com/TheGreatAion/aion-books/releases/tag/v$version"
