# Plan: Fix setuptools pkg_resources ModuleNotFoundError

This plan outlines the steps to resolve the `ModuleNotFoundError: No module named 'pkg_resources'` error that occurs when running `./scripts/update_dev.sh`.

## Context & Cause of Error
* **The Error:** Running `python manage.py migrate` fails on start-up with `ModuleNotFoundError: No module named 'pkg_resources'` when importing `django-polymorphic` (v3.1.0).
* **The Root Cause:** Starting with version `82.0.0`, `setuptools` removed `pkg_resources` entirely.
* **The Current Pin:** In `mstdb_manager/pyproject.toml`, setuptools is currently pinned to `"setuptools<84"`.
* **The Issue:** Since the current pin allows setuptools `<84`, `uv` resolves setuptools to version `83.0.0` in `mstdb_manager/uv.lock`. This version has `pkg_resources` removed, breaking `django-polymorphic` (and any other dependencies relying on legacy `pkg_resources`).
* **The Solution:** Re-pin setuptools to `"setuptools<81"` (or `"setuptools<82"`), which resolves to a version (like `80.10.2`) where `pkg_resources` is still present and supported.

---

## Proposed Changes

### 1. Update pyproject.toml
In `mstdb_manager/pyproject.toml`, update line 76:
```toml
# Old
"setuptools<84",

# New
"setuptools<81",
```

### 2. Update Lockfile
Regenerate `mstdb_manager/uv.lock` by running `uv lock` in the `mstdb_manager` directory (or using Docker if local `uv` is not present):
```bash
# Inside mstdb_manager/ directory
uv lock
```
Or run the equivalent container build to let `uv` sync and update the locked version.

### 3. Rebuild and Verify
Run the development update script to verify the solution:
```bash
./scripts/update_dev.sh
```

---

## Validation Plan
1. **Container Build:** Verify that the `trayectoriasafro-web` image builds successfully without warnings/errors.
2. **Migrations Execution:** Confirm that `python manage.py migrate` is executed successfully in the container during `./scripts/update_dev.sh`.
3. **Application Startup:** Ensure the containers start successfully and that the Django app responds without startup errors.
4. **Search Vector Population:** Confirm that `python manage.py populate_search_vectors` runs successfully at the end of the update script.

---

## Documentation
* Add an entry to `CHANGELOG.md` under the `[Unreleased]` section noting the fix:
  * "Fix `ModuleNotFoundError: No module named 'pkg_resources'` by restricting `setuptools` to `<81` in `mstdb_manager`."
