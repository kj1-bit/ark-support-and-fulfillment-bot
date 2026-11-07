$ErrorActionPreference='Stop'
$branch=(git branch --show-current).Trim()
if($branch -ne 'integration/v2-complete-runtime'){throw "Expected integration/v2-complete-runtime, found $branch"}
if(git status --porcelain){throw 'Working tree must be clean before running the committed hardening gate.'}
npm.cmd run test:hardening
npm.cmd run test:persistence
npm.cmd run test:runtime
npm.cmd run test:security
npm.cmd test
node --check .\tests\hardening\lifecycle-hardening.test.js
node --check .\tests\hardening\migration-hardening.test.js
node --check .\tests\hardening\recovery-hardening.test.js
node --check .\tests\hardening\boundary-hardening.test.js
node --check .\tests\hardening\failure-isolation.test.js
git diff --check
Write-Host 'Combined V2 hardening gate passed.'
