# Operations runbook

How Mansora runs the service day to day, responds to incidents and controls access. Status 15 November 2026.
Names marked *to name* are owner decisions (see `railway-control-register.md` section 4).

## 1. Roles

| Role | Who | Responsible for |
| --- | --- | --- |
| Service owner | Peter | Priorities, releases to production, client communication, vendor contracts, final say in incidents |
| Operations lead | *to name* (suggested: Priscilla) | Watching alerts and the team inbox, first response, routine checks below, access reviews |
| Technical lead | *to name* | Diagnosis and fixes, releases, restores, security updates, provider configuration |
| Client support | Operations lead, backed by the assigned Mansora contact on each client | Shop questions, owner password recovery, onboarding and training |

Alerts (uptime, backups) and demo-request alerts go to **priscilla@mansora-consulting.com**. Everyone with a role
uses multi-factor authentication on every account they hold.

## 2. Severity and response

| Level | Meaning | Examples | Acknowledge | Update clients | Target to restore |
| --- | --- | --- | --- | --- | --- |
| **S1 Critical** | Data exposed across clients, data loss, or the service down for all | wrong shop's data visible; database damaged; production down > 15 min | 15 min (working hours) / 1 h | within 1 h, then every 2 h | 4 h (RTO) |
| **S2 Major** | One important function down for many, or one client cannot trade | sync failing for all; payments failing; one browser shop will not open | 1 h | within 4 h | 1 working day |
| **S3 Minor** | Degraded, workaround exists | an email delayed; a report wrong; slow pages | 1 working day | with the fix | next release |
| **S4 Request** | Question or improvement | how-to, feature ideas, problem reports marked "idea" | 2 working days | — | planned |

Working hours: 08:00–20:00 Ghana time, Monday to Saturday. Outside them, S1 only (phone the technical lead).

## 3. Incident procedure

1. **Detect**: uptime alert, backup alert, problem report (19:00 digest), client call, or the admin dashboard.
2. **Acknowledge**: the operations lead replies on the alert thread "Acknowledged, investigating" and opens an
   incident note (date/time, who reported, what is affected, severity).
3. **Contain** (see `incident-response.md` for the action per situation). For S1 data exposure: take the
   service offline (Railway → production → Mansora → remove the public domain or scale to zero) before anything
   else.
4. **Communicate**: use the templates below; one person speaks to clients.
5. **Fix**: on staging first where possible; release with *Promote to production*. Emergency rollback: Railway →
   production → Deployments → the last good deployment → Redeploy.
6. **Recover data** if needed: `../disaster-recovery/system-backups.md` (browser version) and
   `../disaster-recovery/backup-and-recovery.md` (laptops).
7. **Close**: confirm with affected clients; record the end time.
8. **Review** (S1/S2 within 5 working days): what happened, why (root cause, not "human error"), what changes, who
   by when. Store with the incident note. Personal-data breaches: assess notification to the Data Protection
   Commission and affected people with legal advice (Act 843) — decide within 72 hours of discovery.

### Message templates

*S1/S2 start:* "We are aware that [what] is affecting Mansora since [time]. Your records on your laptop are safe and
you can keep selling [if true]. We are working on it and will update you by [time]. — Mansora support, 024 420 5134"

*Resolved:* "The issue with [what] was fixed at [time]. [What you need to do, if anything.] We are sorry for the
disruption; we will share what we are changing so it does not happen again."

## 4. Routine operations calendar

| When | Task | Who | Evidence |
| --- | --- | --- | --- |
| Daily (working days) | Read the team inbox: uptime, backup and demo-request alerts; 19:00 problem-report digest | Ops lead | replies in inbox |
| Daily | Admin → Leads: contact new leads within 24 h; record each contact | Ops lead | lead timeline |
| Weekly (Monday) | Admin → Billing → Who owes us: follow up overdue invoices | Ops lead | collection notes |
| Weekly | Railway → production: deployments, errors in logs, volume and database usage | Tech lead | note in ops log |
| Monthly (first week) | **Backup drill**: `restore.ts <newest copy> --check`; record date and result | Tech lead | ops log |
| Monthly | Cost review: Railway usage, Resend, Paystack fees, Google storage; compare with forecast | Service owner | ops log |
| Monthly | Dependency and security updates (CI audit), then release through staging | Tech lead | pull requests |
| Quarterly | **Access review** (section 5) | Service owner + ops lead | signed list |
| Quarterly | Full restore into a fresh staging environment; time it against the 4 h target | Tech lead | ops log |
| Quarterly | Rotate shared secrets that people have seen (test logins, `DEMO_INTAKE_SECRET`) | Tech lead | ops log |
| Yearly | Review this runbook, the control register, retention periods, provider terms and the exit plan | Service owner | dated revision |

## 5. Access review

List everyone with access to each system, confirm they still need it at that level, and remove the rest:

| System | Where to look | Expected |
| --- | --- | --- |
| Railway project | Railway → project → Members | owner + technical lead only; MFA on |
| GitHub `PeterAshiagbor/Mansora` | Settings → Collaborators; Environments → `production` reviewers | named people; reviewers = owner(s) |
| GitHub website repo / Vercel team "mansora" | repo collaborators; Vercel → Team → Members | named people |
| Mansora admin dashboard | Admin → Administrators | team members only; two-step sign-in on for all |
| Resend, Paystack, Google Cloud, GoDaddy | each provider's team/users page | named owner + one backup person |
| Shared test accounts | Railway variables / private volume | rotated after anyone leaves or after sharing in chat |

## 6. Joiners and leavers

**Joiner:** create named accounts (never share one login), least privilege, MFA on, add to the roles table, walk
through this runbook and the incident guide.

**Leaver or role change (same day):** remove from every system in section 5; rotate any secret they could see;
reassign their leads and clients (Admin → Leads "Looked after by"); record it in the ops log.

## 7. Records

Keep an **ops log** (a dated document or sheet): routine checks, drills, cost reviews, access reviews, incidents
and releases (the *Promote to production* run summary is the release record).
