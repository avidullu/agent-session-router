# Router 0.2.2 release preparation

This branch prepares a release; version metadata and a dated changelog do not
mean the Marketplace has been updated. The owner merges and approves publishing.

Before tagging:

- Require the merged release head's CI, including Node 22 storage tests and
  native Windows results; run `npm run ci:check` locally.
- Package with `npx @vscode/vsce package -o agent-session-router-0.2.2.vsix`.
  Inspect the VSIX manifest/version, README/changelog, compiled health commands
  and production `chokidar` dependency. Tests, local configuration and diagnostics
  must not be packaged.
- Exercise Collection Status, Open Archive, manual export and opt-in watching
  on the candidate using synthetic sessions, not personal conversations.
- Sync the exact reviewed commit to GitHub. Confirm `v0.2.2` is unused and points
  to the approved head when created. The publish workflow refuses mismatched tags.

Publish only after merge and owner approval. GitHub runs the Marketplace job;
the matching Forgejo tag is retained for source history without a duplicate
publication. `VSCE_PAT` stays in the existing GitHub secret. Open VSX is optional
and is skipped when its separate token is absent.

After publication, verify Marketplace version 0.2.2 and the new command listing,
then check an installed extension's version and Collection Status. Record the
release commit and results. The hub is already published as 0.3.0; this release
does not install or upgrade it, enable watching, or move archive data.

For a regression, preserve configuration and archives. An owner can install the
previous verified 0.2.1 VSIX while a reviewed patch is prepared; do not overwrite
the published 0.2.2 version or delete user archives.
