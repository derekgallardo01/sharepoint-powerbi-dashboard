# Contributing

Thank you for your interest in contributing to the SharePoint Power BI Dashboard project.

## Prerequisites

- **Node.js** 18.x LTS
- **npm** 9+
- **Gulp CLI**: `npm install -g gulp-cli`
- **PowerShell** 5.1+ or 7+
- **MicrosoftPowerBIMgmt** module: `Install-Module MicrosoftPowerBIMgmt`
- A **SharePoint Online** tenant with an App Catalog (for testing SPFx changes)
- A **Power BI Pro** or Premium Per User licence (for testing embed and health check changes)

## Setup

```bash
# Clone and install
git clone https://github.com/your-org/sharepoint-powerbi-dashboard.git
cd sharepoint-powerbi-dashboard/spfx-webpart
npm install

# Start the local workbench
gulp serve
```

## Development Workflow

1. Create a feature branch from `main`: `git checkout -b feature/your-change`
2. Make your changes.
3. Test locally:
   - **SPFx web part**: `gulp serve` and test in the SharePoint Workbench.
   - **PowerShell scripts**: Run with `-WhatIf` first, then test against a dev workspace.
   - **Power Automate flows**: Validate JSON with a schema linter, then test-import in a dev environment.
4. Verify the build passes: `gulp build`
5. Commit with a clear message and open a Pull Request against `main`.

## Code Style

- **TypeScript**: Follow existing patterns in the SPFx project. Use React functional or class components consistently with the existing codebase.
- **SPFx patterns**: Use `AadTokenProviderFactory` for token acquisition. Use the PnP SPFx React controls library where applicable.
- **PowerShell**: Use `[CmdletBinding(SupportsShouldProcess)]` on all scripts. Follow the `Write-StatusLine` convention for console output. Pass `Invoke-ScriptAnalyzer` with no errors.
- **Power Automate flows**: Follow the Logic Apps JSON schema. Include `metadata` with `name`, `description`, and `author` fields.

## Submitting Changes

1. Ensure TypeScript compiles without errors (`gulp build`).
2. Ensure PowerShell scripts pass `Invoke-ScriptAnalyzer`.
3. Ensure Power Automate JSON files are valid.
4. Include screenshots or HTML mockups for UI changes.
5. Open a Pull Request with a clear description of what changed and why.
