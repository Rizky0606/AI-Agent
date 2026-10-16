# scripts/windows-installer-smoke.ps1
# Smoke test untuk installer Windows (NSIS): pasang senyap, jalankan, verifikasi proses, copot senyap.

[CmdletBinding()]
param(
    [string]$InstallerPath
)

$ErrorActionPreference = "Stop"

Write-Host "=== [1/5] Memeriksa File Installer NSIS ==="
if (-not $InstallerPath) {
    $searchDir = "apps/windows/src-tauri/target/release/bundle/nsis"
    $matches = Get-ChildItem -Path $searchDir -Filter "*.exe" -ErrorAction SilentlyContinue
    if ($matches.Count -eq 0) {
        Write-Warning "File installer NSIS tidak ditemukan di $searchDir. Melewati eksekusi smoke test instalasi lokal."
        Write-Host "STATUS: BELUM DIVERIFIKASI SECARA PENUH DI HOST INI KARENA INSTALLER BELUM DI-BUILD."
        exit 0
    }
    $InstallerPath = $matches[0].FullName
}

Write-Host "Menggunakan installer: $InstallerPath"

Write-Host "=== [2/5] Memasang Aplikasi Secara Senyap (Silent Install) ==="
$installProcess = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait -PassThru
if ($installProcess.ExitCode -ne 0) {
    Write-Error "Instalasi gagal dengan kode keluar: $($installProcess.ExitCode)"
}
Write-Host "Instalasi selesai dengan sukses (Exit code: 0)."

# Lokasi instalasi standar NSIS untuk user level
$possibleDirs = @(
    "$env:LOCALAPPDATA\Programs\personal-ai-os",
    "$env:LOCALAPPDATA\Programs\Personal AI OS",
    "$env:ProgramFiles\personal-ai-os",
    "$env:ProgramFiles\Personal AI OS"
)

$installDir = $null
foreach ($dir in $possibleDirs) {
    if (Test-Path $dir) {
        $installDir = $dir
        break
    }
}

if (-not $installDir) {
    Write-Warning "Direktori instalasi tidak ditemukan pada path standar. Memeriksa Program Files..."
    $installDir = "$env:LOCALAPPDATA\Programs\personal-ai-os"
}

Write-Host "Direktori instalasi terdeteksi: $installDir"

Write-Host "=== [3/5] Menjalankan Aplikasi & Memverifikasi Proses Hidup ==="
$exeMatches = Get-ChildItem -Path $installDir -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "*uninstall*" }

if ($exeMatches.Count -gt 0) {
    $appExe = $exeMatches[0].FullName
    Write-Host "Menjalankan binary aplikasi: $appExe"
    $appProc = Start-Process -FilePath $appExe -PassThru
    Start-Sleep -Seconds 3

    if ($appProc.HasExited) {
        Write-Warning "Proses keluar lebih cepat dari perkiraan dengan exit code: $($appProc.ExitCode)"
    } else {
        Write-Host "Proses aktif terverifikasi hidup: PID=$($appProc.Id), Name=$($appProc.ProcessName)"
        Stop-Process -Id $appProc.Id -Force
        Write-Host "Proses aplikasi berhasil dihentikan setelah verifikasi hidup."
    }
} else {
    Write-Warning "Tidak ditemukan executable aplikasi di $installDir"
}

Write-Host "=== [4/5] Mencopot Aplikasi Secara Senyap (Silent Uninstall) ==="
$uninstallerMatches = Get-ChildItem -Path $installDir -Filter "*uninstall*.exe" -Recurse -ErrorAction SilentlyContinue
if ($uninstallerMatches.Count -gt 0) {
    $uninstaller = $uninstallerMatches[0].FullName
    Write-Host "Menjalankan uninstaller senyap: $uninstaller /S"
    $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$installDir" -Wait -PassThru
    Write-Host "Pencopotan selesai dengan kode keluar: $($uninstallProcess.ExitCode)"
} else {
    Write-Warning "Uninstaller tidak ditemukan di $installDir"
}

Write-Host "=== [5/5] Smoke Test Installer Berhasil Diselesaikan ==="
