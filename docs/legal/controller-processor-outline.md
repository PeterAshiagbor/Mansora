# DRAFT — not legal advice — for review by a Ghanaian data-protection lawyer

## Mansora–shop agreement responsibilities outline

This is a negotiation/review checklist, not an executed processing agreement. Could the shop be controller for customer, worker and supplier transaction records, with Mansora acting as processor for specified cloud replication/support/recovery activities? Could Mansora separately be controller for its own administrator accounts, client-business contacts, service-plan administration and security records? The lawyer must resolve the actual roles for each purpose, including sole traders, privileged hosting access and operational logs; encryption does not settle the role question.

### 1. Parties, instructions and permitted purposes

Should the schedule identify the parties, shop locations, contact points, duration, purposes, data subjects and every relevant category from the inventory? Which documented instructions permit replication, backups, recovery and support, and who can authorise a change? Should Mansora be prohibited from unrelated marketing, model training, sale of data or other secondary uses unless a separately lawful, agreed arrangement exists? No such secondary-use permission is supplied by this draft.

### 2. Access and confidentiality

Who may access shop records, client contacts, administrator credentials and infrastructure, and under which confidentiality duties? The ordinary dashboard is separated from raw business tables by database roles and tenant isolation; the support API requires an owner-issued, time-limited grant and exposes limited reports. How should privileged database/hosting access be separately authorised, logged, limited and reviewed? Who may reset/relink a laptop or issue an owner recovery code, and what identity checks must occur before a code is issued? These operational checks are not fully enforced by software.

### 3. Security schedule and evidence

Which measures are contractually required and independently checked: named staff logins and permissions, workstation/OS controls, SQLCipher laptop storage, shop-held backup passphrases, TLS/network controls, runtime/migration role separation, tenant RLS, private backup storage, MFA administration, secret/key custody, patching and incident response? What evidence, audit rights and remediation times apply? Proposed container/S3/observability work in separate PRs is not proof of deployed infrastructure or physical-device testing. How are keys rotated, recovered and retired without destroying legally required records or leaving accessible old copies?

### 4. Hosting, subprocessors and transfers

Which legal entities, regions and services will host the database, encrypted backups, infrastructure backups, logs or an optional error receiver? Does remote administration or support create a transfer? What notice/approval process applies when a subprocessor or location changes? Which Act 843 requirements and contractual/technical safeguards apply to each cross-border flow? Attach the actual provider/region list before service begins; none is selected here.

### 5. Requests, correction and minimisation

Who receives a customer's/worker's request, verifies identity, checks the controller's instruction and legal holds, and gives the response? What assistance and deadlines must Mansora provide? The existing whole-business export is not a ready-made individual access response: filtering and review must protect other people's records and authentication material. How should corrections propagate to current records, immutable history, sync snapshots and backups without falsifying accounting evidence or allowing offline restores to undo redaction?

### 6. Incidents and continuity

What constitutes an incident, when and to whom must it be reported, and who decides any notices to the Commission or affected people? What minimum evidence can be shared without exposing unrelated data or credentials? What recovery objectives, restore testing, lost-laptop revocation/relink procedures and offline operating arrangements are promised? Revoking a laptop stops cloud access but does not remotely erase it or stop local offline sales. Do not promise a remote wipe or a tested recovery time that the product has not delivered.

### 7. Retention, legal holds and service exit

Which controller approves the per-table retention schedule and exceptions? What export format/window, credential revocation, backup expiry and evidence of deletion/redaction apply after service ends? How will owner-held laptops, removable backups, exports and receipts be handled? Immutable financial/audit rows, replay/deduplication metadata and historical payloads currently prevent a simple deletion promise. What engineering work and legal basis are needed for an approved minimisation/erasure process? What must happen if a backup is restored after a redaction decision?

### 8. Governance and commercial terms

Who maintains the inventory, notices, processing/transfer records, access reviews and subprocessor list? Which audit/cooperation obligations, liabilities, insurance, dispute terms and order-of-precedence clauses are appropriate under Ghanaian law? Who signs for each party and approves changes to the schedule? No liability allocation, statutory conclusion or retention period is agreed in this outline.
