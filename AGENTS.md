# ForgePad working preferences

- Commit meaningful, tested stages frequently. Do not leave completed features only in the working tree.
- Run the relevant local checks, then push authorized changes and inspect GitHub Actions for the exact pushed SHA. Report hosted CI as passing only after it actually succeeds; fix failures and verify again.
- For requested desktop changes, build, sign, verify, and install the newest ForgePad in `/Applications/ForgePad.app`. Source changes alone do not update the installed app.
- After verifying the replacement, move older duplicate ForgePad application bundles to Trash. Only clean bundles whose identifier is `dev.forgepad.desktop`; preserve other apps, source code, user drafts, progress, recordings, and models. Never replace a newer installed version with an older one.
- Keep the sidebar close/show control at the upper left and prefer neutral, readable surfaces and clear practice actions.
