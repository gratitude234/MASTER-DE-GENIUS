# Admin System — Phase 1

The Master De Genius admin workspace lives at `/admin`. Use it to run the platform, support students, keep question quality up, manage Premium Class leads, and check revenue and system health. It is built on the systems the student product already uses, and nothing in it runs in parallel to them.

## Before deploying

1. Back up the database.
2. Apply `supabase/migrations/20260914000001_admin_system.sql`.
3. Deploy the application.
4. Create the first Super Admin (see below).

The migration only adds things. It does not change any student table's data, and it makes no student-facing policy looser.

## Creating the first Super Admin

The person must already have a normal Master De Genius account, so they should sign up in the app first. Then, in the **Supabase SQL editor** for the target project, run:

```sql
select public.bootstrap_first_super_admin('owner@example.com');
```

- Only the database owner can run this: in practice, the SQL editor. It cannot be called through the API, not even with the service key.
- It refuses to run once any active Super Admin exists, so it cannot be used to take over a platform that already has one.
- The action is written to the audit log as `admin.bootstrap`.

After that, add every other administrator from **Admin & Roles → Add administrator** in the UI. That flow requires a reason and records who granted access.

### Existing CRM admins

Anyone added to `app_admins` before this release could only reach the Premium Classes CRM. They become **Classes / CRM Admin** and keep exactly that access. Nobody is silently promoted. If the platform owner was one of them, they still run the bootstrap statement above to become Super Admin.

The old statement `insert into public.app_admins (user_id) values (...)` now fails on purpose. A membership must state its role, and changes should go through the audited UI.

## Roles

| Role | Can do |
| --- | --- |
| Super Admin | Everything, including payments, manual Master grants, suspensions, admin roles, System and the Audit Log |
| Academic Admin | Students (read), Academics, question bank (edit, disable), external question blocklist, sessions (read) |
| Support Admin | Students (read), sessions (read, and finalise overdue ones), support cases |
| Classes / CRM Admin | Premium Class leads: assign, change status, add notes, WhatsApp |

The role-to-permission matrix is stored in `admin_role_permissions`, and **Admin & Roles** shows the live matrix. To add a Finance role later:

1. `alter type public.admin_role add value 'finance_admin';`
2. Insert its rows into `admin_role_permissions`, for example `payments.view`.
3. Add the label to `features/admin/permissions.ts`.

No route, guard or database function needs to change.

## How access is enforced

- **Routes.** Middleware sends signed-out visitors to login. `app/admin/layout.tsx` requires an active membership, and every page calls `requireAdminPermission(...)` on the server. Students are redirected to `/home` and never see the workspace.
- **Actions.** Every server action calls `authorizeAdmin(permission)` first: session, suspension, membership, then permission. A test checks this for every action.
- **Database.** Every privileged write is a `SECURITY DEFINER` function that only `service_role` can execute. Each function checks the acting admin's permission again inside PostgreSQL and writes its audit row in the same transaction. Even if a server guard is skipped by mistake, the write is refused, and no change can commit without its audit entry.
- **RLS.** Every new table has RLS enabled, no grants to `anon` or `authenticated`, and a `RESTRICTIVE` deny policy. Students cannot read `app_admins`, the audit log, notes, support cases, blocks or suspensions through PostgREST. Direct service-role writes to `app_admins` and to `premium_class_leads` updates have also been revoked, so those changes can only go through the audited functions.
- **Safeguards.** A trigger stops the platform from losing its last active Super Admin, whether through the UI, a SQL edit or deleting an auth user. Nobody can change their own admin access.
- **Audit log.** `admin_audit_log` refuses `UPDATE`, `DELETE` and `TRUNCATE` from every role, including the table owner.

The service-role key is used only in server-only modules. A test fails if any client component imports it.

## Modules

| Route | Purpose |
| --- | --- |
| `/admin` | Overview. Items that need attention, plus figures for students, learning, monetisation, classes, support, question quality and platform health |
| `/admin/students`, `/admin/students/[id]` | Search, filters and pagination. The profile shows plan, preparation, academic snapshot, sessions, payments, class requests and support cases, with grant, suspend and reactivate controls |
| `/admin/academics` | Subject and topic accuracy, the most-failed questions, and repeated mistakes over a date window |
| `/admin/questions`, `/new`, `/[id]` | Internal question bank: create, edit, activate, flag and disable, with no deletion |
| `/admin/questions/external` | Inspect a frozen external question, see the most-missed ones, and block or unblock |
| `/admin/exams`, `/admin/exams/[kind]/[id]` | Session diagnosis: frozen questions, answers, sync receipts, and finalising an overdue timed session |
| `/admin/classes`, `/admin/classes/[id]` | Premium Classes CRM: owner, lifecycle, private notes, status history, WhatsApp |
| `/admin/payments` | Paystack ledger (read-only) and manual grants, listed separately |
| `/admin/support`, `/admin/support/[id]` | Internal support cases: open, in progress, resolved |
| `/admin/analytics` | Weekly acquisition, engagement, conversion and class funnel |
| `/admin/system` | Question providers, AI explanations, Paystack configuration and webhooks, application configuration |
| `/admin/admins` | Admin memberships and the permission matrix |
| `/admin/audit-log` | Every sensitive action, with before and after state |
| `/suspended` | Where a suspended account is sent |

## Behaviour worth knowing

**Manual Master grants** (`admin_grant_master_access`)
- A grant can only extend access, never shorten it.
- "Add days" extends from the current expiry, using the same rule as a payment.
- Grants never create or alter payment rows, `total_paid_kobo` or `last_payment_id`.
- The entitlement event is stored with `source = 'admin'`, the admin who did it and the reason. The student product resolves access through the same `user_entitlements` row it already uses.

**Revenue**
- Revenue counts live-mode successful Paystack payments only. Test-mode payments are counted separately.
- Amounts stay in kobo and become naira only at display, through the same formatter the pricing page uses.

**Question blocklist**
- Blocks are keyed by provider, exam, subject and provider question id, because providers reuse numeric ids across subjects.
- `fetchCanonicalQuestions`, the one entry point both session engines share, passes blocked ids to the provider and filters the result as well. Neither engine was modified.
- If the blocklist lookup fails, sessions are built as they were before and the failure is logged. A lookup failure never blocks practice.
- This is the one deliberate engine change: `tests/engine-manifest.json` was re-recorded for `features/questions/service.ts` only.

**Internal question edits**
- Active questions are protected by the M2 immutability triggers. An edit moves the question to draft, applies the change and re-activates it in one audited transaction, so the activation checks run again.
- Sessions that already started keep their frozen snapshot.
- Editing a live question requires a reason.

**Suspension**
- Suspension records the suspension (audited) and applies a Supabase Auth ban.
- Every page refuses the account immediately, and the account cannot sign in or refresh a session.
- API calls made with an access token issued before the suspension stay valid until that token expires (the Supabase JWT lifetime, one hour by default).
- If the Auth half fails, repeating the action finishes it.

**Session recovery**
- An admin can only finalise a timed session whose authoritative time has already run out.
- It calls the engine's own `submit_exam_attempt` or `complete_practice_session`.
- No answer or score can be edited anywhere in the admin workspace.

**CRM notes**
- Notes are append-only rows in `admin_internal_notes`, recorded with their author. The legacy `admin_notes` column is shown read-only as "Earlier note".
- The audit trail records that a note was added, but not its text.
- The WhatsApp message contains only the student's first name, exam and subject.

## Testing

- `tests/admin-database.test.mjs` runs the real migrations in PGlite. It covers browser-role denial, self-promotion, the permission matrix, bootstrap, the last-Super-Admin guard, restricted roles being refused, manual grants, audit immutability, CRM privacy, support cases, blocks, question editing, student search, suspension, overdue finalisation, academic accuracy and the read models.
- `tests/admin-logic.test.mjs` covers validation, blocklist filtering, navigation, error mapping, kobo formatting, the academic snapshot, and source-level checks that every action authorizes first, every page requires a permission, and no client component can reach the service role.
- `tests/premium-classes.test.mjs` was updated so the CRM route and service tests check role-based authorization and the audited update path.

## Deferred

- Editing passages and question images in the admin UI. Existing ones are kept on edit.
- Student-submitted support tickets. Support still starts in WhatsApp through Need Help?.
- Revoking or shortening paid access, and refunds. Reversals remain a manual Paystack process.
- Legacy `aloc` provider traffic telemetry. That transport does not record usage, so the System page shows "Not tracked" instead of zeros.
- Client-side sync failures. Students' devices do not report them to the server.
- CSV export, bulk actions and scheduled reports.
