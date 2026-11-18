# Practice dashboard

A private dashboard for running the practice: clients, projects, phases, discussions, agreements,
payments and documents. It exists for one situation in particular — work that starts on a verbal or
WhatsApp agreement and later turns into a dispute over scope, deadlines or money. Everything here is
designed to put things **in writing, early**: what was agreed, every scope change and its effect on
dates and fees, every payment, and a shareable agreement the client accepts before (or early in) the
work.

> **No backend yet.** Data lives in the browser. The passcode, link revocation and acceptance storage
> are placeholders, described honestly below. The data layer is built so a backend can replace it
> without touching the UI.

---

## 1. Architecture

```
app/
  dashboard/**            dashboard routes (client components, noindex, passcode-gated)
  agreement/[token]/      public agreement page (no passcode, noindex)
  robots.ts               disallows /dashboard and /agreement
components/
  dashboard/**            dashboard UI (shell, forms, tabs, ledger, share panel…)
  agreement/              AgreementDocument (one renderer for preview, print and public page)
lib/
  schemas/                zod schemas — the data model; all types are inferred from them
  repositories/           the ONLY data access for the UI (async functions)
  storage/                storage adapters (localStorage today), migrations, sample loader
  sharing/                share links, token resolvers, acceptance receipts, hashing
  logic/                  pure business logic (payments, milestones, deadlines, insights, csv…)
  format/                 INR and IST formatting
  hooks/                  small React hooks over the repositories
data/seed/*.json          FAKE sample data only (ships in the public bundle)
public/                   the original static portfolio site, unchanged
```

**Flow:** component → `useData(() => getX())` → repository → in-memory database → `StorageAdapter`
(localStorage). Every change goes through `mutate()`, which applies it to a copy, validates the
**whole** database against `DatabaseSchema`, persists it, then notifies subscribers so every open view
refreshes. Another tab changing the data triggers a reload via the `storage` event.

The public portfolio is the original static site in `public/`; `/` is rewritten to `public/index.html`.
The dashboard is not linked from the portfolio.

## 2. Data model

All entities are defined in `lib/schemas/index.ts` (zod v4). One array per entity, stored together as
one document (`Database`) — the same shape is used for storage, export and import.

| Entity | Key fields |
| --- | --- |
| Client | name, phone, email, address, city, source, notes, tags, status (lead/active/past/dormant) |
| Project | clientId, title, type, site, plot/built-up area, budget range, status, start, **originalDeadline / currentDeadline / deadlineHistory**, team, tags |
| Phase | projectId, name, deliverables, start, **dueDate / originalDueDate / dueDateHistory**, status, revisionsAllowed / revisionsUsed, paymentMilestoneId, order |
| Discussion | projectId, at, channel, summary, decisions, actionItems (owner, due, done), attachments, **scopeChange + impact (days, ₹, notes)**, tags |
| Requirement | projectId, text, category, references (label + URL), receivedOn, version |
| Task | projectId, phaseId, title, assignee, due, status, priority |
| Agreement | projectId, title, templateId, **versions[]** (each: token, status, sent/viewed/accepted timestamps, acceptedByName, acceptanceHash, changeNote, content) |
| AgreementTemplate | name, description, content |
| Payment | projectId, agreementId, milestoneId, label, type, amount, dueDate, invoicedAt, **receipts[]** (date, amount, mode, reference, notes) |
| Document | projectId, name, type, version, link, note, sharedWithClient, releasedOn, locked, releaseAfterPaymentId |
| Activity | at, kind, message, projectId, clientId — written automatically by repositories |
| Settings | firm profile, bank/UPI, default agreement clauses |

Phases are stored separately (normalised) rather than embedded in projects; `getPhases(projectId)`
returns them in order.

### Conventions

- **Money is integer rupees** (`Rupees = z.number().int()`). Never floats, never paise. Milestone
  amounts are split in whole rupees with the rounding difference on the last milestone, so they always
  add up to the total (`lib/logic/milestones.ts`). Shown with Indian grouping: `₹12,34,567`.
- **Dates:** calendar dates (deadlines, due dates) are `YYYY-MM-DD`; timestamps are ISO 8601. Shown in
  IST as `dd MMM yyyy`. Calendar dates are formatted from their parts, so time zones can never move them.
- **IDs** are nanoid; **share tokens** are 24-character nanoid.
- **Derived values are never stored:** a payment's received / outstanding / status / overdue are
  computed by `summarisePayment()`; only `invoicedAt` and receipts are stored. Status order: paid →
  overdue (anything outstanding after the due date) → partially paid → invoiced → pending.
- **Deadlines are never overwritten silently.** Every change keeps the original date and appends a
  history entry with the reason (and the discussion that caused it). Later phases can follow day for day.

## 3. Storage

`lib/storage/index.ts`

- Key `pln.dashboard.v1` holds `{ schemaVersion, savedAt, data }`.
- On first load (nothing stored) the sample data is loaded, with every date shifted so it sits around
  today (`rebaseDates`), so the sample always shows something overdue and something due this week.
- **Migrations:** bump `SCHEMA_VERSION` and add `MIGRATIONS[n] = (data) => upgraded` for each step.
  `migrate()` is used both on load and on import.
- **Unreadable data is never overwritten:** it is copied to `pln.dashboard.backup.<timestamp>` and the
  dashboard shows a recovery screen (download the raw data, or reset to the sample).
- **Settings → Your data:** export everything as JSON, import a backup (validated and migrated; replaces
  all data after confirmation), or reset to the sample. Export → import round-trips without loss.

## 4. Agreements

Each project can have agreements; each agreement has **versions**. A draft is editable; once shared it
becomes **sent** and read-only. A scope change creates a new version (copied from the governing one);
when it is sent, earlier versions become **superseded** and stay viewable. Statuses: draft, sent,
viewed, accepted, superseded, cancelled. The governing version is the newest accepted one.

Sections (all editable with a live preview): parties; project summary; scope and explicit exclusions;
phase-wise rollout; timeline with dependency and change clauses; fees and payment schedule (must total
exactly 100% before saving or sharing; GST optional); revisions and change requests; communication and
approvals; ownership and usage rights (with portfolio permission); release of files; cancellation and
termination; confidentiality, disputes (discussion → mediation → courts at Ahmedabad, Gujarat) and
governing law (India); acceptance.

Templates (`data/seed/agreement-templates.json`): residential (plans & 3D), interior design,
renovation. The firm's default clauses in Settings override template text for new agreements.
"Duplicate a previous agreement" copies clauses, phases and fees and refreshes parties and project.

`AgreementDocument` renders the same document for the editor preview, dashboard print and the public
page. Print CSS produces a clean A4 document ("Save as PDF").

> **Template for convenience; have a qualified advocate review before relying on it.**

## 5. Sharing and acceptance (no backend)

`lib/sharing/`

**Link format:** `/agreement/<token>#s=1.<lz-string payload>`

1. **Snapshot in the link.** The version (plus firm branding) is validated, serialised and compressed
   into the URL **hash**. Browsers never send the hash to a server, and the payload contains only that
   version — no other dashboard data. Decoding is size-limited and schema-validated; damaged or
   foreign links show a clear message. The UI warns when a link exceeds 8,000 characters (a full
   agreement is typically ~4–5k).
2. **Token lookup.** If there is no usable snapshot, the token is looked up among the published sample
   agreements in `data/seed`. This resolver chain (`resolveAgreement`) is where a backend plugs in.

The page shows a banner when the link points to a superseded version (known from `latestVersion` in the
snapshot) or a withdrawn one.

**Share actions:** copy link, WhatsApp (`wa.me` with a prefilled message), email (`mailto:`), preview,
print. Sharing a draft first marks it **sent** (after confirmation).

**Acceptance — placeholder until a backend exists.** The client types their full name, ticks "I have
read and agree" and clicks Accept. Nothing is uploaded. The page produces a **receipt**: name,
timestamp, version and a SHA-256 hash of the canonical agreement content, plus a machine-readable code
(`PLN-ACCEPTANCE-1:…`). The client downloads it or sends it by WhatsApp/email. In the dashboard,
**Record acceptance** parses the pasted receipt, checks the token, version and that the content hash
matches the stored version exactly, then marks it accepted. A receipt is only as trustworthy as the
channel it arrived through.

**Revoke** marks a version cancelled in the dashboard. A link already sent keeps opening, because there
is no server to refuse it — tell the client in writing. True revocation needs a backend.

## 6. Privacy and access

- **Only fake data is committed** (`data/seed/*.json`). Anything imported from JSON in client code is in
  the public JavaScript bundle. Real data lives in the browser only.
- `data/real/` is git-ignored. There is deliberately **no build-time override** that reads real data
  from it: anything bundled at build time is published with the site. Keep real backups (exports) there
  or anywhere outside the repo.
- **Passcode gate — not security.** `NEXT_PUBLIC_DASHBOARD_PASSCODE` is compiled into the public bundle;
  unlocking is remembered for the browser session. It keeps casual visitors out, nothing more. If it is
  not set, the gate says so and any entry unlocks.
- `/dashboard` and `/agreement` are `noindex` three ways: page metadata, `X-Robots-Tag` header
  (`next.config.ts`) and `robots.txt`.

## 7. Running, testing, deploying

```bash
npm install
cp .env.example .env.local      # set NEXT_PUBLIC_DASHBOARD_PASSCODE
npm run dev                     # http://localhost:3000/dashboard
npm run check                   # lint + type-check + tests + build
```

Tests (Vitest) cover payment status and outstanding, milestone validation and rounding, deadline shifts
and cascades, seed rebasing, share-link encode/decode, acceptance receipts, WhatsApp parsing, CSV, and
repository flows (scope change shifting deadlines, acceptance verification, export/import round trip).

**Deploy** on a host that runs Next.js (Vercel, Netlify): the public agreement route accepts any token,
so the site is no longer a purely static export. Set `NEXT_PUBLIC_DASHBOARD_PASSCODE` in the host's
environment variables.

## 8. Swapping in a backend

The UI only ever calls the async functions exported from `lib/repositories/index.ts`. To move to a real
backend:

1. **Build the API** (outline below) with authentication (e.g. email OTP or passkeys for the architect).
2. **Re-implement the repository modules** with `fetch` calls — same function names, same types (keep
   the zod schemas and validate responses with them). `lib/repositories/db.ts` (in-memory store,
   `mutate`) goes away; keep `subscribe`/`getVersion` (or switch the hooks to React Query/SWR) so views
   refresh after writes.
3. **Migrate existing browser data:** add a one-off "Upload my data" action that posts the
   `exportAll()` JSON to `POST /api/import`.
4. **Sharing:** add a resolver to `resolveAgreement` that calls `GET /api/share/:token`. Links can then
   drop the `#s=` snapshot (or keep it as an offline fallback). Revocation and expiry become real.
5. **Acceptance:** the public page posts to `POST /api/share/:token/accept`; the server stores name,
   time, IP/user agent and the content hash. "Record acceptance" becomes unnecessary (keep it for
   receipts that arrive offline).
6. Replace the passcode gate with real auth; keep the public agreement route unauthenticated.

### Suggested schema (PostgreSQL)

```sql
firms(id, name, architect_name, coa_number, gstin, address, phone, email, logo_url, bank jsonb, defaults jsonb)
users(id, firm_id, name, email, role)                       -- architect, partner
clients(id, firm_id, name, phone, email, address, city, source, notes, tags text[], status, created_at)
projects(id, firm_id, client_id, title, type, site_location, plot_area_sqft, built_up_area_sqft,
         budget_min, budget_max, status, start_date, original_deadline, current_deadline, team text[], tags text[], created_at)
deadline_changes(id, project_id, phase_id null, changed_at, from_date, to_date, reason, discussion_id null, changed_by)
phases(id, project_id, name, description, deliverables text[], start_date, due_date, original_due_date,
       status, revisions_allowed, revisions_used, payment_milestone_id null, sort_order)
discussions(id, project_id, at, channel, summary, decisions text[], scope_change bool,
            impact_days int, impact_cost_inr bigint, impact_notes, tags text[], created_by)
action_items(id, discussion_id, text, owner, due_date, done)
attachments(id, discussion_id, name, type, url, storage_key, note)      -- files in object storage
requirements(id, project_id, text, category, references jsonb, received_on, version)
tasks(id, project_id, phase_id, title, assignee, due_date, status, priority)
agreements(id, project_id, title, template_id, created_at)
agreement_versions(id, agreement_id, version, token unique, status, content jsonb, content_hash,
                   change_note, created_at, sent_at, viewed_at, accepted_at, revoked_at, expires_at)
acceptances(id, agreement_version_id, accepted_by_name, accepted_at, content_hash, ip, user_agent)
link_views(id, agreement_version_id, viewed_at, ip, user_agent)
payments(id, project_id, agreement_id, milestone_id, label, type, amount_inr bigint, due_date, invoiced_at, notes)
receipts(id, payment_id, date, amount_inr bigint, mode, reference, notes, recorded_by)
documents(id, project_id, name, type, version, url, storage_key, note, shared_with_client, released_on, locked, release_after_payment_id)
activity(id, firm_id, at, kind, message, project_id, client_id, actor_id)
```

Money stays integer rupees (`bigint`). Keep `content_hash` = SHA-256 of canonical JSON (sorted keys),
exactly as `lib/sharing/hash.ts` computes it, so existing receipts keep verifying.

### Suggested API

```
GET/POST           /api/clients              GET/PATCH/DELETE /api/clients/:id
GET/POST           /api/projects             GET/PATCH/DELETE /api/projects/:id
POST               /api/projects/:id/deadline            { to, reason, discussionId? }
GET/POST           /api/projects/:id/phases  PATCH/DELETE /api/phases/:id
POST               /api/phases/:id/deadline              { to, reason, cascade, moveProject, discussionId? }
GET/POST           /api/discussions          PATCH/DELETE /api/discussions/:id   (POST accepts { deadline? })
GET/POST           /api/requirements, /api/tasks, /api/documents (+ PATCH/DELETE by id)
POST               /api/documents/:id/release
GET/POST           /api/agreements           GET /api/agreements/:id
PUT                /api/agreements/:id/versions/:vid     (drafts only)
POST               /api/agreements/:id/versions          { changeNote }
POST               /api/agreements/:id/versions/:vid/send | /revoke
GET/POST           /api/payments             PATCH/DELETE /api/payments/:id
POST               /api/payments/:id/receipts            DELETE /api/payments/:id/receipts/:rid
POST               /api/agreements/:id/schedule-payments
GET                /api/activity?projectId=  GET /api/search?q=
GET/PUT            /api/settings
GET                /api/export               POST /api/import
-- public, unauthenticated, rate-limited:
GET                /api/share/:token                     -> one version + firm branding (404 if revoked/expired)
POST               /api/share/:token/view
POST               /api/share/:token/accept              { name, agree: true, contentHash }
```

Notifications (deadline reminders, payment due reminders, "client opened / accepted the agreement")
also need the backend: a daily job plus email or WhatsApp Business messages.
