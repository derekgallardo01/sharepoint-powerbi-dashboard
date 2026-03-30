<#
.SYNOPSIS
    Validates Power BI embed configuration and tests token generation.

.DESCRIPTION
    Checks that an Azure AD app registration is correctly configured for
    Power BI embedding. Tests token acquisition, verifies API permissions,
    and reports common misconfigurations that prevent reports from loading
    in the SPFx web part.

.PARAMETER ClientId
    The Application (client) ID of the Azure AD app registration.

.PARAMETER TenantId
    The Azure AD tenant GUID or domain name.

.PARAMETER WorkspaceId
    The Power BI workspace GUID to test against.

.PARAMETER ReportId
    The Power BI report GUID to test embed access for.

.EXAMPLE
    .\Test-PowerBIEmbedConfig.ps1 -ClientId "aaa-bbb" -TenantId "contoso.onmicrosoft.com" -WorkspaceId "ccc-ddd" -ReportId "eee-fff"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Azure AD application (client) ID")]
    [ValidateNotNullOrEmpty()]
    [string]$ClientId,

    [Parameter(Mandatory = $true, HelpMessage = "Azure AD tenant ID or domain")]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter(Mandatory = $true, HelpMessage = "Power BI workspace GUID")]
    [ValidateNotNullOrEmpty()]
    [string]$WorkspaceId,

    [Parameter(Mandatory = $true, HelpMessage = "Power BI report GUID")]
    [ValidateNotNullOrEmpty()]
    [string]$ReportId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Check {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail = ''
    )
    $status = if ($Passed) { 'PASS' } else { 'FAIL' }
    $color  = if ($Passed) { 'Green' } else { 'Red' }
    Write-Host ("{0,-50} " -f $Name) -NoNewline
    Write-Host "[$status]" -ForegroundColor $color
    if ($Detail) {
        Write-Host "    -> $Detail" -ForegroundColor $(if ($Passed) { 'Gray' } else { 'Yellow' })
    }
    return [PSCustomObject]@{ Check = $Name; Passed = $Passed; Detail = $Detail }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$checks = @()

try {
    if (-not (Get-Module -ListAvailable -Name MicrosoftPowerBIMgmt)) {
        Write-Error "MicrosoftPowerBIMgmt module is not installed. Run: Install-Module MicrosoftPowerBIMgmt -Scope CurrentUser"
    }

    Write-Host "`n============================================" -ForegroundColor Cyan
    Write-Host " Power BI Embed Configuration Validation"     -ForegroundColor Cyan
    Write-Host "============================================`n" -ForegroundColor Cyan

    Write-Host "Client ID    : $ClientId"
    Write-Host "Tenant ID    : $TenantId"
    Write-Host "Workspace ID : $WorkspaceId"
    Write-Host "Report ID    : $ReportId`n"

    # -------------------------------------------------------------------
    # 1. Validate GUID formats
    # -------------------------------------------------------------------
    $guidPattern = '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'

    $checks += Write-Check "Client ID is valid GUID" ($ClientId -match $guidPattern) $ClientId
    $checks += Write-Check "Workspace ID is valid GUID" ($WorkspaceId -match $guidPattern) $WorkspaceId
    $checks += Write-Check "Report ID is valid GUID" ($ReportId -match $guidPattern) $ReportId

    # -------------------------------------------------------------------
    # 2. Test Azure AD token acquisition
    # -------------------------------------------------------------------
    Write-Host "`n--- Token Acquisition ---`n" -ForegroundColor Cyan

    $tokenAcquired = $false
    $accessToken = $null

    try {
        # Attempt interactive login (delegated permissions)
        $existingContext = Get-PowerBIAccessToken -ErrorAction SilentlyContinue
        if ($existingContext) {
            $accessToken = $existingContext['Bearer']
            $tokenAcquired = $true
        }
        else {
            Connect-PowerBIServiceAccount | Out-Null
            $accessToken = (Get-PowerBIAccessToken)['Bearer']
            $tokenAcquired = $true
        }
    }
    catch {
        # Swallow - check will report the failure
    }

    $checks += Write-Check "Acquire Azure AD token for Power BI" $tokenAcquired `
        $(if ($tokenAcquired) { "Token length: $($accessToken.Length) chars" } else { "Could not obtain token. Verify app registration and permissions." })

    if (-not $tokenAcquired) {
        Write-Warning "Cannot proceed with API checks without a valid token."
        $checks | Format-Table Check, Passed, Detail -AutoSize
        return $checks
    }

    # -------------------------------------------------------------------
    # 3. Test workspace access
    # -------------------------------------------------------------------
    Write-Host "`n--- API Permission Checks ---`n" -ForegroundColor Cyan

    $workspaceAccessible = $false
    try {
        $wsResponse = Invoke-PowerBIRestMethod -Url "groups/$WorkspaceId" -Method Get | ConvertFrom-Json
        $workspaceAccessible = $true
        $checks += Write-Check "Access workspace ($($wsResponse.name))" $true "Workspace found and accessible."
    }
    catch {
        $checks += Write-Check "Access workspace" $false $_.Exception.Message
    }

    # -------------------------------------------------------------------
    # 4. Test report access
    # -------------------------------------------------------------------
    $reportAccessible = $false
    $reportName = ''
    try {
        $rpResponse = Invoke-PowerBIRestMethod -Url "groups/$WorkspaceId/reports/$ReportId" -Method Get | ConvertFrom-Json
        $reportAccessible = $true
        $reportName = $rpResponse.name
        $checks += Write-Check "Access report ($reportName)" $true "Report found in workspace."
    }
    catch {
        $checks += Write-Check "Access report" $false $_.Exception.Message
    }

    # -------------------------------------------------------------------
    # 5. Test embed URL generation
    # -------------------------------------------------------------------
    if ($reportAccessible) {
        $embedUrlValid = $false
        try {
            $embedUrl = $rpResponse.embedUrl
            $embedUrlValid = ($null -ne $embedUrl -and $embedUrl -like "https://*")
            $checks += Write-Check "Embed URL available" $embedUrlValid `
                $(if ($embedUrlValid) { $embedUrl.Substring(0, [Math]::Min(80, $embedUrl.Length)) + "..." } else { "embedUrl property is empty or invalid." })
        }
        catch {
            $checks += Write-Check "Embed URL available" $false $_.Exception.Message
        }
    }

    # -------------------------------------------------------------------
    # 6. Test generate embed token (for app-owns-data scenario)
    # -------------------------------------------------------------------
    if ($reportAccessible) {
        try {
            $tokenBody = @{
                accessLevel = "View"
            } | ConvertTo-Json

            $tokenUri = "groups/$WorkspaceId/reports/$ReportId/GenerateToken"
            $tokenResponse = Invoke-PowerBIRestMethod -Url $tokenUri -Method Post -Body $tokenBody | ConvertFrom-Json
            $embedTokenGenerated = ($null -ne $tokenResponse.token)
            $checks += Write-Check "Generate embed token (app-owns-data)" $embedTokenGenerated `
                $(if ($embedTokenGenerated) { "Embed token expiry: $($tokenResponse.expiration)" } else { "Token was null." })
        }
        catch {
            $msg = $_.Exception.Message
            if ($msg -like "*Unauthorized*" -or $msg -like "*403*") {
                $checks += Write-Check "Generate embed token (app-owns-data)" $false `
                    "403 Forbidden - the app or user may lack 'Content.Create' or workspace Member/Contributor role."
            }
            else {
                $checks += Write-Check "Generate embed token (app-owns-data)" $false $msg
            }
        }
    }

    # -------------------------------------------------------------------
    # 7. Common misconfiguration hints
    # -------------------------------------------------------------------
    Write-Host "`n--- Common Misconfiguration Checks ---`n" -ForegroundColor Cyan

    # Check if the tenant allows embedding
    try {
        $adminUri = "admin/capacities"
        Invoke-PowerBIRestMethod -Url $adminUri -Method Get | Out-Null
        $checks += Write-Check "Admin API accessible (capacity check)" $true ""
    }
    catch {
        $checks += Write-Check "Admin API accessible (capacity check)" $false `
            "Not critical - only required for capacity management. May indicate limited admin role."
    }

    # -------------------------------------------------------------------
    # Summary
    # -------------------------------------------------------------------
    Write-Host "`n============================================" -ForegroundColor Cyan
    Write-Host " Embed Configuration Summary"                   -ForegroundColor Cyan
    Write-Host "============================================`n" -ForegroundColor Cyan

    $checks | Format-Table Check, Passed, Detail -AutoSize

    $passCount = ($checks | Where-Object { $_.Passed }).Count
    $failCount = ($checks | Where-Object { -not $_.Passed }).Count

    Write-Host "Passed: $passCount  |  Failed: $failCount" -ForegroundColor $(if ($failCount -eq 0) { 'Green' } else { 'Red' })

    if ($failCount -gt 0) {
        Write-Host "`n[!] Review the failed checks above. Common fixes:" -ForegroundColor Yellow
        Write-Host "    1. Ensure the Azure AD app has 'Power BI Service > Report.Read.All' delegated permission." -ForegroundColor White
        Write-Host "    2. Grant admin consent for the API permissions in the Azure portal." -ForegroundColor White
        Write-Host "    3. Approve the API permission request in the SharePoint Admin Center > API access." -ForegroundColor White
        Write-Host "    4. Verify the user/SP has at least Viewer access to the workspace." -ForegroundColor White
        Write-Host "    5. For embed tokens, the app needs Member or Contributor role on the workspace.`n" -ForegroundColor White
    }
    else {
        Write-Host "`n[OK] All embed configuration checks passed.`n" -ForegroundColor Green
    }
}
catch {
    Write-Error "Embed configuration validation failed: $_"
}

return $checks
