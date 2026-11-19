# Build the fork as its own unsigned Windows NSIS installer.
# Usage: pwsh -NoProfile -File scripts/build-local-windows.ps1
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This build script requires Windows.'
}

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$startedAt = Get-Date
# Tauri's NSIS downloader uses the Windows Known Folder even if LOCALAPPDATA
# is overridden. Do not touch a cache that belonged to another project.
$globalTauriCache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'tauri'
$globalTauriCacheExisted = Test-Path -LiteralPath $globalTauriCache
$config = Join-Path $root 'src-tauri/tauri.local-windows.conf.json'
$local = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
if ($local.identifier -ne 'app.beadbox.local' -or
    $local.bundle.createUpdaterArtifacts -ne $false -or
    @($local.plugins.updater.endpoints).Count -ne 0) {
    throw 'Local app identity or updater protection is missing from the Tauri config.'
}

# Prefer the Bun executable stored only in this project.
$localBunDir = Join-Path $root '.tools/bun'
if (Test-Path -LiteralPath (Join-Path $localBunDir 'bun.exe')) {
    $env:PATH = "$localBunDir;$env:PATH"
}

# Keep future Rust and Bun downloads inside this project, not the user's
# shared profile caches. Rust itself continues to use the existing toolchain.
$env:CARGO_HOME = Join-Path $root '.cargo-home'
$env:BUN_INSTALL_CACHE_DIR = Join-Path $root '.bun-cache'

# Tauri's NSIS packager normally puts its downloaded toolchain under the
# user's shared LOCALAPPDATA. Keep it in this project's ignored directory.
$env:LOCALAPPDATA = Join-Path $root '.local-appdata'
New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null

# rustup may be installed without its shims on the current PowerShell PATH.
$cargoBin = Join-Path $env:USERPROFILE '.cargo/bin'
if (-not (Get-Command cargo -ErrorAction SilentlyContinue) -and
    (Test-Path -LiteralPath (Join-Path $cargoBin 'cargo.exe'))) {
    $env:PATH = "$cargoBin;$env:PATH"
}
# Select MSVC only for this build; the user's default Rust toolchain is unchanged.
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'

$missing = @('bun', 'cargo', 'rustc', 'bash') | Where-Object {
    -not (Get-Command $_ -ErrorAction SilentlyContinue)
}
if ($missing.Count -gt 0) {
    throw "Missing build tools: $($missing -join ', '). Install Bun, Rust (MSVC toolchain) and Microsoft C++ Build Tools."
}

$hostTriple = (& rustc -vV | Select-String '^host: (.+)$').Matches.Groups[1].Value
if ($LASTEXITCODE -ne 0 -or $hostTriple -ne 'x86_64-pc-windows-msvc') {
    throw "This local build targets x86-64 Windows with the MSVC Rust toolchain (found: $hostTriple)."
}

Push-Location -LiteralPath $root
try {
    # Empty values override any production analytics configuration in .env.
    $env:VITE_POSTHOG_KEY = ''
    $env:VITE_POSTHOG_HOST = ''
    $env:POSTHOG_KEY = ''

    & bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'bun install failed.' }

    # Tauri merges the platform's tauri.windows.conf.json automatically.
    # --no-sign also avoids relying on developer signing certificates.
    & bun run tauri build --config $config --bundles nsis --no-sign --ci
    if ($LASTEXITCODE -ne 0) { throw 'Tauri Windows build failed.' }

    $bundleDir = Join-Path $root 'src-tauri/target/release/bundle/nsis'
    $installers = @(Get-ChildItem -LiteralPath $bundleDir -Filter '*-setup.exe' -File |
        Where-Object { $_.Name -like 'Beadbox Local_*' })
    if ($installers.Count -eq 0) {
        throw "Build finished, but no Beadbox Local installer was found under $bundleDir."
    }
    # Keep the installer outside Tauri's disposable target/ build directory.
    $releases = Join-Path $root 'releases'
    New-Item -ItemType Directory -Path $releases -Force | Out-Null
    $installers | ForEach-Object {
        $output = Join-Path $releases $_.Name
        Copy-Item -LiteralPath $_.FullName -Destination $output -Force
        Write-Host "Local Windows installer: $output"
    }
}
finally {
    Pop-Location
    if (-not $globalTauriCacheExisted -and (Test-Path -LiteralPath $globalTauriCache)) {
        try {
            $cache = Get-Item -LiteralPath $globalTauriCache
            if ($cache.CreationTime -ge $startedAt.AddSeconds(-2)) {
                Remove-Item -LiteralPath $globalTauriCache -Recurse -Force -ErrorAction Stop
                Write-Host 'Removed temporary system Tauri/NSIS cache; no shared cache was touched.'
            }
        }
        catch {
            Write-Warning "Could not clean temporary Tauri cache: $_"
        }
    }
}
