<#
.SYNOPSIS
    Checks Power BI dataset refresh history and reports on failures.

.DESCRIPTION
    Connects to the Power BI Service and retrieves refresh history for the
    specified dataset. Reports failed, in-progress, and completed refreshes
    within the configured look-back window.

.PARAMETER WorkspaceId
    The GUID of the Power BI workspace containing the dataset.

.PARAMETER DatasetId
    The GUID of the dataset to check.

.PARAMETER DaysBack
    Number of days of refresh history to retrieve. Defaults to 7.

.PARAMETER WhatIf
    Shows what would be checked without actually connecting to the service.

.EXAMPLE
    .\Test-PowerBIRefreshStatus.ps1 -WorkspaceId "abc-123" -DatasetId "def-456"

.EXAMPLE
    .\Test-PowerBIRefreshStatus.ps1 -WorkspaceId "abc-123" -DatasetId "def-456" -DaysBack 30
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Power BI workspace GUID")]
    [ValidateNotNullOrEmpty()]
    [string]$WorkspaceId,

    [Parameter(Mandatory = $true, HelpMessage = "Power BI dataset GUID")]
    [ValidateNotNullOrEmpty()]
    [string]$DatasetId,

    [Parameter(HelpMessage = "Number of days to look back (default 7)")]
    [ValidateRange(1, 90)]
    [int]$DaysBack = 7
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

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$results = @()

try {
    # Ensure module is available
    if (-not (Get-Module -ListAvailable -Name MicrosoftPowerBIMgmt)) {
        Write-Error "MicrosoftPowerBIMgmt module is not installed. Run: Install-Module MicrosoftPowerBIMgmt -Scope CurrentUser"
    }

    if ($PSCmdlet.ShouldProcess("Dataset $DatasetId in Workspace $WorkspaceId", "Check refresh history")) {

        Write-Host "`n========================================" -ForegroundColor Cyan
        Write-Host " Power BI Dataset Refresh Status Check" -ForegroundColor Cyan
        Write-Host "========================================`n" -ForegroundColor Cyan

        # Connect (interactive or service principal depending on existing session)
        $existingContext = Get-PowerBIAccessToken -ErrorAction SilentlyContinue
        if (-not $existingContext) {
            Write-Host "Authenticating to Power BI Service..." -ForegroundColor Yellow
            Connect-PowerBIServiceAccount | Out-Null
        }

        Write-Host "Workspace : $WorkspaceId"
        Write-Host "Dataset   : $DatasetId"
        Write-Host "Look-back : $DaysBack day(s)`n"

        # Retrieve refresh history via REST API
        $uri = "groups/$WorkspaceId/datasets/$DatasetId/refreshes?`$top=100"
        $response = Invoke-PowerBIRestMethod -Url $uri -Method Get | ConvertFrom-Json
        $cutoffDate = (Get-Date).AddDays(-$DaysBack)

        $refreshes = $response.value | Where-Object {
            [datetime]$_.startTime -ge $cutoffDate
        }

        if ($refreshes.Count -eq 0) {
            Write-Warning "No refresh records found in the last $DaysBack day(s)."
        }

        foreach ($refresh in $refreshes) {
            $startTime = [datetime]$refresh.startTime
            $endTime   = if ($refresh.endTime) { [datetime]$refresh.endTime } else { $null }
            $duration  = if ($endTime) { ($endTime - $startTime).ToString("hh\:mm\:ss") } else { "In Progress" }

            $entry = [PSCustomObject]@{
                StartTime   = $startTime.ToString("yyyy-MM-dd HH:mm:ss")
                EndTime     = if ($endTime) { $endTime.ToString("yyyy-MM-dd HH:mm:ss") } else { "---" }
                Duration    = $duration
                Status      = $refresh.status
                RequestType = $refresh.refreshType
                Error       = if ($refresh.serviceExceptionJson) {
                                ($refresh.serviceExceptionJson | ConvertFrom-Json).errorCode
                              } else { "" }
            }

            $results += $entry
        }

        # Display results
        $results | Format-Table -AutoSize

        # Summary
        $failed      = ($results | Where-Object { $_.Status -eq 'Failed' }).Count
        $completed   = ($results | Where-Object { $_.Status -eq 'Completed' }).Count
        $inProgress  = ($results | Where-Object { $_.Status -eq 'Unknown' -or $_.Duration -eq 'In Progress' }).Count
        $disabled    = ($results | Where-Object { $_.Status -eq 'Disabled' }).Count

        Write-Host "`n--- Summary ---" -ForegroundColor Cyan
        Write-StatusLine "Completed refreshes" "$completed" Green
        Write-StatusLine "Failed refreshes"    "$failed"    $(if ($failed -gt 0) { 'Red' } else { 'Green' })
        Write-StatusLine "In-progress"         "$inProgress" Yellow
        Write-StatusLine "Disabled"            "$disabled"  $(if ($disabled -gt 0) { 'Yellow' } else { 'Gray' })

        if ($failed -gt 0) {
            Write-Host "`n[!] There are $failed failed refresh(es). Review the errors above." -ForegroundColor Red
        } else {
            Write-Host "`n[OK] All refreshes in the last $DaysBack day(s) completed successfully." -ForegroundColor Green
        }
    }
}
catch {
    Write-Error "Refresh status check failed: $_"
}

# Return structured results for pipeline consumption
return $results
