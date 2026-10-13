# Builds the Windows installer and publishes it as a GitHub release.
# Installed copies of AionBooks pick the new version up automatically.
# Once the release is up, GitHub Actions adds the Linux builds to it
# (.github/workflows/release-linux.yml); the script waits for them and says
# whether they made it.
#
# Before running: bump the version (`npm version 1.3.0 --no-git-tag-version`,
# which also updates the website), write what's new in release-notes/<version>.md,
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

# A release goes out with its notes or not at all: they're what people read
# before they update.
$notes = "release-notes/$version.md"
if (-not (Test-Path $notes) -or -not (Get-Content $notes -Raw).Trim()) {
  throw "No release notes - write what's new in $notes first"
}
if ((Get-Content $notes -Raw -Encoding UTF8).Contains([char]0x2014)) { throw "$notes has an em dash - use a comma, colon or parentheses" }

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
  & $ghPath release create $tag --repo TheGreatAion/aion-books --title "AionBooks $version" --notes-file $notes
  if ($LASTEXITCODE -ne 0) { throw "Couldn't create release $tag" }
} else {
  & $ghPath release edit $tag --repo TheGreatAion/aion-books --title "AionBooks $version" --notes-file $notes | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Couldn't update the notes on $tag" }
}

Write-Host "Publishing AionBooks $tag ..."
npx electron-builder --win nsis --publish always
if ($LASTEXITCODE -ne 0) { throw "Build or upload failed (exit $LASTEXITCODE)" }
Write-Host "Windows installer is up: https://github.com/TheGreatAion/aion-books/releases/tag/$tag"

# Publishing the release started the Linux build on GitHub Actions. Wait for it
# and make sure its files landed: installed AppImages update from latest-linux.yml.
# The run can take a few seconds to show up. (gh prints progress on stderr, which
# Windows PowerShell would otherwise treat as fatal under 'Stop'.)
$ErrorActionPreference = 'Continue'
$rerun = "gh workflow run release-linux.yml -f tag=$tag"
Write-Host "Waiting for the Linux build ..."
$runUrl = $null
for ($i = 0; $i -lt 24 -and -not $runUrl; $i++) {
  if ($i) { Start-Sleep -Seconds 5 }
  $runUrl = & $ghPath run list --repo TheGreatAion/aion-books --workflow release-linux.yml --event release --branch $tag --limit 1 --json url --jq '.[].url' 2> $null
}
if (-not $runUrl) {
  Write-Host "Linux build FAILED: no 'Linux release' run started for $tag." -ForegroundColor Red
  Write-Host "Start it with: $rerun"
  exit 1
}

& $ghPath run watch $runUrl.Split('/')[-1] --repo TheGreatAion/aion-books --exit-status --compact --interval 10
$built = $LASTEXITCODE -eq 0
$assets = @(& $ghPath release view $tag --repo TheGreatAion/aion-books --json assets --jq '.assets[].name' 2> $null)
$missing = @("AionBooks-$version.AppImage", "AionBooks-$version.deb", 'latest-linux.yml') | Where-Object { $assets -notcontains $_ }

if ($built -and -not $missing) {
  Write-Host "Done: AionBooks $tag is out for Windows and Linux: https://github.com/TheGreatAion/aion-books/releases/tag/$tag" -ForegroundColor Green
} else {
  $why = if (-not $built) { 'the run failed' } else { "the release is missing $($missing -join ', ')" }
  Write-Host "Linux build FAILED for ${tag}: $why." -ForegroundColor Red
  Write-Host "Run: $runUrl"
  Write-Host "Fix it, then rerun with: $rerun"
  exit 1
}
