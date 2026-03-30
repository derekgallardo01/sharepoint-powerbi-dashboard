<#
.SYNOPSIS
    Checks Power BI on-premises data gateway connectivity and health.

.DESCRIPTION
    Enumerates Power BI gateways accessible to the authenticated account,
    lists their data sources, and reports connection errors. Optionally
    targets a single gateway by ID.

.PARAMETER GatewayId
    Optional. The GUID of a specific gateway to check. When omitted, all
    gateways visible to the account are inspected.

.EXAMPLE
    .\Test-PowerBIGatewayHealth.ps1

.EXAMPLE
    .\Test-PowerBIGatewayHealth.ps1 -GatewayId "abc-123"
#>
[CmdletBinding()]
param(
    [Parameter(HelpMessage = "Optional gateway GUID to check a single gateway")]
    [string]$GatewayId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-StatusLine {
    param([string]$Message, [string]$Status, [ConsoleColor]$Color = 'White')
    Write-Host ("{0,-55} " -f $Message) -NoNewline
    Write-Host "[$Status]" -ForegroundColor $Color
}

function Test-DataSourceConnection {
    param([string]$GatewayIdParam, [string]$DataSourceId)
    try {
        $uri = "gateways/$GatewayIdParam/datasources/$DataSourceId/status"
        Invoke-PowerBIRestMethod -Url $uri -Method Get | Out-Null
        return @{ Success = $true; Error = $null }
    }
    catch {
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$report = @()

try {
    # Ensure module is available
    if (-not (Get-Module -ListAvailable -Name MicrosoftPowerBIMgmt)) {
        Write-Error "MicrosoftPowerBIMgmt module is not installed. Run: Install-Module MicrosoftPowerBIMgmt -Scope CurrentUser"
    }

    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host " Power BI Gateway Health Check"          -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan

    # Connect
    $existingContext = Get-PowerBIAccessToken -ErrorAction SilentlyContinue
    if (-not $existingContext) {
        Write-Host "Authenticating to Power BI Service..." -ForegroundColor Yellow
        Connect-PowerBIServiceAccount | Out-Null
    }

    # Retrieve gateways
    if ($GatewayId) {
        Write-Host "Checking gateway: $GatewayId`n"
        $gatewayResponse = Invoke-PowerBIRestMethod -Url "gateways/$GatewayId" -Method Get | ConvertFrom-Json
        $gateways = @($gatewayResponse)
    }
    else {
        Write-Host "Enumerating all gateways...`n"
        $gatewayResponse = Invoke-PowerBIRestMethod -Url "gateways" -Method Get | ConvertFrom-Json
        $gateways = $gatewayResponse.value
    }

    if ($gateways.Count -eq 0) {
        Write-Warning "No gateways found for this account."
        return @()
    }

    Write-Host "Found $($gateways.Count) gateway(s).`n" -ForegroundColor Green

    foreach ($gw in $gateways) {
        $gwId   = $gw.id
        $gwName = $gw.name
        $gwType = $gw.type  # e.g., Resource, Personal

        Write-Host "--- Gateway: $gwName ($gwType) ---" -ForegroundColor Cyan
        Write-Host "    ID: $gwId"

        # Gateway-level status
        $gwStatus = if ($gw.publicKey) { "Online" } else { "Unknown" }
        Write-StatusLine "    Gateway status" $gwStatus $(if ($gwStatus -eq 'Online') { 'Green' } else { 'Yellow' })

        # Enumerate data sources
        try {
            $dsResponse = Invoke-PowerBIRestMethod -Url "gateways/$gwId/datasources" -Method Get | ConvertFrom-Json
            $dataSources = $dsResponse.value
        }
        catch {
            Write-Warning "    Could not retrieve data sources: $($_.Exception.Message)"
            $dataSources = @()
        }

        if ($dataSources.Count -eq 0) {
            Write-Host "    No data sources configured.`n" -ForegroundColor Yellow
        }

        foreach ($ds in $dataSources) {
            $dsName = $ds.datasourceName
            $dsType = $ds.datasourceType
            $dsId   = $ds.id

            # Test connectivity
            $connResult = Test-DataSourceConnection -GatewayIdParam $gwId -DataSourceId $dsId

            $status = if ($connResult.Success) { "OK" } else { "FAIL" }
            $color  = if ($connResult.Success) { 'Green' } else { 'Red' }

            Write-StatusLine "    [$dsType] $dsName" $status $color

            $entry = [PSCustomObject]@{
                GatewayName    = $gwName
                GatewayId      = $gwId
                GatewayType    = $gwType
                DataSourceName = $dsName
                DataSourceType = $dsType
                Status         = $status
                Error          = $connResult.Error
            }
            $report += $entry
        }

        Write-Host ""
    }

    # Summary table
    Write-Host "--- Data Source Summary ---`n" -ForegroundColor Cyan
    $report | Format-Table GatewayName, DataSourceName, DataSourceType, Status, Error -AutoSize

    $failCount = ($report | Where-Object { $_.Status -eq 'FAIL' }).Count
    if ($failCount -gt 0) {
        Write-Host "[!] $failCount data source(s) failed connectivity checks." -ForegroundColor Red
    }
    else {
        Write-Host "[OK] All data sources are reachable." -ForegroundColor Green
    }
}
catch {
    Write-Error "Gateway health check failed: $_"
}

return $report
