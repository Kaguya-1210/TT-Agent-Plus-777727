#requires -Version 5.1
<#
.SYNOPSIS
  Hot update TT-Agent-Plus-727 into the local TauriTavern extension folder.
.DESCRIPTION
  Copies the current working tree files directly into TauriTavern's installed
  extension directory, so UI/debug changes can be tested without publishing
  the branch or pressing TT's extension update button.
.USAGE
  npm run hot:update
  npm run hot:update:dry
  powershell -ExecutionPolicy Bypass -File scripts/hot-update.ps1 -DryRun
  powershell -ExecutionPolicy Bypass -File scripts/hot-update.ps1 -TargetPath F:\Dev\Data\default-user\extensions\TT-Agent-Plus-777727
  powershell -ExecutionPolicy Bypass -File scripts/hot-update.ps1 -Prune
#>
[CmdletBinding()]
param(
  [string]$TargetPath = '',
  [switch]$DryRun,
  [switch]$Prune
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedDisplayName = 'TT-Agent-Plus-727'
$ExpectedFolderName = 'TT-Agent-Plus-777727'
$ExpectedInstallSuffix = Join-Path (Join-Path 'default-user' 'extensions') $ExpectedFolderName
$RuntimeRelativePath = Join-Path 'com.tauritavern.client' 'tauritavern-runtime.json'
$SyncItems = @(
  'manifest.json',
  'index.js',
  'style.css',
  'package.json',
  'README.md',
  '.gitignore',
  'src',
  'scripts',
  'docs',
  'tests'
)

$script:CopiedFiles = 0
$script:CreatedDirectories = 0
$script:PrunedItems = 0

function Write-TtapInfo {
  param([string]$Message)
  Write-Host "[TTAP] $Message"
}

function Get-FullPathSafe {
  param([string]$Path)
  return [System.IO.Path]::GetFullPath($Path)
}

function Resolve-RepoRoot {
  $root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')
  $rootPath = $root.Path
  foreach ($required in @('manifest.json', 'index.js', 'style.css', 'src')) {
    $candidate = Join-Path $rootPath $required
    if (-not (Test-Path -LiteralPath $candidate)) {
      throw "Source is not a TT-Agent-Plus-727 repo root. Missing: $candidate"
    }
  }
  return $rootPath
}

function Assert-SourceManifest {
  param([string]$RepoRoot)
  $manifestPath = Join-Path $RepoRoot 'manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.display_name -ne $ExpectedDisplayName) {
    throw "Unexpected manifest display_name: $($manifest.display_name). Expected: $ExpectedDisplayName"
  }
}

function Resolve-TauriTavernInstallPath {
  param([string]$ExplicitTargetPath)

  if (-not [string]::IsNullOrWhiteSpace($ExplicitTargetPath)) {
    return Get-FullPathSafe $ExplicitTargetPath
  }

  if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
    throw 'APPDATA is empty. Pass -TargetPath explicitly.'
  }

  $runtimePath = Join-Path $env:APPDATA $RuntimeRelativePath
  if (-not (Test-Path -LiteralPath $runtimePath)) {
    throw "Cannot find tauritavern-runtime.json: $runtimePath. Pass -TargetPath explicitly."
  }

  $runtime = Get-Content -LiteralPath $runtimePath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace($runtime.data_root)) {
    throw "tauritavern-runtime.json has no data_root: $runtimePath"
  }

  return Get-FullPathSafe (Join-Path $runtime.data_root $ExpectedInstallSuffix)
}

function Assert-SafeTargetPath {
  param(
    [string]$RepoRoot,
    [string]$ResolvedTargetPath
  )

  $normalizedRepo = (Get-FullPathSafe $RepoRoot).TrimEnd('\', '/')
  $normalizedTarget = (Get-FullPathSafe $ResolvedTargetPath).TrimEnd('\', '/')
  $normalizedSuffix = $ExpectedInstallSuffix.Replace('/', '\')

  if ($normalizedTarget -eq $normalizedRepo) {
    throw 'Refusing to hot update into the source repo root.'
  }

  if (-not $normalizedTarget.EndsWith($normalizedSuffix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside a TT-Agent install folder. Target must end with: $normalizedSuffix. Actual: $normalizedTarget"
  }
}

function Ensure-Directory {
  param([string]$Path)

  if (Test-Path -LiteralPath $Path) {
    return
  }

  if ($DryRun) {
    Write-TtapInfo "DRY create directory: $Path"
    return
  }

  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  $script:CreatedDirectories += 1
}

function Remove-StaleItem {
  param([string]$Path)

  if ($DryRun) {
    Write-TtapInfo "DRY prune: $Path"
    return
  }

  Remove-Item -LiteralPath $Path -Recurse -Force
  $script:PrunedItems += 1
}

function Sync-DirectoryContents {
  param(
    [string]$SourceDirectory,
    [string]$DestinationDirectory
  )

  Ensure-Directory $DestinationDirectory

  if ($Prune -and (Test-Path -LiteralPath $DestinationDirectory)) {
    foreach ($destinationChild in Get-ChildItem -LiteralPath $DestinationDirectory -Force) {
      $matchingSource = Join-Path $SourceDirectory $destinationChild.Name
      if (-not (Test-Path -LiteralPath $matchingSource)) {
        Remove-StaleItem $destinationChild.FullName
      }
    }
  }

  foreach ($sourceChild in Get-ChildItem -LiteralPath $SourceDirectory -Force) {
    $destinationChild = Join-Path $DestinationDirectory $sourceChild.Name
    Sync-Item -SourcePath $sourceChild.FullName -DestinationPath $destinationChild
  }
}

function Sync-File {
  param(
    [string]$SourceFile,
    [string]$DestinationFile
  )

  $destinationParent = Split-Path -Parent $DestinationFile
  Ensure-Directory $destinationParent

  if ($DryRun) {
    Write-TtapInfo "DRY copy: $SourceFile -> $DestinationFile"
    return
  }

  Copy-Item -LiteralPath $SourceFile -Destination $DestinationFile -Force
  $script:CopiedFiles += 1
}

function Sync-Item {
  param(
    [string]$SourcePath,
    [string]$DestinationPath
  )

  if (Test-Path -LiteralPath $SourcePath -PathType Container) {
    Sync-DirectoryContents -SourceDirectory $SourcePath -DestinationDirectory $DestinationPath
    return
  }

  Sync-File -SourceFile $SourcePath -DestinationFile $DestinationPath
}

$repoRoot = Resolve-RepoRoot
Assert-SourceManifest -RepoRoot $repoRoot
$targetRoot = Resolve-TauriTavernInstallPath -ExplicitTargetPath $TargetPath
Assert-SafeTargetPath -RepoRoot $repoRoot -ResolvedTargetPath $targetRoot

Write-TtapInfo "Source: $repoRoot"
Write-TtapInfo "Target: $targetRoot"
if ($DryRun) { Write-TtapInfo 'Mode: dry-run, no files will be changed.' }
if ($Prune) { Write-TtapInfo 'Mode: prune stale files inside synced folders.' }

Ensure-Directory $targetRoot
foreach ($item in $SyncItems) {
  $sourcePath = Join-Path $repoRoot $item
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Missing source item: $sourcePath"
  }
  $destinationPath = Join-Path $targetRoot $item
  Sync-Item -SourcePath $sourcePath -DestinationPath $destinationPath
}

Write-TtapInfo "Done. files copied=$script:CopiedFiles, directories created=$script:CreatedDirectories, pruned=$script:PrunedItems"
Write-TtapInfo 'Refresh TauriTavern with Ctrl+R, or reopen the app if the extension runtime cached old files.'
