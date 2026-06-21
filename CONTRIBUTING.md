# Contributing

Thanks for helping improve OmniPlayr's official plugins.

## Before opening a pull request

1. Create or update a plugin under a folder whose name is its registry ID, such as `example@built-in`.
2. Put full-stack packages in `backend/` and `frontend/`; a backend-only package may live directly in the plugin folder.
3. Ensure every package manifest includes matching `id` and `author` fields, a `backend` or `frontend` type, and a semantic version.
4. Bump the version of every changed package and update its changelog.
5. Add or update usage documentation and tests where practical.
6. Never commit `.env` files, access tokens, provider credentials, caches, or generated tunnel settings.

Use a package-level `.omniplayrignore` to keep development-only files out of registry archives. The CLI falls back to `.gitignore` if that file is absent.

## Changelog format

Every plugin changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning. Keep releases newest first using this structure:

```markdown
# Changelog

All notable changes to `plugin@built-in` are documented here. This changelog follows Keep a Changelog and uses Semantic Versioning.

## [Unreleased]

## [1.2.3] - YYYY-MM-DD

### Added

- Describe the user-visible change.
```

Use only the categories that apply: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`. Move entries from `Unreleased` into a dated version section when releasing.

## Registry publishing

Merges to `main` are published automatically. The workflow detects which plugin component changed, copies it into a temporary directory matching its manifest `id`, and runs `omniplayr publish` with the repository's encrypted registry token. Contributors should never add a token to a branch or pull request.

Registry packages are malware-scanned before becoming downloadable, so a newly published version may take up to 24 hours to appear.

Maintainers can use the workflow's **Run workflow** button to republish all tracked packages.
