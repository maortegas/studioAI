# Automatic Dependency Installation

## Overview

The worker now includes **automatic dependency detection and installation** before executing tests. This ensures that when the AI adds new dependencies to `package.json` during implementation, they are automatically installed before tests run.

## Problem Statement

Previously, when the AI generated code that added new dependencies to `package.json`, the tests would fail with "Module not found" errors because `npm install` wasn't run to install the new dependencies.

**Example Scenario:**
1. AI generates test that requires `axios`
2. AI implements code and adds `axios` to `package.json`
3. Worker tries to run tests → ❌ FAIL: "Cannot find module 'axios'"

## Solution

The worker now automatically:
1. **Detects** when `package.json` has been modified
2. **Runs** `npm install` before executing tests
3. **Continues** with test execution using the newly installed dependencies

## Implementation

### Location

**File**: `packages/worker/src/worker.ts`
**Function**: `ensureDependenciesInstalled()` (lines 5525-5616)
**Used by**: `executeBatchTests()` (line 5661)

### Detection Logic

The system determines if `npm install` is needed by checking:

1. **package.json vs package-lock.json timestamps**
   - If `package.json` is more than 5 seconds newer than `package-lock.json` → **Install needed**
   - This catches cases where AI modified `package.json` to add dependencies

2. **package-lock.json existence**
   - If `package-lock.json` doesn't exist → **Install needed**
   - First-time setup or missing lock file

3. **node_modules directory existence**
   - If `node_modules` doesn't exist → **Install needed**
   - Fresh project or deleted dependencies

### Execution Flow

```
1. Test execution requested (executeBatchTests)
2. Call ensureDependenciesInstalled(projectPath)
3. Check detection conditions:
   ├─ package.json newer than package-lock.json? → Install
   ├─ package-lock.json missing? → Install
   └─ node_modules missing? → Install
4. If install needed:
   ├─ Log: "Running npm install before tests..."
   ├─ Execute: npm install
   ├─ Log result: Success or Failure
   └─ Continue to tests (even if install fails)
5. Execute tests with (hopefully) all dependencies available
```

## Console Output Examples

### Dependencies Up to Date

```
[Worker] ✅ Dependencies up to date, skipping npm install
[Worker] Executing batch tests (1-3) for session abc123...
```

### Dependencies Modified - Install Needed

```
[Worker] 📦 package.json modified (15s newer than package-lock.json)
[Worker] 🔧 Running npm install before tests...
[Worker] ✅ npm install completed successfully
[Worker] Executing batch tests (1-3) for session abc123...
```

### Missing node_modules

```
[Worker] 📦 node_modules not found, npm install needed
[Worker] 🔧 Running npm install before tests...
[Worker] ✅ npm install completed successfully
[Worker] Executing batch tests (1-3) for session abc123...
```

### Install Failed (Continues Anyway)

```
[Worker] 📦 package.json modified (8s newer than package-lock.json)
[Worker] 🔧 Running npm install before tests...
[Worker] ❌ npm install failed: <error output>
[Worker] Executing batch tests (1-3) for session abc123...
```

## Key Features

### 1. **Timestamp Comparison**

Uses file modification times (`mtimeMs`) to detect changes:

```javascript
const packageJsonModified = fs.statSync(packageJsonPath).mtimeMs;
const packageLockModified = fs.statSync(packageLockPath).mtimeMs;

if (packageJsonModified > packageLockModified + 5000) {
  // package.json is at least 5 seconds newer → install
  needsInstall = true;
}
```

**Why 5 seconds?** Prevents false positives from filesystem timestamp precision issues.

### 2. **Fail-Safe Execution**

Even if `npm install` fails, tests continue:

```javascript
if (installResult.success) {
  console.log('✅ npm install completed successfully');
} else {
  console.error('❌ npm install failed:', installResult.output);
  // Continue anyway - tests might still work with existing dependencies
}
```

**Rationale**: Some tests might pass with existing dependencies, or the install failure might be a network issue, not a code issue.

### 3. **Multiple Detection Methods**

Three independent checks ensure install runs when needed:
- Timestamp comparison (catches AI modifications)
- Lock file existence (catches fresh projects)
- node_modules existence (catches deleted dependencies)

## Integration Points

### TDD Workflow Integration

The dependency check runs **before every batch test execution**:

```
TDD Cycle:
1. Generate tests
2. Parse tests
3. Initialize TDD cycle
4. GREEN Phase:
   ├─ AI generates implementation
   ├─ AI may add dependencies to package.json
   ├─ ensureDependenciesInstalled() ← Runs here
   └─ Execute tests (with new dependencies)
5. REFACTOR Phase (if needed)
```

### Test Execution Points

Currently integrated in:
- ✅ `executeBatchTests()` - Batch test execution for TDD cycle

Future integration opportunities:
- Individual test suite execution
- Integration test execution
- E2E test execution

## Performance Considerations

### Time Cost

- **Check time**: ~1-5ms (filesystem stat operations)
- **Install time**: Varies (5-60 seconds depending on dependencies)

### Optimization

The check is **very fast** (filesystem operations only). The install only runs when truly needed, so performance impact is minimal:

- **No changes**: ~2ms overhead (just timestamp checks)
- **Changes detected**: Variable (depends on npm install duration)

### Frequency

Runs on **every batch test execution** during TDD:
- Average TDD session: 2-4 batches
- Average installs per session: 0-1 (most batches don't modify dependencies)

## Edge Cases Handled

### 1. **No package.json**
If the project has no `package.json`, the check is skipped (no error thrown).

### 2. **Filesystem Errors**
If stat operations fail, a warning is logged and the check continues:
```javascript
try {
  // Check logic
} catch (error) {
  console.warn('Could not check package.json modification time:', error);
}
```

### 3. **Install Failures**
If install fails, tests still run (might pass with cached dependencies or fail with better error messages).

### 4. **Concurrent Installs**
Node.js single-threaded nature prevents concurrent installs in the same worker process. If multiple workers run, npm's lock file prevents conflicts.

## Future Enhancements

### Potential Improvements

1. **Cache install results**
   - Store hash of package.json content
   - Skip install if hash matches (even if timestamps differ)

2. **Selective installs**
   - Parse package.json diff
   - Only install changed dependencies (`npm install <package>`)

3. **Parallel installs**
   - If multiple sessions need installs, batch them

4. **Smart detection**
   - Parse AI output for dependency additions
   - Pre-emptively install before code generation completes

5. **Other package managers**
   - Support yarn, pnpm detection and installation

## Configuration

### Current Settings

- **Timestamp threshold**: 5 seconds (hardcoded)
- **Install timeout**: None (relies on npm's default)
- **Fail behavior**: Continue with tests (hardcoded)

### Customization

To modify behavior, edit:
- **File**: `packages/worker/src/worker.ts`
- **Function**: `ensureDependenciesInstalled()`
- **Lines**: 5525-5616

Example: Change timestamp threshold to 10 seconds:
```javascript
if (packageJsonModified > packageLockModified + 10000) { // 10 seconds
  needsInstall = true;
}
```

## Testing the Feature

### Manual Test

1. Start a coding session with TDD
2. Modify `package.json` manually (add a dependency)
3. Wait for AI to run tests
4. Check worker logs for:
   ```
   [Worker] 📦 package.json modified (Xs newer than package-lock.json)
   [Worker] 🔧 Running npm install before tests...
   [Worker] ✅ npm install completed successfully
   ```

### Automated Test Scenarios

**Scenario 1: Fresh Project**
- ❌ No node_modules
- ✅ Should trigger install

**Scenario 2: AI Adds Dependency**
- ❌ package.json newer than package-lock.json
- ✅ Should trigger install

**Scenario 3: No Changes**
- ✅ All files up to date
- ✅ Should skip install

## Related Files

- `packages/worker/src/worker.ts` - Main implementation
- `CLAUDE.md` - Updated documentation (line 143)
- `docs/AUTOMATIC_DEPENDENCY_INSTALLATION.md` - This file

## Troubleshooting

### Tests Still Fail with "Module not found"

**Possible causes:**
1. Install failed (check logs for npm error)
2. Dependency not added to package.json by AI
3. Import path incorrect in test code

**Solution**: Check worker logs for install status and verify package.json content.

### Install Takes Too Long

**Possible causes:**
1. Many dependencies to install
2. Slow network connection
3. npm registry issues

**Solution**: Consider using npm cache or a faster registry (npmrc configuration).

### Install Runs Every Time

**Possible causes:**
1. File timestamps not updating correctly
2. package-lock.json not being generated
3. Filesystem synchronization issues (Docker, network drives)

**Solution**: Verify package-lock.json is being created and committed. Check filesystem timestamps with `ls -la`.
