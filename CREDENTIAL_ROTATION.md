# Credential Rotation List

Generated as part of the 2026-08-09 security audit (see `SECURITY_REPORT.md`'s "Second Audit Pass" section for full findings). These are real credentials that existed in this repository's history — the code fix (removing the hardcoded fallback, requiring explicit opt-in to reset) does not by itself invalidate a value that was already committed. **Rotate every item below.**

## Must rotate now

1. **`jashwanthd@stylecraftus.com`'s Supabase Auth password**
   - Was hardcoded as the fallback default (`"stylecraft123"`) in `scripts/create-admin-user.ts`, committed to this repository.
   - Anyone with read access to this repo (past or present) has known this password since it was committed.
   - **Action:** log in and change it via **Settings → Change Password** in the app (this also revokes every other active session for the account), or run:
     ```
     ADMIN_EMAIL=jashwanthd@stylecraftus.com ADMIN_PASSWORD=<new-strong-password> ADMIN_RESET_PASSWORD=true npx tsx scripts/create-admin-user.ts
     ```

2. **The 5 team member accounts' shared temporary password**
   - Was hardcoded as `"123456789"` in `scripts/create-team-users.ts`, committed to this repository, shared across all 5 accounts below.
   - `"123456789"` is also on this app's own common-password blocklist (`lib/password-policy.ts`) — it was never a strong password even before being committed.
   - Affected accounts: `support@stylecraftus.com`, `austin@stylecraftus.com`, `peterg@stylecraftus.com`, `rafap@stylecraftus.com`, `leolal@stylecraftus.com`.
   - **Action:** for each account that has **not yet completed its own first-login password change**, either have them log in and change it themselves, or force a reset with a real, unique password:
     ```
     TEAM_TEMP_PASSWORD=<new-strong-password> TEAM_RESET_PASSWORD=true npx tsx scripts/create-team-users.ts
     ```
     (This resets **all 5** to the same new temp value and re-flags `must_change_password`, forcing each to set their own real password on next login.) If any of these 5 people have already changed their password themselves, you don't strictly need to reset them again — but the *original* leaked value should be treated as compromised regardless, so confirm with them that they did change it away from `123456789`.

## Worth double-checking (not confirmed exposed, but unverifiable from code)

3. **`GOOGLE_REFRESH_TOKEN` (Google Drive integration)**
   - Not found committed anywhere in this repo or its history — this is not a "must rotate," but two things are worth confirming directly in Google Cloud Console since they can't be verified from code:
     - The OAuth scope actually granted to this token is `drive.file` (minimal — only files this app created), not the broader `drive` scope.
     - The token hasn't appeared in any log output. This pass fixed two spots in `lib/google-drive.ts` that were logging the full Google API error object (which can carry a live derived access token as an enumerable property) — check your Vercel log history for the strings `"Drive file update failed"` or `"Google Drive live upload error"` around any date before this fix shipped; if either appears with a large JSON blob attached (not just a short message), the access token may have been logged and the refresh token should be rotated as a precaution.

## Already checked — nothing to rotate

- **No API keys, JWT secrets, database connection strings, or other secrets were found committed** to this repository or its full git history (both this pass and the prior 2026-07-28 pass independently confirmed this via pattern-matching across every commit, plus a scan of the built `.next/static` client bundle output for every known provider key format).
- `.env.local` has never been committed (confirmed via `git log --all --full-history -- .env.local`).
- `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (or equivalent), `RAINFOREST_API_KEY`, and `RESEND_API_KEY` were all confirmed to live only in environment variables, never in code or logs.
