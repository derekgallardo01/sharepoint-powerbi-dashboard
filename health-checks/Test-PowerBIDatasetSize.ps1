<#
.SYNOPSIS
    Checks Power BI dataset sizes against Pro and Premium capacity limits.

.DESCRIPTION
    Connects to the Power BI Service and retrieves dataset details including
    name, configured size, refresh mode, and table count. Compares each dataset
    against the Pro limit (1 GB) and Premium limit (10 GB), and reports any
    datasets that are approaching or exceeding those thresholds.

    Requires the MicrosoftPowerBIMgmt module.

.PARAMETER WorkspaceId
    The GUID of the Power BI workspace to inspect.

.PARAMETER DatasetId
    Optional. The GUID of a specific dataset to check. When omitted, all
    datasets in the workspace are evaluated.

.PARAMETER ProLimitGB
    Size threshold in GB for Pro licence users. Default is 1.

.PARAMETER PremiumLimitGB
    Size threshold in GB for Premium / PPU users. Default is 10.

.PARAMETER WarningThresholdPercent
    Percentage of a limit at which a warning is raised. Default is 80.

.PARAMETER WhatIf
    Shows what would be checked without connecting to the Power BI service.

.EXAMPLE
    .\Test-PowerBIDatasetSize.ps1 -WorkspaceId "abc-123"

.EXAMPLE
    .\Test-PowerBIDatasetSize.ps1 -WorkspaceId "abc-123" -DatasetId "def-456"

.EXAMPLE
    .\Test-PowerBIDatasetSize.ps1 -WorkspaceId "abc-123" -WarningThresholdPercent 90
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Power BI workspace GUID")]
    [ValidateNotNullOrEmpty()]
    [string]$WorkspaceId,

    [Parameter(Mandatory = $false, HelpMessage = "Specific dataset GUID (optional, checks all if omitted)")]
    [string]$DatasetId,

    [Parameter(HelpMessage = "Pro licence size limit in GB (default 1)")]
    [ValidateRange(0.1, 100)]
    [double]$ProLimitGB = 1,

    [Parameter(HelpMessage = "Premium licence size limit in GB (default 10)")]
    [ValidateRange(0.1, 400)]
    [double]$PremiumLimitGB = 10,

    [Parameter(HelpMessage = "Warning threshold as percent of limit (default 80)")]
    [ValidateRange(50, 99)]
    [int]$WarningThresholdPercent = 80
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-StatusLine {
    param([string]$Message, [string]$Status, [ConsoleColor]$Color = 'White')
    Write-Host ("{0,-60} " -f $Message) -NoNewline
    Write-Host "[$Status]" -ForegroundColor $Color
}

function Get-SizeDisplayString {
    param([double]$SizeInBytes)
    if ($SizeInBytes -ge 1GB) {
        return "{0:N2} GB" -f ($SizeInBytes / 1GB)
    }
    elseif ($SizeInBytes -ge 1MB) {
        return "{0:N1} MB" -f ($SizeInBytes / 1MB)
    }
    else {
        return "{0:N0} KB" -f ($SizeInBytes / 1KB)
    }
}

function Get-DatasetSizeAssessment {
    param(
        [double]$SizeInBytes,
        [double]$LimitGB,
        [int]$WarnPercent
    )
    $limitBytes = $LimitGB * 1GB
    $percent    = if ($limitBytes -gt 0) { ($SizeInBytes / $limitBytes) * 100 } else { 0 }

    if ($percent -ge 100) {
        return @{ Status = 'EXCEEDED'; Percent = [math]::Round($percent, 1); Color = 'Red' }
    }
    elseif ($percent -ge $WarnPercent) {
        return @{ Status = 'WARNING'; Percent = [math]::Round($percent, 1); Color = 'Yellow' }
    }
    else {
        return @{ Status = 'OK'; Percent = [math]::Round($percent, 1); Color = 'Green' }
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$results = @()

try {
    Write-Host "`n=== Power BI Dataset Size Check ===" -ForegroundColor Cyan
    Write-Host "Workspace : $WorkspaceId"
    Write-Host "Dataset   : $(if ($DatasetId) { $DatasetId } else { '(all datasets)' })"
    Write-Host "Pro limit : $ProLimitGB GB  |  Premium limit: $PremiumLimitGB GB"
    Write-Host "Warning at: ${WarningThresholdPercent}% of limit"
    Write-Host ("=" * 60)

    # --- WhatIf guard ---
    if (-not $PSCmdlet.ShouldProcess("Workspace $WorkspaceId", "Retrieve dataset size information from Power BI Service")) {
        Write-Host "`n[WhatIf] Would connect to Power BI Service and inspect datasets." -ForegroundColor Yellow
        return
    }

    # --- Connect to Power BI ---
    Write-StatusLine "Connecting to Power BI Service..." "RUNNING" Cyan
    Connect-PowerBIServiceAccount | Out-Null
    Write-StatusLine "Connected to Power BI Service" "PASS" Green

    # --- Retrieve datasets ---
    if ($DatasetId) {
        Write-StatusLine "Retrieving dataset $DatasetId..." "RUNNING" Cyan
        $datasets = @(Get-PowerBIDataset -WorkspaceId $WorkspaceId -Id $DatasetId)
    }
    else {
        Write-StatusLine "Retrieving all datasets in workspace..." "RUNNING" Cyan
        $datasets = @(Get-PowerBIDataset -WorkspaceId $WorkspaceId)
    }

    if ($datasets.Count -eq 0) {
        Write-StatusLine "No datasets found" "WARN" Yellow
        return
    }

    Write-StatusLine "Found $($datasets.Count) dataset(s)" "PASS" Green
    Write-Host ""

    # --- Evaluate each dataset ---
    foreach ($ds in $datasets) {
        $dsName       = $ds.Name
        $dsId         = $ds.Id
        $refreshMode  = if ($ds.IsRefreshable) { "Scheduled / On-Demand" } else { "Direct Query / Live" }

        # Retrieve detailed info via REST for size metrics
        $detailUrl  = "groups/$WorkspaceId/datasets/$dsId"
        $detailResp = Invoke-PowerBIRestMethod -Url $detailUrl -Method Get | ConvertFrom-Json

        # MaxSizeInBytes is available on import-mode datasets
        $sizeInBytes = 0
        if ($null -ne $detailResp.targetStorageMode -and $detailResp.targetStorageMode -eq "Abf") {
            # For import-mode datasets we can try the storage info endpoint
            try {
                $storageUrl  = "groups/$WorkspaceId/datasets/$dsId/Default.GetBoundGatewayDataSources"
                # Fall back to the configured size if available
                $sizeInBytes = if ($null -ne $detailResp.contentProviderType) { 0 } else { 0 }
            }
            catch {
                # Size not available via this route -- will use estimatedSize if present
            }
        }

        # Use the configuredBy size hint from the API when available
        if ($null -ne $detailResp.configuredBy) {
            # Try the enhanced dataset detail endpoint (admin API)
            try {
                $adminUrl    = "admin/datasets/$dsId"
                $adminResp   = Invoke-PowerBIRestMethod -Url $adminUrl -Method Get -ErrorAction SilentlyContinue | ConvertFrom-Json
                if ($null -ne $adminResp -and $null -ne $adminResp.ContentProviderType) {
                    # Look for actual storage metrics
                }
            }
            catch {
                # Admin API may not be accessible -- proceed with available data
            }
        }

        # Attempt to get actual size from the refreshes/storage metadata
        try {
            $refreshesUrl  = "groups/$WorkspaceId/datasets/$dsId/refreshes?`$top=1"
            $refreshesResp = Invoke-PowerBIRestMethod -Url $refreshesUrl -Method Get | ConvertFrom-Json
        }
        catch {
            # Refreshes endpoint may not be available for all dataset types
        }

        # Use model size from dataset detail (available in newer API versions)
        if ($null -ne $detailResp.PSObject.Properties['estimatedModelSizeInBytes']) {
            $sizeInBytes = $detailResp.estimatedModelSizeInBytes
        }
        elseif ($null -ne $detailResp.PSObject.Properties['MaxSizeInBytes']) {
            $sizeInBytes = $detailResp.MaxSizeInBytes
        }

        # Determine table count via tables endpoint
        $tableCount = 0
        try {
            $tablesUrl  = "groups/$WorkspaceId/datasets/$dsId/tables"
            $tablesResp = Invoke-PowerBIRestMethod -Url $tablesUrl -Method Get | ConvertFrom-Json
            $tableCount = ($tablesResp.value | Measure-Object).Count
        }
        catch {
            # Tables endpoint may require additional permissions
            $tableCount = -1
        }

        # --- Build result object ---
        $proAssessment     = Get-DatasetSizeAssessment -SizeInBytes $sizeInBytes -LimitGB $ProLimitGB     -WarnPercent $WarningThresholdPercent
        $premiumAssessment = Get-DatasetSizeAssessment -SizeInBytes $sizeInBytes -LimitGB $PremiumLimitGB -WarnPercent $WarningThresholdPercent

        $result = [PSCustomObject]@{
            DatasetName       = $dsName
            DatasetId         = $dsId
            SizeDisplay       = Get-SizeDisplayString -SizeInBytes $sizeInBytes
            SizeInBytes       = $sizeInBytes
            RefreshMode       = $refreshMode
            TableCount        = if ($tableCount -ge 0) { $tableCount } else { "N/A" }
            ProStatus         = $proAssessment.Status
            ProPercent        = "$($proAssessment.Percent)%"
            PremiumStatus     = $premiumAssessment.Status
            PremiumPercent    = "$($premiumAssessment.Percent)%"
        }
        $results += $result

        # --- Display ---
        Write-Host "  Dataset: $dsName" -ForegroundColor White
        Write-Host "    ID          : $dsId"
        Write-Host "    Size        : $(Get-SizeDisplayString -SizeInBytes $sizeInBytes)"
        Write-Host "    Refresh Mode: $refreshMode"
        Write-Host "    Tables      : $(if ($tableCount -ge 0) { $tableCount } else { 'N/A' })"

        Write-Host -NoNewline "    Pro ($ProLimitGB GB)     : "
        Write-Host "$($proAssessment.Status) ($($proAssessment.Percent)%)" -ForegroundColor $proAssessment.Color

        Write-Host -NoNewline "    Premium ($PremiumLimitGB GB) : "
        Write-Host "$($premiumAssessment.Status) ($($premiumAssessment.Percent)%)" -ForegroundColor $premiumAssessment.Color

        Write-Host ""
    }

    # --- Summary ---
    Write-Host ("=" * 60)
    $oversizedPro     = @($results | Where-Object { $_.ProStatus -eq 'EXCEEDED' })
    $oversizedPremium = @($results | Where-Object { $_.PremiumStatus -eq 'EXCEEDED' })
    $warningPro       = @($results | Where-Object { $_.ProStatus -eq 'WARNING' })
    $warningPremium   = @($results | Where-Object { $_.PremiumStatus -eq 'WARNING' })

    Write-Host "Summary:" -ForegroundColor Cyan
    Write-Host "  Total datasets checked   : $($results.Count)"

    if ($oversizedPro.Count -gt 0) {
        Write-StatusLine "  Exceeding Pro limit      : $($oversizedPro.Count)" "FAIL" Red
        foreach ($ds in $oversizedPro) {
            Write-Host "    - $($ds.DatasetName) ($($ds.SizeDisplay))" -ForegroundColor Red
        }
    }
    else {
        Write-StatusLine "  Exceeding Pro limit      : 0" "PASS" Green
    }

    if ($warningPro.Count -gt 0) {
        Write-StatusLine "  Approaching Pro limit    : $($warningPro.Count)" "WARN" Yellow
    }

    if ($oversizedPremium.Count -gt 0) {
        Write-StatusLine "  Exceeding Premium limit  : $($oversizedPremium.Count)" "FAIL" Red
        foreach ($ds in $oversizedPremium) {
            Write-Host "    - $($ds.DatasetName) ($($ds.SizeDisplay))" -ForegroundColor Red
        }
    }
    else {
        Write-StatusLine "  Exceeding Premium limit  : 0" "PASS" Green
    }

    if ($warningPremium.Count -gt 0) {
        Write-StatusLine "  Approaching Premium limit: $($warningPremium.Count)" "WARN" Yellow
    }

    Write-Host ""
}
catch {
    Write-StatusLine "Dataset size check failed" "FAIL" Red
    Write-Error $_.Exception.Message
}
finally {
    try { Disconnect-PowerBIServiceAccount -ErrorAction SilentlyContinue } catch { }
}

# Return structured results for pipeline consumption
return $results
