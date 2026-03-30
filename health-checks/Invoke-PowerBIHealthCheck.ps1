<#
.SYNOPSIS
    Master health check script that runs all Power BI diagnostic checks
    and generates a summary HTML report.

.DESCRIPTION
    Orchestrates the individual health check scripts (refresh status,
    gateway health, permissions, embed config) and compiles the results
    into a single colour-coded HTML report saved to disk.

.PARAMETER WorkspaceId
    The GUID of the Power BI workspace to inspect. Required.

.PARAMETER DatasetId
    Optional dataset GUID for refresh checks. When omitted, refresh
    checks are skipped.

.PARAMETER ClientId
    Optional Azure AD app client ID for embed configuration checks.

.PARAMETER TenantId
    Optional Azure AD tenant ID for embed configuration checks.

.PARAMETER ReportId
    Optional report GUID for embed configuration checks.

.PARAMETER OutputPath
    Directory where the HTML report is written. Defaults to
    .\reports inside the script's directory.

.EXAMPLE
    .\Invoke-PowerBIHealthCheck.ps1 -WorkspaceId "abc-123"

.EXAMPLE
    .\Invoke-PowerBIHealthCheck.ps1 -WorkspaceId "abc-123" -DatasetId "def-456" -OutputPath "C:\Reports"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Power BI workspace GUID")]
    [ValidateNotNullOrEmpty()]
    [string]$WorkspaceId,

    [Parameter(HelpMessage = "Dataset GUID for refresh checks")]
    [string]$DatasetId,

    [Parameter(HelpMessage = "Azure AD app client ID")]
    [string]$ClientId,

    [Parameter(HelpMessage = "Azure AD tenant ID")]
    [string]$TenantId,

    [Parameter(HelpMessage = "Report GUID for embed checks")]
    [string]$ReportId,

    [Parameter(HelpMessage = "Output directory for the HTML report")]
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

if (-not $OutputPath) {
    $OutputPath = Join-Path $scriptDir "reports"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function ConvertTo-HtmlSection {
    param(
        [string]$Title,
        [string]$Status,       # Pass, Fail, Skipped, Warning
        [string]$BodyHtml
    )

    $badgeColor = switch ($Status) {
        'Pass'    { '#107c10' }
        'Fail'    { '#d13438' }
        'Warning' { '#ffb900' }
        default   { '#605e5c' }
    }

    return @"
    <div class="section">
      <h2>$Title <span class="badge" style="background:$badgeColor;">$Status</span></h2>
      $BodyHtml
    </div>
"@
}

function Build-TableHtml {
    param([array]$Data)

    if (-not $Data -or $Data.Count -eq 0) {
        return '<p class="muted">No data returned.</p>'
    }

    $props = $Data[0].PSObject.Properties | ForEach-Object { $_.Name }
    $headerRow = ($props | ForEach-Object { "<th>$_</th>" }) -join "`n"

    $bodyRows = foreach ($row in $Data) {
        $cells = foreach ($prop in $props) {
            $val = $row.$prop
            $cellClass = ''
            if ($val -eq 'FAIL' -or $val -eq 'Failed' -or $val -eq $false) { $cellClass = ' class="fail"' }
            elseif ($val -eq 'OK' -or $val -eq 'Completed' -or $val -eq $true) { $cellClass = ' class="pass"' }
            "<td$cellClass>$val</td>"
        }
        "<tr>$($cells -join "`n")</tr>"
    }

    return @"
<table>
  <thead><tr>$headerRow</tr></thead>
  <tbody>
    $($bodyRows -join "`n")
  </tbody>
</table>
"@
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " Power BI Comprehensive Health Check"     -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$reportFile = Join-Path $OutputPath "PowerBI-HealthCheck-$timestamp.html"
$sections = @()
$overallStatus = 'Pass'

# Ensure module
if (-not (Get-Module -ListAvailable -Name MicrosoftPowerBIMgmt)) {
    Write-Error "MicrosoftPowerBIMgmt module is not installed. Run: Install-Module MicrosoftPowerBIMgmt -Scope CurrentUser"
}

# Authenticate once
$existingContext = Get-PowerBIAccessToken -ErrorAction SilentlyContinue
if (-not $existingContext) {
    Write-Host "Authenticating to Power BI Service..." -ForegroundColor Yellow
    Connect-PowerBIServiceAccount | Out-Null
}

# -----------------------------------------------------------------------
# 1. Dataset Refresh Status
# -----------------------------------------------------------------------
if ($DatasetId) {
    Write-Host "[1/4] Checking dataset refresh status..." -ForegroundColor White
    try {
        $refreshResults = & "$scriptDir\Test-PowerBIRefreshStatus.ps1" `
            -WorkspaceId $WorkspaceId -DatasetId $DatasetId -DaysBack 7

        $failedCount = ($refreshResults | Where-Object { $_.Status -eq 'Failed' }).Count
        $sectionStatus = if ($failedCount -gt 0) { 'Fail' } else { 'Pass' }
        if ($sectionStatus -eq 'Fail') { $overallStatus = 'Fail' }

        $tableHtml = Build-TableHtml -Data $refreshResults
        $sections += ConvertTo-HtmlSection -Title "Dataset Refresh Status" -Status $sectionStatus -BodyHtml $tableHtml
    }
    catch {
        $overallStatus = 'Warning'
        $sections += ConvertTo-HtmlSection -Title "Dataset Refresh Status" -Status "Fail" `
            -BodyHtml "<p class='fail'>Error: $($_.Exception.Message)</p>"
    }
}
else {
    Write-Host "[1/4] Skipping refresh check (no DatasetId provided)." -ForegroundColor Gray
    $sections += ConvertTo-HtmlSection -Title "Dataset Refresh Status" -Status "Skipped" `
        -BodyHtml "<p class='muted'>Provide -DatasetId to enable this check.</p>"
}

# -----------------------------------------------------------------------
# 2. Gateway Health
# -----------------------------------------------------------------------
Write-Host "[2/4] Checking gateway health..." -ForegroundColor White
try {
    $gatewayResults = & "$scriptDir\Test-PowerBIGatewayHealth.ps1"

    $gwFails = ($gatewayResults | Where-Object { $_.Status -eq 'FAIL' }).Count
    $gwStatus = if ($gatewayResults.Count -eq 0) { 'Warning' } elseif ($gwFails -gt 0) { 'Fail' } else { 'Pass' }
    if ($gwStatus -eq 'Fail') { $overallStatus = 'Fail' }

    $tableHtml = Build-TableHtml -Data $gatewayResults
    $sections += ConvertTo-HtmlSection -Title "Gateway Health" -Status $gwStatus -BodyHtml $tableHtml
}
catch {
    $sections += ConvertTo-HtmlSection -Title "Gateway Health" -Status "Warning" `
        -BodyHtml "<p class='muted'>Could not check gateways: $($_.Exception.Message)</p>"
}

# -----------------------------------------------------------------------
# 3. Permissions Audit
# -----------------------------------------------------------------------
Write-Host "[3/4] Auditing workspace permissions..." -ForegroundColor White
try {
    $permResults = & "$scriptDir\Test-PowerBIPermissions.ps1" `
        -WorkspaceId $WorkspaceId -IncludeRLS

    $permHtml = Build-TableHtml -Data $permResults.WorkspacePermissions
    if ($permResults.RLSReport.Count -gt 0) {
        $permHtml += "<h3>RLS Role Assignments</h3>"
        $permHtml += Build-TableHtml -Data $permResults.RLSReport
    }
    $sections += ConvertTo-HtmlSection -Title "Permissions Audit" -Status "Pass" -BodyHtml $permHtml
}
catch {
    $sections += ConvertTo-HtmlSection -Title "Permissions Audit" -Status "Warning" `
        -BodyHtml "<p class='muted'>Could not audit permissions: $($_.Exception.Message)</p>"
}

# -----------------------------------------------------------------------
# 4. Embed Configuration
# -----------------------------------------------------------------------
if ($ClientId -and $TenantId -and $ReportId) {
    Write-Host "[4/4] Validating embed configuration..." -ForegroundColor White
    try {
        $embedResults = & "$scriptDir\Test-PowerBIEmbedConfig.ps1" `
            -ClientId $ClientId -TenantId $TenantId -WorkspaceId $WorkspaceId -ReportId $ReportId

        $embedFails = ($embedResults | Where-Object { -not $_.Passed }).Count
        $embedStatus = if ($embedFails -gt 0) { 'Fail' } else { 'Pass' }
        if ($embedStatus -eq 'Fail') { $overallStatus = 'Fail' }

        $tableHtml = Build-TableHtml -Data $embedResults
        $sections += ConvertTo-HtmlSection -Title "Embed Configuration" -Status $embedStatus -BodyHtml $tableHtml
    }
    catch {
        $overallStatus = 'Warning'
        $sections += ConvertTo-HtmlSection -Title "Embed Configuration" -Status "Fail" `
            -BodyHtml "<p class='fail'>Error: $($_.Exception.Message)</p>"
    }
}
else {
    Write-Host "[4/4] Skipping embed config check (provide -ClientId, -TenantId, -ReportId)." -ForegroundColor Gray
    $sections += ConvertTo-HtmlSection -Title "Embed Configuration" -Status "Skipped" `
        -BodyHtml "<p class='muted'>Provide -ClientId, -TenantId, and -ReportId to enable this check.</p>"
}

# -----------------------------------------------------------------------
# Build HTML report
# -----------------------------------------------------------------------
$overallBadgeColor = switch ($overallStatus) {
    'Pass'    { '#107c10' }
    'Fail'    { '#d13438' }
    default   { '#ffb900' }
}

$htmlReport = @"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Power BI Health Check Report</title>
  <style>
    :root { --font: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font); background: #f3f2f1; color: #323130; padding: 24px; }
    .container { max-width: 960px; margin: 0 auto; }
    header { background: #0078d4; color: #fff; padding: 24px 32px; border-radius: 8px 8px 0 0; }
    header h1 { font-size: 24px; font-weight: 600; }
    header p  { margin-top: 4px; opacity: 0.85; font-size: 14px; }
    .overall { display: inline-block; margin-top: 12px; padding: 4px 14px; border-radius: 4px;
               font-weight: 600; font-size: 14px; color: #fff; background: $overallBadgeColor; }
    .body   { background: #fff; padding: 24px 32px; border-radius: 0 0 8px 8px; }
    .section { margin-bottom: 28px; }
    .section h2 { font-size: 18px; margin-bottom: 12px; border-bottom: 1px solid #edebe9; padding-bottom: 8px; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 3px; font-size: 12px;
             color: #fff; vertical-align: middle; margin-left: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    th { background: #f3f2f1; text-align: left; padding: 8px 10px; border-bottom: 2px solid #edebe9; }
    td { padding: 7px 10px; border-bottom: 1px solid #edebe9; }
    tr:hover td { background: #faf9f8; }
    .pass { color: #107c10; font-weight: 600; }
    .fail { color: #d13438; font-weight: 600; }
    .muted { color: #605e5c; font-style: italic; }
    footer { text-align: center; margin-top: 24px; font-size: 12px; color: #a19f9d; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Power BI Health Check Report</h1>
      <p>Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Workspace: $WorkspaceId</p>
      <span class="overall">Overall: $overallStatus</span>
    </header>
    <div class="body">
      $($sections -join "`n")
    </div>
    <footer>
      Generated by Invoke-PowerBIHealthCheck.ps1 &mdash; SharePoint Power BI Dashboard project
    </footer>
  </div>
</body>
</html>
"@

$htmlReport | Out-File -FilePath $reportFile -Encoding utf8 -Force

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " Health Check Complete"                     -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
Write-Host "Overall status : $overallStatus" -ForegroundColor $(if ($overallStatus -eq 'Pass') { 'Green' } elseif ($overallStatus -eq 'Fail') { 'Red' } else { 'Yellow' })
Write-Host "Report saved to: $reportFile`n" -ForegroundColor White

return $reportFile
