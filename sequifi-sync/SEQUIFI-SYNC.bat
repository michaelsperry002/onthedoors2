@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$m=':'+':'+':PWSH:'+':'+':'; $s=[IO.File]::ReadAllText('%~f0'); iex $s.Substring($s.IndexOf($m)+$m.Length)"
exit /b
:::PWSH:::
$ErrorActionPreference='Stop'
try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 } catch {}
Write-Host ''
Write-Host '  ===================================================='
Write-Host '    SYNC MY SEQUIFI SALES'
Write-Host '  ===================================================='
Write-Host ''
$email = Read-Host '  Sequifi Email'
$sec   = Read-Host '  Sequifi Password (it stays hidden as you type)' -AsSecureString
$pass  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$api   = 'https://momentum.api.sequifi.com/public/api'
Write-Host ''
Write-Host '  Connecting to Sequifi...'
try {
  $login = Invoke-RestMethod -Uri "$api/login" -Method Post -ContentType 'application/json' -Body (@{email=$email;password=$pass} | ConvertTo-Json)
} catch {
  Write-Host ''
  Write-Host '  Could not reach Sequifi. Check your internet and try again.'
  Read-Host '  Press Enter to close'; exit
}
$token = $login.token
if (-not $token) { Write-Host ''; Write-Host '  Wrong email or password. Try again.'; Read-Host '  Press Enter to close'; exit }
Write-Host ('  Logged in as ' + $login.data.first_name + '!')
$headers = @{ Authorization = "Bearer $token" }
$all = @()
$page = 1; $last = 1
do {
  $body = @{ page=$page; per_page=100; filter='last_12_months' } | ConvertTo-Json
  $res  = Invoke-RestMethod -Uri "$api/v2/sales/my-sales-list" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
  $block = $res.data
  if ($block.data) { $all += $block.data }
  if ($block.last_page) { $last = [int]$block.last_page }
  Write-Host ("  Loaded page $page of $last")
  $page++
} while ($page -le $last)
function MapStatus($r) {
  $s = (('' + $r.job_status + ' ' + $r.external_job_status)).ToLower()
  if ($r.date_cancelled -or $s.Contains('cancel')) { return 'cancelled' }
  if ($s.Contains('complete') -or $s.Contains('serviced') -or $s.Contains('install')) { return 'serviced' }
  if ($s.Contains('active')) { return 'active' }
  if ($s.Contains('pending') -or $s.Contains('inactive')) { return 'pending' }
  return 'sold'
}
function ContractValue($r) {
  foreach ($f in @($r.kw, $r.gross_account_value, $r.net_epc, $r.initial_service_cost)) {
    if ($f -ne $null -and ([double]$f) -ne 0) { return [double]$f }
  }
  return 0
}
$accounts = foreach ($r in $all) {
  [pscustomobject]@{
    id                 = 'sq_' + $r.pid
    customer_name      = [string]$r.customer_name
    address            = [string]$r.state
    contract_value     = (ContractValue $r)
    status             = (MapStatus $r)
    sale_date          = ''
    install_date       = ''
    sequifi_commission = [double]($r.total_commission)
    sequifi_projected  = [double]($r.projected_commission)
    product            = [string]$r.product
    notes              = 'Synced from Sequifi'
    source             = 'sequifi'
  }
}
$payload = @{ commAccounts = @($accounts) } | ConvertTo-Json -Depth 5
$dest = [Environment]::GetFolderPath('Desktop') + '\sequifi-accounts.json'
Set-Content -Path $dest -Value $payload -Encoding UTF8
Write-Host ''
Write-Host '  ===================================================='
Write-Host ('   DONE! Synced ' + @($accounts).Count + ' accounts from Sequifi.')
Write-Host '  ===================================================='
Write-Host ''
Write-Host '   A file called  sequifi-accounts.json  is now on your'
Write-Host '   DESKTOP. Import that into your app and you are done!'
Write-Host ''
Read-Host '  Press Enter to close'
