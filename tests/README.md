# Testing

## Test Categories

### Script Validation Tests (`Test-HealthChecks.ps1`)

Pester v5 tests that validate the health-check PowerShell scripts without requiring a live Power BI environment. These tests verify:

- Scripts exist at expected paths
- CmdletBinding attributes and parameter declarations are correct
- SupportsShouldProcess (WhatIf) is enabled where applicable
- Help comments (.SYNOPSIS, .DESCRIPTION, .PARAMETER, .EXAMPLE) are present
- Error handling patterns (try/catch, ErrorActionPreference) are in place
- Helper functions are defined

## Prerequisites

- **PowerShell 5.1+** or **PowerShell 7+**
- **Pester v5+**: Install with `Install-Module Pester -MinimumVersion 5.0 -Scope CurrentUser`

## Running Tests

```powershell
# Run all tests
Invoke-Pester -Path .\tests\

# Run with detailed output
Invoke-Pester -Path .\tests\ -Output Detailed

# Run a specific test file
Invoke-Pester -Path .\tests\Test-HealthChecks.ps1

# Generate NUnit XML report for CI
Invoke-Pester -Path .\tests\ -OutputFormat NUnitXml -OutputFile .\tests\results.xml
```

## Test Categories Overview

| Category | Description | Requires Live Environment |
|---|---|---|
| Script validation | Structure, parameters, help comments | No |
| Integration | Actual Power BI API calls | Yes (Power BI workspace) |

## CI/CD Integration

### Azure DevOps Pipeline example

```yaml
steps:
  - task: PowerShell@2
    displayName: 'Run Pester Tests'
    inputs:
      targetType: 'inline'
      script: |
        Install-Module Pester -MinimumVersion 5.0 -Force -Scope CurrentUser
        $results = Invoke-Pester -Path .\tests\ -OutputFormat NUnitXml -OutputFile .\tests\results.xml -PassThru
        if ($results.FailedCount -gt 0) { exit 1 }
      pwsh: true

  - task: PublishTestResults@2
    inputs:
      testResultsFormat: 'NUnit'
      testResultsFiles: 'tests/results.xml'
    condition: always()
```

### GitHub Actions example

```yaml
- name: Run Pester Tests
  shell: pwsh
  run: |
    Install-Module Pester -MinimumVersion 5.0 -Force -Scope CurrentUser
    Invoke-Pester -Path .\tests\ -Output Detailed -CI
```

## Notes

- The script validation tests are offline tests and do not call the Power BI API.
- For integration testing against a real Power BI workspace, the MicrosoftPowerBIMgmt module and valid credentials are required.
- All health-check scripts support `-WhatIf` where applicable, which can be used to dry-run in CI without modifying anything.
