<#
.SYNOPSIS
    Audits Power BI workspace permissions and optional RLS role membership.

.DESCRIPTION
    Retrieves and displays the access list for a Power BI workspace,
    optionally inspects Row-Level Security (RLS) role assignments on each
    dataset, and flags common permission misconfigurations.

.PARAMETER WorkspaceId
    The GUID of the Power BI workspace to audit.

.PARAMETER IncludeRLS
    When specified, also enumerates RLS role members for every dataset
    in the workspace.

.EXAMPLE
    .\Test-PowerBIPermissions.ps1 -WorkspaceId "abc-123"

.EXAMPLE
    .\Test-PowerBIPermissions.ps1 -WorkspaceId "abc-123" -IncludeRLS
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Power BI workspace GUID")]
    [ValidateNotNullOrEmpty()]
    [string]$WorkspaceId,

    [Parameter(HelpMessage = "Include RLS role membership audit")]
    [switch]$IncludeRLS
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

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$permissionReport = @()
$rlsReport = @()

try {
    if (-not (Get-Module -ListAvailable -Name MicrosoftPowerBIMgmt)) {
        Write-Error "MicrosoftPowerBIMgmt module is not installed. Run: Install-Module MicrosoftPowerBIMgmt -Scope CurrentUser"
    }

    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host " Power BI Permissions Audit"              -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan

    # Connect
    $existingContext = Get-PowerBIAccessToken -ErrorAction SilentlyContinue
    if (-not $existingContext) {
        Write-Host "Authenticating to Power BI Service..." -ForegroundColor Yellow
        Connect-PowerBIServiceAccount | Out-Null
    }

    # -----------------------------------------------------------------------
    # 1. Workspace-level permissions
    # -----------------------------------------------------------------------
    Write-Host "Workspace: $WorkspaceId`n" -ForegroundColor White

    $usersUri = "groups/$WorkspaceId/users"
    $usersResponse = Invoke-PowerBIRestMethod -Url $usersUri -Method Get | ConvertFrom-Json
    $users = $usersResponse.value

    Write-Host "--- Workspace Members ($($users.Count)) ---`n" -ForegroundColor Cyan

    foreach ($user in $users) {
        $displayName   = $user.displayName
        $emailAddress  = $user.emailAddress
        $principalType = $user.principalType   # User, Group, App
        $accessRight   = $user.groupUserAccessRight  # Admin, Member, Contributor, Viewer

        $color = switch ($accessRight) {
            'Admin'       { 'Red' }
            'Member'      { 'Yellow' }
            'Contributor' { 'Cyan' }
            'Viewer'      { 'Green' }
            default       { 'White' }
        }

        Write-StatusLine "    $displayName ($emailAddress)" "$accessRight | $principalType" $color

        $permissionReport += [PSCustomObject]@{
            DisplayName   = $displayName
            Email         = $emailAddress
            PrincipalType = $principalType
            AccessRight   = $accessRight
        }
    }

    # Warn on potential misconfigurations
    $adminCount = ($permissionReport | Where-Object { $_.AccessRight -eq 'Admin' }).Count
    $appCount   = ($permissionReport | Where-Object { $_.PrincipalType -eq 'App' }).Count

    Write-Host ""
    if ($adminCount -gt 3) {
        Write-Warning "High number of Admins ($adminCount). Consider limiting Admin access to reduce risk."
    }
    if ($appCount -eq 0) {
        Write-Host "[Info] No service principal (App) has access. Embed-for-customers scenarios may require one." -ForegroundColor Yellow
    }

    # -----------------------------------------------------------------------
    # 2. Dataset permissions
    # -----------------------------------------------------------------------
    Write-Host "`n--- Dataset Permissions ---`n" -ForegroundColor Cyan

    $datasetsUri = "groups/$WorkspaceId/datasets"
    $datasetsResponse = Invoke-PowerBIRestMethod -Url $datasetsUri -Method Get | ConvertFrom-Json
    $datasets = $datasetsResponse.value

    foreach ($ds in $datasets) {
        $dsName = $ds.name
        $dsId   = $ds.id

        Write-Host "  Dataset: $dsName ($dsId)" -ForegroundColor White

        # Check dataset-level user permissions
        try {
            $dsUsersUri = "groups/$WorkspaceId/datasets/$dsId/users"
            $dsUsersResponse = Invoke-PowerBIRestMethod -Url $dsUsersUri -Method Get | ConvertFrom-Json
            $dsUsers = $dsUsersResponse.value

            if ($dsUsers.Count -eq 0) {
                Write-Host "    Permissions inherited from workspace (no direct dataset permissions)." -ForegroundColor Gray
            }
            else {
                foreach ($dsUser in $dsUsers) {
                    Write-Host "    $($dsUser.displayName) - $($dsUser.datasetUserAccessRight)" -ForegroundColor White
                }
            }
        }
        catch {
            Write-Host "    Could not read dataset permissions: $($_.Exception.Message)" -ForegroundColor Yellow
        }

        # -------------------------------------------------------------------
        # 3. RLS roles (optional)
        # -------------------------------------------------------------------
        if ($IncludeRLS) {
            Write-Host "    RLS Roles:" -ForegroundColor Cyan
            try {
                # The RLS roles are defined in the model; we query the dataset
                $rlsUri = "groups/$WorkspaceId/datasets/$dsId"
                $dsDetail = Invoke-PowerBIRestMethod -Url $rlsUri -Method Get | ConvertFrom-Json
                $isEffective = $dsDetail.isEffectiveIdentityRequired
                $isRLS       = $dsDetail.isEffectiveIdentityRolesRequired

                if (-not $isRLS) {
                    Write-Host "      No RLS roles defined on this dataset." -ForegroundColor Gray
                }
                else {
                    Write-Host "      RLS is enabled (effectiveIdentityRolesRequired = true)." -ForegroundColor Yellow

                    # Attempt to discover role assignments via the admin API
                    try {
                        $adminDsUri = "admin/datasets/$dsId/users"
                        $adminDsResponse = Invoke-PowerBIRestMethod -Url $adminDsUri -Method Get | ConvertFrom-Json
                        $rlsMembers = $adminDsResponse.value

                        foreach ($member in $rlsMembers) {
                            Write-Host "      - $($member.displayName) ($($member.emailAddress)) [$($member.datasetUserAccessRight)]" -ForegroundColor White
                            $rlsReport += [PSCustomObject]@{
                                DatasetName = $dsName
                                DatasetId   = $dsId
                                Member      = $member.displayName
                                Email       = $member.emailAddress
                                Access      = $member.datasetUserAccessRight
                            }
                        }
                    }
                    catch {
                        Write-Host "      Could not enumerate RLS members (admin API access required)." -ForegroundColor Yellow
                    }
                }
            }
            catch {
                Write-Host "      Could not inspect RLS configuration: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }

        Write-Host ""
    }

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------
    Write-Host "--- Permission Summary ---" -ForegroundColor Cyan
    Write-StatusLine "Total workspace members" "$($permissionReport.Count)" White
    Write-StatusLine "Admins"                  "$adminCount" $(if ($adminCount -gt 3) { 'Red' } else { 'Green' })
    Write-StatusLine "Service principals"      "$appCount"   $(if ($appCount -eq 0) { 'Yellow' } else { 'Green' })
    Write-StatusLine "Datasets in workspace"   "$($datasets.Count)" White

    if ($IncludeRLS) {
        Write-StatusLine "RLS role assignments found" "$($rlsReport.Count)" White
    }

    Write-Host "`n[OK] Permission audit complete.`n" -ForegroundColor Green
}
catch {
    Write-Error "Permission audit failed: $_"
}

return [PSCustomObject]@{
    WorkspacePermissions = $permissionReport
    RLSReport            = $rlsReport
}
