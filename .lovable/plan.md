## Goal
Let managers add a teammate by email even when that person hasn't signed up yet. The teammate gets an email invite; when they sign up with that email, they're automatically linked to the inviting manager and appear on the dashboard.

## Changes

### 1. Database
- New table `team_invites`: `manager_id`, `email` (lowercased, unique per manager), `status` (`pending`, `accepted`, `revoked`), `token` (random, used in email link), `accepted_at`.
- GRANTs + RLS: manager can view/insert/revoke their own invites; service role full access.
- Update `handle_new_user` trigger: after creating the profile, look for a `pending` invite matching the new user's email. If found, set `profiles.manager_id` to the invite's manager, upsert `user_roles` (`employee`), and mark the invite `accepted`.

### 2. Email
- Set up Lovable Emails infrastructure (requires email domain — user will be prompted via the setup dialog if none exists).
- Scaffold the transactional email system.
- Add a branded "You've been invited to join {manager name}'s team" template with a CTA button linking to `/auth?invite={token}`.

### 3. Server functions (`src/lib/manager.functions.ts`)
- Rewrite `addReport`:
  1. Normalize email.
  2. If a profile with that email exists → link immediately as today.
  3. Otherwise create a `team_invites` row and send the invite email. Return `{ status: "invited" | "linked" }`.
- New `listPendingInvites` for the manager UI.
- New `revokeInvite`.

### 4. Manager UI (`src/routes/_authenticated/manager.tsx`)
- After adding: toast says "Invite sent" or "Added to team" based on result.
- New "Pending invites" section listing email, sent date, and a Revoke button.

### 5. Auth flow
- `/auth` page reads `?invite=<token>` and shows "You're joining {manager name}'s team — sign up to accept." The token itself isn't needed to link (the trigger matches by email), but it's used to surface the context and prefill nothing sensitive.

## Out of scope
- Reminder emails / invite expiry (can add later).
- Bulk CSV invite.
- Editing pending invite email (revoke + resend instead).
