# Repo guide

**Read `.ai/ai-rules.md` first.** It is the single source of truth for this repository's
conventions; this file only records the commands and gates that are cheapest to forget.
`.ai/project-summary.md` says where the project stands, and `readme.md` what the app does.

## Commands

```sh
npm run check                          # model tests, then the window checks: before every commit
npm run deploy -- --bump=patch         # check, upload, verify by hash; patch, minor or major by the change
node scripts/deploy-azure.mjs --plan   # say what a deploy would do, change nothing
npm run installer                      # check, then build and verify the Windows installer in release/
```

## The gates

1. **Every function has a comment, kept in step with the code. Every feature has a test.**
2. **Recipes are for a person at a bench**: strips not loose blocks, one operation per step, each
   step standing on its own, sizes that can be cut.
3. **Tests leave no trace**, and the owner's running app is never relaunched.
4. **One Azure site.** Check the signed-in account before any Azure change; never print the
   deployment token.
5. **The repository is public.** No credential, identifier, machine path or email in any file or
   commit message.
6. **Never report a result you did not see.** Quote what ran, or say you did not run it.
