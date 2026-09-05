# Authenticode signing, when there is a certificate to sign with.
#
# `bundle.windows.signCommand` in tauri.conf.json points at this file, so the
# bundler runs it once per binary it produces — the app, the Node sidecar and
# the NSIS installer — with the file's path as the only argument.
#
# It exists because of what a certificate is: not a setting, but a private key
# that belongs to whoever is publishing the app. It cannot live in this
# repository, it cannot be generated (a certificate you made yourself signs
# nothing anybody's computer will trust, and calling that "signed" is worse
# than being plainly unsigned), and it must not be a reason the build fails on
# a machine that does not have one. So the certificate arrives through the
# environment, and this script has exactly two behaviours:
#
#   nothing configured  -> say so, once per file, and leave the file alone.
#   configured          -> sign, and FAIL THE BUILD if signing does not work.
#
# The second half is the important one. A build that thinks it signed and did
# not is the one outcome worse than an unsigned build, because the installer
# then ships looking exactly like the signed one.
#
# What to set, on the machine that publishes releases:
#
#   CONTENTOS_SIGN_THUMBPRINT      the SHA1 thumbprint of a code signing
#                                  certificate in this user's certificate
#                                  store. This is the shape an EV or hardware
#                                  token certificate takes — the key never
#                                  leaves the token, so there is no file.
#   CONTENTOS_SIGN_PFX             …or the path to a .pfx, for a certificate
#   CONTENTOS_SIGN_PFX_PASSWORD    that is a file. Prefer the thumbprint.
#   CONTENTOS_SIGN_TIMESTAMP_URL   an RFC3161 timestamp server. Defaults to
#                                  DigiCert's. Timestamping is not optional in
#                                  practice: without it every signature stops
#                                  verifying the day the certificate expires,
#                                  including on installers already downloaded.
#   CONTENTOS_SIGN_TOOL            signtool.exe, when it is not found below.

param([Parameter(Mandatory = $true)][string]$File)

$ErrorActionPreference = "Stop"

$thumbprint = $env:CONTENTOS_SIGN_THUMBPRINT
$pfx = $env:CONTENTOS_SIGN_PFX

if (-not $thumbprint -and -not $pfx) {
    Write-Host "sign.ps1: no certificate configured, so $(Split-Path -Leaf $File) is unsigned. Windows SmartScreen will warn the people who install it. Set CONTENTOS_SIGN_THUMBPRINT (or CONTENTOS_SIGN_PFX) to sign."
    exit 0
}

# signtool ships with the Windows SDK and is not on PATH by default. The SDK
# installs one per version, so the newest is taken rather than the first found.
$tool = $env:CONTENTOS_SIGN_TOOL
if (-not $tool) {
    $tool = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}
if (-not $tool) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
    $tool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\$arch\signtool.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $tool) {
    throw "A certificate is configured but signtool.exe is not here. Install the Windows SDK's signing tools, or set CONTENTOS_SIGN_TOOL to signtool.exe."
}

$timestamp = $env:CONTENTOS_SIGN_TIMESTAMP_URL
if (-not $timestamp) { $timestamp = "http://timestamp.digicert.com" }

$signArgs = @("sign", "/fd", "sha256", "/td", "sha256", "/tr", $timestamp)
if ($thumbprint) {
    $signArgs += @("/sha1", $thumbprint)
} else {
    if (-not (Test-Path $pfx)) { throw "CONTENTOS_SIGN_PFX points at $pfx, which is not there." }
    $signArgs += @("/f", $pfx)
    if ($env:CONTENTOS_SIGN_PFX_PASSWORD) { $signArgs += @("/p", $env:CONTENTOS_SIGN_PFX_PASSWORD) }
}
$signArgs += $File

& $tool @signArgs
if ($LASTEXITCODE -ne 0) {
    # Loudly, and fatally. See the note at the top: an installer that was not
    # signed must never leave this machine believing it was.
    throw "signtool refused to sign $File (exit $LASTEXITCODE)."
}
Write-Host "sign.ps1: signed $(Split-Path -Leaf $File)."
