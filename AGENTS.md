# Repo guide

**Read `.ai/ai-rules.md` first.** It is the single source of truth for this repository's
conventions; this file only records the commands and gates that are cheapest to forget.
`.ai/project-summary.md` says where the project stands, and `readme.md` what the app does.

## Commands

```sh
npm run check                          # model tests, then the window checks: before every commit
node scripts/release-kind.mjs          # what the commits since the last release will bump: major, minor, patch, none
node scripts/deploy-azure.mjs --plan   # say what a deploy by hand would do, change nothing
npm run installer                      # check, then build and verify the Windows installer in release/
```

## The gates

1. **Every function has a comment, kept in step with the code. Every feature has a test.**
2. **Recipes are for a person at a bench**: strips not loose blocks, one operation per step, each
   step standing on its own, sizes that can be cut.
3. **Tests leave no trace**, and the owner's running app is never relaunched.
4. **One Azure site, released by the workflow.** `main` takes only pull requests that pass the
   `test` check; a merge is a public release, and the commit subject sets the version: do not
   deploy or bump by hand. The workflow runs no window checks, so run `npm run check` first. Check the signed-in account
   before any Azure change; never print the deployment token.
5. **The repository is public.** No credential, identifier, machine path or email in any file or
   commit message.
6. **Never report a result you did not see.** Quote what ran, or say you did not run it.
