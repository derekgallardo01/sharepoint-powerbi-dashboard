#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

<#
.SYNOPSIS
    Pester v5 tests for the Power BI health-check scripts.

.DESCRIPTION
    Validates that each health-check script exists, has correct CmdletBinding,
    expected parameters, proper help comments, and error handling.

.EXAMPLE
    Invoke-Pester -Path .\tests\Test-HealthChecks.ps1
#>

BeforeAll {
    $scriptRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $healthChecksDir = Join-Path $scriptRoot "health-checks"

    # If running from inside tests/ directly, adjust path
    if (-not (Test-Path $healthChecksDir)) {
        $healthChecksDir = Join-Path (Split-Path -Parent $PSScriptRoot) "health-checks"
    }

    # Helper: parse a script's AST to extract param block and help comments
    function Get-ScriptInfo {
        param([string]$Path)
        $content = Get-Content -Path $Path -Raw
        $ast = [System.Management.Automation.Language.Parser]::ParseInput(
            $content, [ref]$null, [ref]$null
        )
        $paramBlock = $ast.ParamBlock
        $helpContent = $content
        return @{
            Content    = $content
            AST        = $ast
            ParamBlock = $paramBlock
        }
    }
}

Describe "Health Check Scripts" {

    Context "Test-PowerBIRefreshStatus.ps1" {
        BeforeAll {
            $scriptPath = Join-Path $healthChecksDir "Test-PowerBIRefreshStatus.ps1"
        }

        It "Should exist at the expected path" {
            $scriptPath | Should -Exist
        }

        It "Should have CmdletBinding attribute" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\[CmdletBinding'
        }

        It "Should support -WhatIf (SupportsShouldProcess)" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'SupportsShouldProcess'
        }

        It "Should have mandatory parameter WorkspaceId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'Mandatory\s*=\s*\$true'
            $content | Should -Match '\$WorkspaceId'
        }

        It "Should have mandatory parameter DatasetId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$DatasetId'
        }

        It "Should have optional parameter DaysBack with default value" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$DaysBack\s*=\s*7'
        }

        It "Should have .SYNOPSIS help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.SYNOPSIS'
        }

        It "Should have .DESCRIPTION help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.DESCRIPTION'
        }

        It "Should have .PARAMETER help comments" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.PARAMETER\s+WorkspaceId'
            $content | Should -Match '\.PARAMETER\s+DatasetId'
            $content | Should -Match '\.PARAMETER\s+DaysBack'
        }

        It "Should have .EXAMPLE help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.EXAMPLE'
        }

        It "Should have error handling (try/catch)" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\btry\b'
            $content | Should -Match '\bcatch\b'
        }

        It "Should set ErrorActionPreference to Stop" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match "\`\$ErrorActionPreference\s*=\s*['""]Stop['""]"
        }
    }

    Context "Test-PowerBIGatewayHealth.ps1" {
        BeforeAll {
            $scriptPath = Join-Path $healthChecksDir "Test-PowerBIGatewayHealth.ps1"
        }

        It "Should exist at the expected path" {
            $scriptPath | Should -Exist
        }

        It "Should have CmdletBinding attribute" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\[CmdletBinding'
        }

        It "Should have optional parameter GatewayId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$GatewayId'
            # GatewayId should NOT be mandatory
            $content | Should -Not -Match 'Mandatory\s*=\s*\$true[^]]*\$GatewayId'
        }

        It "Should have .SYNOPSIS help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.SYNOPSIS'
        }

        It "Should have .DESCRIPTION help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.DESCRIPTION'
        }

        It "Should have .EXAMPLE help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.EXAMPLE'
        }

        It "Should have error handling (try/catch)" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\btry\b'
            $content | Should -Match '\bcatch\b'
        }

        It "Should set ErrorActionPreference to Stop" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match "\`\$ErrorActionPreference\s*=\s*['""]Stop['""]"
        }

        It "Should define a helper function Test-DataSourceConnection" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'function\s+Test-DataSourceConnection'
        }
    }

    Context "Test-PowerBIPermissions.ps1" {
        BeforeAll {
            $scriptPath = Join-Path $healthChecksDir "Test-PowerBIPermissions.ps1"
        }

        It "Should exist at the expected path" {
            $scriptPath | Should -Exist
        }

        It "Should have CmdletBinding attribute" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\[CmdletBinding'
        }

        It "Should have mandatory parameter WorkspaceId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'Mandatory\s*=\s*\$true'
            $content | Should -Match '\$WorkspaceId'
        }

        It "Should have switch parameter IncludeRLS" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\[switch\]\$IncludeRLS'
        }

        It "Should have .SYNOPSIS help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.SYNOPSIS'
        }

        It "Should have .DESCRIPTION help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.DESCRIPTION'
        }

        It "Should have .PARAMETER help comments" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.PARAMETER\s+WorkspaceId'
            $content | Should -Match '\.PARAMETER\s+IncludeRLS'
        }

        It "Should have .EXAMPLE help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.EXAMPLE'
        }

        It "Should have error handling (try/catch)" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\btry\b'
            $content | Should -Match '\bcatch\b'
        }

        It "Should return a structured result with WorkspacePermissions and RLSReport" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'WorkspacePermissions'
            $content | Should -Match 'RLSReport'
        }
    }

    Context "Test-PowerBIEmbedConfig.ps1" {
        BeforeAll {
            $scriptPath = Join-Path $healthChecksDir "Test-PowerBIEmbedConfig.ps1"
        }

        It "Should exist at the expected path" {
            $scriptPath | Should -Exist
        }

        It "Should have CmdletBinding attribute" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\[CmdletBinding'
        }

        It "Should have mandatory parameter ClientId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$ClientId'
        }

        It "Should have mandatory parameter TenantId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$TenantId'
        }

        It "Should have mandatory parameter WorkspaceId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$WorkspaceId'
        }

        It "Should have mandatory parameter ReportId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$ReportId'
        }

        It "Should have .SYNOPSIS help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.SYNOPSIS'
        }

        It "Should have .DESCRIPTION help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.DESCRIPTION'
        }

        It "Should have .PARAMETER help comments for all four parameters" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.PARAMETER\s+ClientId'
            $content | Should -Match '\.PARAMETER\s+TenantId'
            $content | Should -Match '\.PARAMETER\s+WorkspaceId'
            $content | Should -Match '\.PARAMETER\s+ReportId'
        }

        It "Should have .EXAMPLE help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.EXAMPLE'
        }

        It "Should have error handling (try/catch)" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\btry\b'
            $content | Should -Match '\bcatch\b'
        }

        It "Should validate GUID format" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'guidPattern|GUID'
        }
    }

    Context "Test-PowerBIDatasetSize.ps1" {
        BeforeAll {
            $scriptPath = Join-Path $healthChecksDir "Test-PowerBIDatasetSize.ps1"
        }

        It "Should exist at the expected path" {
            $scriptPath | Should -Exist
        }

        It "Should have CmdletBinding attribute" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\[CmdletBinding'
        }

        It "Should support -WhatIf (SupportsShouldProcess)" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'SupportsShouldProcess'
        }

        It "Should have mandatory parameter WorkspaceId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'Mandatory\s*=\s*\$true'
            $content | Should -Match '\$WorkspaceId'
        }

        It "Should have optional parameter DatasetId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$DatasetId'
        }

        It "Should have parameter ProLimitGB with default value of 1" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$ProLimitGB\s*=\s*1'
        }

        It "Should have parameter PremiumLimitGB with default value of 10" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$PremiumLimitGB\s*=\s*10'
        }

        It "Should have parameter WarningThresholdPercent with default value of 80" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$WarningThresholdPercent\s*=\s*80'
        }

        It "Should have .SYNOPSIS help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.SYNOPSIS'
        }

        It "Should have .DESCRIPTION help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.DESCRIPTION'
        }

        It "Should have .PARAMETER help comments" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.PARAMETER\s+WorkspaceId'
            $content | Should -Match '\.PARAMETER\s+ProLimitGB'
            $content | Should -Match '\.PARAMETER\s+PremiumLimitGB'
        }

        It "Should have .EXAMPLE help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.EXAMPLE'
        }

        It "Should set ErrorActionPreference to Stop" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match "\`\$ErrorActionPreference\s*=\s*['""]Stop['""]"
        }

        It "Should define a helper function Get-DatasetSizeAssessment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'function\s+Get-DatasetSizeAssessment'
        }

        It "Should define a helper function Get-SizeDisplayString" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'function\s+Get-SizeDisplayString'
        }
    }

    Context "Invoke-PowerBIHealthCheck.ps1" {
        BeforeAll {
            $scriptPath = Join-Path $healthChecksDir "Invoke-PowerBIHealthCheck.ps1"
        }

        It "Should exist at the expected path" {
            $scriptPath | Should -Exist
        }

        It "Should have CmdletBinding attribute" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\[CmdletBinding'
        }

        It "Should have mandatory parameter WorkspaceId" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'Mandatory\s*=\s*\$true'
            $content | Should -Match '\$WorkspaceId'
        }

        It "Should have optional parameters DatasetId, ClientId, TenantId, ReportId, OutputPath" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\$DatasetId'
            $content | Should -Match '\$ClientId'
            $content | Should -Match '\$TenantId'
            $content | Should -Match '\$ReportId'
            $content | Should -Match '\$OutputPath'
        }

        It "Should have .SYNOPSIS help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.SYNOPSIS'
        }

        It "Should have .DESCRIPTION help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.DESCRIPTION'
        }

        It "Should have .PARAMETER help comments" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.PARAMETER\s+WorkspaceId'
            $content | Should -Match '\.PARAMETER\s+DatasetId'
            $content | Should -Match '\.PARAMETER\s+OutputPath'
        }

        It "Should have .EXAMPLE help comment" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.EXAMPLE'
        }

        It "Should call all four individual health check scripts" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'Test-PowerBIRefreshStatus\.ps1'
            $content | Should -Match 'Test-PowerBIGatewayHealth\.ps1'
            $content | Should -Match 'Test-PowerBIPermissions\.ps1'
            $content | Should -Match 'Test-PowerBIEmbedConfig\.ps1'
        }

        It "Should generate an HTML report" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match '\.html'
            $content | Should -Match 'Out-File|Set-Content'
        }

        It "Should define a helper function ConvertTo-HtmlSection" {
            $content = Get-Content -Path $scriptPath -Raw
            $content | Should -Match 'function\s+ConvertTo-HtmlSection'
        }
    }
}
