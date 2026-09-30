$ErrorActionPreference = 'Stop'
$env:ADMIN_EMAIL = Read-Host 'Adresse e-mail du compte gestionnaire'
$secret = Read-Host 'Mot de passe gestionnaire (14 caractères minimum)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try { $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
$env:NODE_ENV = 'development'
node (Join-Path $PSScriptRoot 'server.mjs')

