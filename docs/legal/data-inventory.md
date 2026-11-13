# DRAFT — not legal advice — for review by a Ghanaian data-protection lawyer

## Schema-derived data inventory

This inventory intentionally lists **every** application column, including nonpersonal technical fields, so that newly introduced personal data cannot silently fall outside review. Assessments are engineering observations/questions, not legal classifications. It reflects migrations and the sync contract, not production infrastructure or a verified retention policy. Machine-readable detail (purpose, locations, access, assessment for every field) is in [data-inventory.json](data-inventory.json).

### Access and copies

Normal shop access is permission-based: owners, permitted managers and cashiers have different commands, and cashiers see their own sales. Cost fields require cost permission. The ordinary Mansora platform dashboard cannot generally read raw business tables; the owner-issued, time-limited support path exposes selected aggregate reports. Cloud business rows are still available to the replication service and potentially privileged hosting/database operators. The actual privileged-operator controls, host region and subprocessors remain questions for the agreement.

Laptop records are encrypted in the packaged app and portable backups use a shop-controlled passphrase. Encryption/hashing is a safeguard, not a statement that the data stops being personal. Cloud business-row replication is separate from encrypted backup objects: do not describe the cloud database as client-side end-to-end encrypted. Original Excel/CSV imports are parsed locally; resulting records and audit details can sync, while original source files may remain in operator-controlled folders. Exports, printed receipts/PDFs and copied files are additional shop-controlled copies outside this schema snapshot.

### Credentials, JSON and historical copies

`laptop.users.password_hash` remains local and in encrypted laptop backups; the cloud users mirror omits it. Administrator password hashes, session/activation/recovery hashes and encrypted TOTP seeds are platform data. Raw admin tokens live in browser sessionStorage; raw device credentials live in laptop meta, while the server stores their hash. Backup metadata is not the encrypted backup content.

The meta `value` column includes business contacts, receipt text, API/device/tenant identity, the **raw device token**, subscription/status data, receipt counters, and (if enabled) a derived automatic-backup key plus salt. Current portable backup creation removes `backup_auto` and the legacy `backup_passphrase` meta entries, but copies the other database contents, including local staff password hashes and device-token metadata, under backup encryption. Recovery/relink revokes/replaces credentials according to its workflow; do not assume a backup contains no credentials. The separately OS-protected device database key and server `ADMIN_TOTP_KEY`, hosting/storage credentials, owner-held backup passphrases and displayed one-time codes are security assets outside the SQL column inventory; the lawyer/operator must still decide key custody, access, retirement and incident processes.

Audit `detail`, outbox `payload` and cloud `sync_events.payload` can repeat **full historical personal fields**, filenames, reasons and linked identities. Redacting a current customer profile alone does not remove those copies or older backups/exports. Support-access logs also project administrator names onto the laptop. Free-text fields are not restricted to a predefined personal-data vocabulary. Do shops need training and collection limits to avoid unnecessary sensitive content?

Pending C7 observability (separate PR) can introduce request/admin/tenant/device identifiers in runtime logs and an optionally chosen error receiver. Hosting/proxy logs can also add IP/network data. No collector, recipient, hosting country, log retention or lawful basis has been selected; inventory these operational systems before deployment.

### Fields by source and table

#### `cloud.activation_codes`

Authorise one-time activation of a client laptop and attribute issuance.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.activation_codes.code_hash` | Verify a one-use activation/recovery credential without storing the issued code in plaintext. Security credential/authenticator material linked to an account; encryption or hashing is not anonymisation. Which protection and retention duties apply? |
| `cloud.activation_codes.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.activation_codes.expires_at` | Enforce the credential/grant/session expiry time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.activation_codes.used_at` | Record consumption of a one-use credential. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.activation_codes.created_by` | Attribute creation/issuance to a staff member or Mansora administrator, according to this table. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.activation_codes.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.admin_audit_logs`

Account for Mansora administrative actions and consent-controlled report access.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.admin_audit_logs.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admin_audit_logs.admin_id` | Link the responsible or authenticated Mansora administrator. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admin_audit_logs.action` | Maintain the action needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.admin_audit_logs.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admin_audit_logs.detail` | Keep structured audit context; can duplicate identifiers, contact details, filenames and free-text reasons. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.admin_audit_logs.occurred_at` | Preserve the recorded activity time for audit/sync order. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.admin_sessions`

Authenticate a Mansora administrator for a bounded session.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.admin_sessions.token_hash` | Look up an authenticated session/device/challenge using a hash of its bearer credential. Security credential/authenticator material linked to an account; encryption or hashing is not anonymisation. Which protection and retention duties apply? |
| `cloud.admin_sessions.admin_id` | Link the responsible or authenticated Mansora administrator. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admin_sessions.expires_at` | Enforce the credential/grant/session expiry time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admin_sessions.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.admin_totp`

Enroll, verify and throttle administrator second-factor authentication.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.admin_totp.admin_id` | Link the responsible or authenticated Mansora administrator. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admin_totp.secret_encrypted` | Hold the administrator authenticator seed encrypted under a separately supplied server key. Security credential/authenticator material linked to an account; encryption or hashing is not anonymisation. Which protection and retention duties apply? |
| `cloud.admin_totp.enabled_at` | Record activation of administrator MFA. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admin_totp.last_used_step` | Reject reuse of a previously accepted authenticator time step. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.admin_totp.pending_secret_encrypted` | Hold an unconfirmed authenticator seed encrypted during enrollment. Security credential/authenticator material linked to an account; encryption or hashing is not anonymisation. Which protection and retention duties apply? |
| `cloud.admin_totp.pending_expires_at` | Expire an unconfirmed authenticator enrollment. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admin_totp.failed_attempts` | Throttle repeated incorrect credentials or second-factor attempts. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.admin_totp.attempts_reset_at` | Bound the second-factor failure/rate-limit window. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.admin_totp_challenges`

Bind second-factor verification to a short-lived password-verified login.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.admin_totp_challenges.token_hash` | Look up an authenticated session/device/challenge using a hash of its bearer credential. Security credential/authenticator material linked to an account; encryption or hashing is not anonymisation. Which protection and retention duties apply? |
| `cloud.admin_totp_challenges.admin_id` | Link the responsible or authenticated Mansora administrator. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admin_totp_challenges.expires_at` | Enforce the credential/grant/session expiry time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.admin_totp_recovery_codes`

Verify and consume a one-use administrator MFA recovery code.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.admin_totp_recovery_codes.admin_id` | Link the responsible or authenticated Mansora administrator. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admin_totp_recovery_codes.code_hash` | Verify a one-use activation/recovery credential without storing the issued code in plaintext. Security credential/authenticator material linked to an account; encryption or hashing is not anonymisation. Which protection and retention duties apply? |

#### `cloud.admin_invitations`

Invite a new Mansora administrator by email with a one-time link; they choose their own password. Only a hash of the link token is stored.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.admin_invitations.id` | Stable record identifier for the invitation. Linkable identifier. What legal purpose and access limits apply? |
| `cloud.admin_invitations.email` | Address the invitation is sent to and the future administrator login. Direct contact detail of a prospective administrator. Should unused invitations be erased after expiry? |
| `cloud.admin_invitations.name` | Name used to greet the invitee and on their new account. Direct identity detail. Should collection/redaction restrictions be added for this field? |
| `cloud.admin_invitations.token_hash` | Verify the one-time link using its SHA-256 hash; the link itself is not stored. Security credential material; hashing is not anonymisation. Which protection and retention duties apply? |
| `cloud.admin_invitations.expires_at` | Stop the link working after 48 hours. Operational security metadata. Lawyer to classify. |
| `cloud.admin_invitations.created_by` | Attribute which administrator sent the invitation. Linkable staff identifier and activity attribution. What legal purpose and access limits apply? |
| `cloud.admin_invitations.created_at` | Record when the invitation was sent. Activity chronology. What legal purpose and access limits apply? |
| `cloud.admin_invitations.used_at` | Make the link single-use; also set when an invitation is replaced or cancelled. Activity chronology. What legal purpose and access limits apply? |

#### `cloud.admins`

Maintain Mansora administrator identity, account status and password verification.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.admins.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.admins.email` | Contact or identify the person/account by email. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.admins.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.admins.password_hash` | Verify a password using its stored hash; no plaintext password is stored in this column. Security credential/authenticator material linked to an account; encryption or hashing is not anonymisation. Which protection and retention duties apply? |
| `cloud.admins.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.admins.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.audit_logs`

Attribute shop actions, approvals and operational/security changes.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.audit_logs.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.audit_logs.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.audit_logs.actor_id` | Link the staff actor responsible for the event. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.audit_logs.action` | Maintain the action needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.audit_logs.entity_type` | Maintain the entity type needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.audit_logs.entity_id` | Link the related operational record or actor for reconciliation and access accountability. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.audit_logs.detail` | Keep structured audit context; can duplicate identifiers, contact details, filenames and free-text reasons. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.audit_logs.occurred_at` | Preserve the recorded activity time for audit/sync order. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.backup_records`

Locate and verify encrypted backup objects and track backup/upload status.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.backup_records.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.backup_records.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.backup_records.device_id` | Link the originating/holding activated laptop. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.backup_records.size_bytes` | Reconcile the exact money, stock, version or operational count represented by size bytes. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.backup_records.sha256` | Verify encrypted-backup integrity and correlate the stored backup object. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.backup_records.storage_key` | Locate the encrypted cloud backup object and correlate it with the business/device. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.backup_records.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.backup_records.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.categories`

Organise the shop product catalogue for lookup and reporting.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.categories.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.categories.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.categories.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.categories.active` | Maintain the active needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.categories.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.client_subscriptions`

Record a client service-plan assignment, billing status and renewal date.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.client_subscriptions.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.client_subscriptions.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.client_subscriptions.plan_id` | Link the assigned service plan. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.client_subscriptions.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.client_subscriptions.renewal_date` | Record the service subscription renewal date. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.client_subscriptions.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.credit_accounts`

Track the customer obligation created by a credit sale and its settlement state.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.credit_accounts.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_accounts.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_accounts.customer_id` | Link the customer profile or debt obligation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_accounts.sale_id` | Link the completed sale being paid, refunded or financed. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_accounts.original_balance` | Reconcile the exact money, stock, version or operational count represented by original balance. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.credit_accounts.outstanding_balance` | Reconcile the exact money, stock, version or operational count represented by outstanding balance. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.credit_accounts.due_date` | Record the credit repayment due date. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_accounts.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.credit_accounts.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_accounts.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.credit_repayments`

Record and attribute a payment reducing an existing customer credit balance.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.credit_repayments.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_repayments.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_repayments.credit_account_id` | Link the credit obligation reduced by this repayment. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_repayments.customer_id` | Link the customer profile or debt obligation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_repayments.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.credit_repayments.method` | Maintain the method needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.credit_repayments.reference` | Reconcile a supplier invoice or external payment; may contain third-party personal identifiers. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.credit_repayments.shift_id` | Link the responsible till/reconciliation period. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_repayments.received_by` | Attribute the stock receipt to its staff operator. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.credit_repayments.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.customers`

Maintain optional customer contact/profile details and link credit/sale records.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.customers.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.customers.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.customers.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.customers.phone` | Contact or identify the customer, supplier or business owner by phone. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.customers.email` | Contact or identify the person/account by email. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.customers.notes` | Keep operator-entered context; may contain customer/staff/supplier personal data. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.customers.active` | Maintain the active needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.customers.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.customers.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.devices`

Bind one activated laptop and its cloud credential to the correct business.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.devices.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.devices.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.devices.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.devices.token_hash` | Look up an authenticated session/device/challenge using a hash of its bearer credential. Security credential/authenticator material linked to an account; encryption or hashing is not anonymisation. Which protection and retention duties apply? |
| `cloud.devices.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.devices.app_version` | Maintain the app version needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.devices.last_seen_at` | Measure device connectivity/account-support health. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.devices.last_sync_at` | Measure last successful synchronization. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.devices.pending_count` | Reconcile the exact money, stock, version or operational count represented by pending count. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.devices.last_backup_at` | Measure backup recency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.devices.activated_at` | Record device activation chronology. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.devices.activity_day` | Calendar day the counts refer to. Operational metadata. Lawyer to classify. |
| `cloud.devices.sales_today` | Number of sales recorded that day (a count, no amounts). Aggregate business activity of a client; not personal on its own, but may relate to a sole trader. Lawyer to classify. |
| `cloud.devices.staff_active_today` | Number of staff who recorded any action that day (a count, no names). Aggregate count; potentially personal for a one-person business. Lawyer to classify. |
| `cloud.devices.last_sale_at` | Time of the most recent sale, to spot shops that have stopped using the till. Activity chronology of a client business; may relate to a sole trader. Lawyer to classify. |

#### `cloud.expenses`

Record and attribute a business expense and its payment/till impact.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.expenses.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.expenses.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.expenses.category` | Maintain the category needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.expenses.description` | Describe the transaction/expense or service; may contain personal free text. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.expenses.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.expenses.expense_date` | Place an expense in the selected reporting/accounting day. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.expenses.payment_method` | Maintain the payment method needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.expenses.receipt_reference` | Reconcile an expense receipt or external payment reference. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.expenses.shift_id` | Link the responsible till/reconciliation period. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.expenses.created_by` | Attribute creation/issuance to a staff member or Mansora administrator, according to this table. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.expenses.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.inventory_movements`

Explain each stock change, its source, cost and responsible staff member.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.inventory_movements.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.inventory_movements.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.inventory_movements.product_id` | Link the catalogue product affected by this record. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.inventory_movements.type` | Maintain the type needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.inventory_movements.quantity_delta` | Reconcile the exact money, stock, version or operational count represented by quantity delta. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.inventory_movements.unit_cost` | Reconcile the exact money, stock, version or operational count represented by unit cost. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.inventory_movements.reference_type` | Maintain the reference type needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.inventory_movements.reference_id` | Link the related operational record or actor for reconciliation and access accountability. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.inventory_movements.actor_id` | Link the staff actor responsible for the event. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.inventory_movements.reason` | Explain the financial, stock or access action; may contain personal free text. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.inventory_movements.occurred_at` | Preserve the recorded activity time for audit/sync order. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.onboarding_steps`

Track client setup, completion attribution, notes and operational acceptance steps.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.onboarding_steps.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.onboarding_steps.step` | Maintain the step needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.onboarding_steps.completed_at` | Record completion of an onboarding step. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.onboarding_steps.completed_by` | Attribute an onboarding acceptance step to its administrator. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.onboarding_steps.notes` | Keep operator-entered context; may contain customer/staff/supplier personal data. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |

#### `cloud.owner_recovery_codes`

Authorise and attribute one-time owner password recovery without storing the new password.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.owner_recovery_codes.code_hash` | Verify a one-use activation/recovery credential without storing the issued code in plaintext. Security credential/authenticator material linked to an account; encryption or hashing is not anonymisation. Which protection and retention duties apply? |
| `cloud.owner_recovery_codes.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.owner_recovery_codes.expires_at` | Enforce the credential/grant/session expiry time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.owner_recovery_codes.used_at` | Record consumption of a one-use credential. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.owner_recovery_codes.created_by` | Attribute creation/issuance to a staff member or Mansora administrator, according to this table. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.owner_recovery_codes.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.payments`

Record a sale tender, payment method and optional external payment reference.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.payments.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.payments.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.payments.sale_id` | Link the completed sale being paid, refunded or financed. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.payments.method` | Maintain the method needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.payments.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.payments.reference` | Reconcile a supplier invoice or external payment; may contain third-party personal identifiers. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |

#### `cloud.products`

Maintain product identity, prices, reorder threshold and catalogue version.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.products.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.products.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.products.sku` | Maintain the sku needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.products.barcode` | Maintain the barcode needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.products.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.products.category_id` | Link the catalogue category. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.products.unit` | Maintain the unit needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.products.cost_price` | Reconcile the exact money, stock, version or operational count represented by cost price. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.products.selling_price` | Reconcile the exact money, stock, version or operational count represented by selling price. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.products.reorder_level` | Reconcile the exact money, stock, version or operational count represented by reorder level. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.products.active` | Maintain the active needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.products.version` | Reconcile the exact money, stock, version or operational count represented by version. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.products.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.products.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.purchase_items`

Preserve product quantities and unit costs for a recorded stock receipt.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.purchase_items.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.purchase_items.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.purchase_items.purchase_id` | Link the parent stock receipt. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.purchase_items.product_id` | Link the catalogue product affected by this record. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.purchase_items.quantity` | Reconcile the exact money, stock, version or operational count represented by quantity. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.purchase_items.unit_cost` | Reconcile the exact money, stock, version or operational count represented by unit cost. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |

#### `cloud.purchases`

Attribute a stock receipt to its supplier, invoice and receiving staff member.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.purchases.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.purchases.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.purchases.supplier_id` | Link the supplier for a stock receipt. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.purchases.reference` | Reconcile a supplier invoice or external payment; may contain third-party personal identifiers. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.purchases.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.purchases.total_cost` | Maintain the total cost needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.purchases.received_at` | Maintain the received at needed for this record and its lifecycle/reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.purchases.created_by` | Attribute creation/issuance to a staff member or Mansora administrator, according to this table. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.refund_items`

Preserve the quantities, money and stock/cost effect of a returned sale line.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.refund_items.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refund_items.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refund_items.refund_id` | Link the parent refund. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refund_items.sale_item_id` | Link the original receipt line. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refund_items.product_id` | Link the catalogue product affected by this record. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refund_items.quantity` | Reconcile the exact money, stock, version or operational count represented by quantity. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.refund_items.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.refund_items.restocked` | Maintain the restocked needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |

#### `cloud.refunds`

Record a refund, its reason, customer/sale/shift linkage and responsible approver.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.refunds.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refunds.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refunds.sale_id` | Link the completed sale being paid, refunded or financed. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refunds.refund_no` | Maintain the refund no needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.refunds.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.refunds.cost_total` | Reconcile the exact money, stock, version or operational count represented by cost total. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.refunds.payout_method` | Maintain the payout method needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.refunds.payout_amount` | Maintain the payout amount needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.refunds.credit_reduction` | Reconcile the exact money, stock, version or operational count represented by credit reduction. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.refunds.reason` | Explain the financial, stock or access action; may contain personal free text. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.refunds.requested_by` | Attribute the staff refund request. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refunds.authorised_by` | Attribute approval of a restricted transaction. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refunds.shift_id` | Link the responsible till/reconciliation period. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.refunds.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.sale_items`

Preserve the product/price/cost snapshot, quantity and discount sold on a receipt.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.sale_items.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sale_items.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sale_items.sale_id` | Link the completed sale being paid, refunded or financed. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sale_items.product_id` | Link the catalogue product affected by this record. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sale_items.product_name` | Preserve the sold product description; normally goods data but operator-controlled text. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sale_items.sku` | Maintain the sku needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sale_items.quantity` | Reconcile the exact money, stock, version or operational count represented by quantity. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sale_items.unit_price` | Reconcile the exact money, stock, version or operational count represented by unit price. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sale_items.cost_snapshot` | Reconcile the exact money, stock, version or operational count represented by cost snapshot. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sale_items.discount` | Reconcile the exact money, stock, version or operational count represented by discount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sale_items.line_total` | Reconcile the exact money, stock, version or operational count represented by line total. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |

#### `cloud.sales`

Preserve a completed sale, customer/staff/shift linkage, totals and discount authoriser.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.sales.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sales.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sales.receipt_no` | Identify the issued receipt and related customer/staff transaction. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sales.shift_id` | Link the responsible till/reconciliation period. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sales.cashier_id` | Link the cashier responsible for the sale or till. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sales.customer_id` | Link the customer profile or debt obligation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sales.subtotal` | Reconcile the exact money, stock, version or operational count represented by subtotal. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sales.discount_total` | Reconcile the exact money, stock, version or operational count represented by discount total. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sales.total` | Reconcile the exact money, stock, version or operational count represented by total. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sales.cash_tendered` | Reconcile the exact money, stock, version or operational count represented by cash tendered. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sales.change_given` | Reconcile the exact money, stock, version or operational count represented by change given. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sales.cost_total` | Reconcile the exact money, stock, version or operational count represented by cost total. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sales.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sales.discount_approved_by` | Attribute approval of a sale discount. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sales.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.schema_migrations`

Track controlled schema versions so migrations are not repeated.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.schema_migrations.id` | Stable record identifier for references and idempotency. No personal data expected in controlled schema metadata; confirm that future migration names or added metadata never include personal content. |
| `cloud.schema_migrations.name` | Display the record/person/business name in its operational context. No personal data expected in controlled schema metadata; confirm that future migration names or added metadata never include personal content. |
| `cloud.schema_migrations.applied_at` | Maintain the applied at needed for this record and its lifecycle/reconciliation. No personal data expected in controlled schema metadata; confirm that future migration names or added metadata never include personal content. |

#### `cloud.service_plans`

Describe Mansora service offerings, prices and included support.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.service_plans.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.service_plans.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.service_plans.price` | Reconcile the exact money, stock, version or operational count represented by price. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.service_plans.billing_period` | Maintain the billing period needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.service_plans.included_support` | Maintain the included support needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.service_plans.active` | Maintain the active needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.service_plans.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.shift_cash_movements`

Record approved cash entering or leaving a cashier till.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.shift_cash_movements.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shift_cash_movements.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shift_cash_movements.shift_id` | Link the responsible till/reconciliation period. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shift_cash_movements.direction` | Maintain the direction needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.shift_cash_movements.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.shift_cash_movements.reason` | Explain the financial, stock or access action; may contain personal free text. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.shift_cash_movements.authorised_by` | Attribute approval of a restricted transaction. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shift_cash_movements.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.shifts`

Attribute till opening, reconciliation, variance and sign-off to staff.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.shifts.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shifts.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shifts.cashier_id` | Link the cashier responsible for the sale or till. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shifts.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.shifts.opening_float` | Reconcile the exact money, stock, version or operational count represented by opening float. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.shifts.opened_at` | Record staff shift opening time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shifts.closed_at` | Record staff shift closing time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shifts.expected_cash` | Reconcile the exact money, stock, version or operational count represented by expected cash. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.shifts.counted_cash` | Reconcile the exact money, stock, version or operational count represented by counted cash. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.shifts.variance` | Reconcile the exact money, stock, version or operational count represented by variance. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.shifts.notes` | Keep operator-entered context; may contain customer/staff/supplier personal data. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.shifts.reviewed_by` | Attribute shift sign-off to its reviewer. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shifts.reviewed_at` | Record staff reconciliation sign-off time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.shifts.review_notes` | Maintain the review notes needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |

#### `cloud.stock_balances`

Maintain current quantity, average cost and version for a product.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.stock_balances.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.stock_balances.product_id` | Link the catalogue product affected by this record. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.stock_balances.quantity` | Reconcile the exact money, stock, version or operational count represented by quantity. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.stock_balances.average_cost` | Reconcile the exact money, stock, version or operational count represented by average cost. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.stock_balances.version` | Reconcile the exact money, stock, version or operational count represented by version. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.stock_balances.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.suppliers`

Maintain supplier identity and optional contact details for stock receipts.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.suppliers.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.suppliers.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.suppliers.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.suppliers.phone` | Contact or identify the customer, supplier or business owner by phone. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.suppliers.notes` | Keep operator-entered context; may contain customer/staff/supplier personal data. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.suppliers.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.support_access_grants`

Record why, by whom and for how long aggregate report support access was permitted.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.support_access_grants.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.support_access_grants.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.support_access_grants.scope` | Maintain the scope needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.support_access_grants.purpose` | Record the owner-stated reason for allowing support report access. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.support_access_grants.granted_by` | Attribute the support-access decision to the shop owner. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.support_access_grants.starts_at` | Start the support-consent validity interval. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.support_access_grants.expires_at` | Enforce the credential/grant/session expiry time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.support_access_grants.revoked_at` | Stop future support access without deleting its historical grant. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.support_access_grants.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.support_access_log`

Tell the shop which Mansora administrator accessed or was refused reports.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.support_access_log.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.support_access_log.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.support_access_log.admin_id` | Link the responsible or authenticated Mansora administrator. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.support_access_log.admin_name` | Show the administrator name to the shop in its support-access history. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.support_access_log.grant_id` | Link the owner permission governing a support access. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.support_access_log.action` | Maintain the action needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.support_access_log.occurred_at` | Preserve the recorded activity time for audit/sync order. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.sync_events`

Deduplicate incoming events and retain the received row snapshots and device attribution.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.sync_events.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sync_events.event_id` | Link the related operational record or actor for reconciliation and access accountability. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sync_events.device_id` | Link the originating/holding activated laptop. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sync_events.seq` | Reconcile the exact money, stock, version or operational count represented by seq. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sync_events.type` | Maintain the type needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.sync_events.payload` | Keep complete synchronized row snapshots, potentially including historical personal fields after profile edits. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.sync_events.occurred_at` | Preserve the recorded activity time for audit/sync order. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.sync_events.received_at` | Maintain the received at needed for this record and its lifecycle/reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.tenants`

Maintain client business/owner contact details, account status and onboarding identity.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.tenants.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.tenants.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.tenants.owner_name` | Identify the primary business owner/contact. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.tenants.phone` | Contact or identify the customer, supplier or business owner by phone. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.tenants.email` | Contact or identify the person/account by email. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.tenants.address` | Contact/location information for the client business, potentially a sole trader/home address. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.tenants.business_type` | Maintain the business type needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.tenants.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.tenants.support_contact` | Record the assigned support contact or supplied contact details. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.tenants.store_name` | Maintain the store name needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.tenants.onboarded_at` | Record the client onboarding/go-live time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.tenants.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `cloud.users`

Attribute shop activity to named staff and enforce staff account permissions.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.users.tenant_id` | Bind the record to one business and enforce tenant isolation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.users.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.users.username` | Identify the staff login and attribute staff operations. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.users.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `cloud.users.role` | Apply the staff role and owner-only restrictions. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.users.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `cloud.users.permissions` | Enforce the staff member permission set. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.users.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `cloud.users.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.audit_logs`

Attribute shop actions, approvals and operational/security changes.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.audit_logs.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.audit_logs.actor_id` | Link the staff actor responsible for the event. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.audit_logs.action` | Maintain the action needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.audit_logs.entity_type` | Maintain the entity type needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.audit_logs.entity_id` | Link the related operational record or actor for reconciliation and access accountability. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.audit_logs.detail` | Keep structured audit context; can duplicate identifiers, contact details, filenames and free-text reasons. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.audit_logs.occurred_at` | Preserve the recorded activity time for audit/sync order. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.backup_records`

Locate and verify encrypted backup objects and track backup/upload status.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.backup_records.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.backup_records.file_path` | Locate the local backup; its filesystem path may expose an OS profile or business name. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.backup_records.size_bytes` | Reconcile the exact money, stock, version or operational count represented by size bytes. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.backup_records.sha256` | Verify encrypted-backup integrity and correlate the stored backup object. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.backup_records.last_outbox_seq` | Reconcile the exact money, stock, version or operational count represented by last outbox seq. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.backup_records.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.backup_records.uploaded_at` | Track backup upload chronology. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.backup_records.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.categories`

Organise the shop product catalogue for lookup and reporting.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.categories.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.categories.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.categories.active` | Maintain the active needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.categories.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.credit_accounts`

Track the customer obligation created by a credit sale and its settlement state.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.credit_accounts.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.credit_accounts.customer_id` | Link the customer profile or debt obligation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.credit_accounts.sale_id` | Link the completed sale being paid, refunded or financed. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.credit_accounts.original_balance` | Reconcile the exact money, stock, version or operational count represented by original balance. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.credit_accounts.outstanding_balance` | Reconcile the exact money, stock, version or operational count represented by outstanding balance. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.credit_accounts.due_date` | Record the credit repayment due date. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.credit_accounts.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.credit_accounts.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.credit_accounts.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.credit_repayments`

Record and attribute a payment reducing an existing customer credit balance.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.credit_repayments.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.credit_repayments.credit_account_id` | Link the credit obligation reduced by this repayment. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.credit_repayments.customer_id` | Link the customer profile or debt obligation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.credit_repayments.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.credit_repayments.method` | Maintain the method needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.credit_repayments.reference` | Reconcile a supplier invoice or external payment; may contain third-party personal identifiers. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.credit_repayments.shift_id` | Link the responsible till/reconciliation period. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.credit_repayments.received_by` | Attribute the stock receipt to its staff operator. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.credit_repayments.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.customers`

Maintain optional customer contact/profile details and link credit/sale records.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.customers.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.customers.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.customers.phone` | Contact or identify the customer, supplier or business owner by phone. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.customers.email` | Contact or identify the person/account by email. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.customers.notes` | Keep operator-entered context; may contain customer/staff/supplier personal data. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.customers.active` | Maintain the active needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.customers.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.customers.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.expenses`

Record and attribute a business expense and its payment/till impact.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.expenses.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.expenses.category` | Maintain the category needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.expenses.description` | Describe the transaction/expense or service; may contain personal free text. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.expenses.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.expenses.expense_date` | Place an expense in the selected reporting/accounting day. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.expenses.payment_method` | Maintain the payment method needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.expenses.receipt_reference` | Reconcile an expense receipt or external payment reference. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.expenses.shift_id` | Link the responsible till/reconciliation period. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.expenses.created_by` | Attribute creation/issuance to a staff member or Mansora administrator, according to this table. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.expenses.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.import_batches`

Record local import provenance and prevent the same opening-stock file being applied twice.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.import_batches.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.import_batches.file_name` | Identify the original import filename, which may contain a person or business name. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.import_batches.file_hash` | Fingerprint the source import file to prevent duplicate application of opening stock. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.import_batches.created_count` | Reconcile the exact money, stock, version or operational count represented by created count. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.import_batches.skipped_count` | Reconcile the exact money, stock, version or operational count represented by skipped count. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.import_batches.opening_stock_applied` | Maintain the opening stock applied needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.import_batches.imported_by` | Attribute the import to its staff operator. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.import_batches.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.inventory_movements`

Explain each stock change, its source, cost and responsible staff member.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.inventory_movements.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.inventory_movements.product_id` | Link the catalogue product affected by this record. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.inventory_movements.type` | Maintain the type needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.inventory_movements.quantity_delta` | Reconcile the exact money, stock, version or operational count represented by quantity delta. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.inventory_movements.unit_cost` | Reconcile the exact money, stock, version or operational count represented by unit cost. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.inventory_movements.reference_type` | Maintain the reference type needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.inventory_movements.reference_id` | Link the related operational record or actor for reconciliation and access accountability. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.inventory_movements.actor_id` | Link the staff actor responsible for the event. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.inventory_movements.reason` | Explain the financial, stock or access action; may contain personal free text. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.inventory_movements.occurred_at` | Preserve the recorded activity time for audit/sync order. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.meta`

Store shop settings, device identity/credential, counters and recovery/backup configuration.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.meta.key` | Select a local setting/credential or counter stored in the value column. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.meta.value` | Hold the selected setting; can include business contacts, raw device credential or derived automatic-backup key. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |

#### `laptop.outbox`

Durably queue committed shop record snapshots until the cloud acknowledges them.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.outbox.seq` | Reconcile the exact money, stock, version or operational count represented by seq. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.outbox.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.outbox.type` | Maintain the type needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.outbox.payload` | Keep complete synchronized row snapshots, potentially including historical personal fields after profile edits. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.outbox.actor_id` | Link the staff actor responsible for the event. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.outbox.occurred_at` | Preserve the recorded activity time for audit/sync order. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.outbox.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.outbox.attempts` | Reconcile the exact money, stock, version or operational count represented by attempts. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.outbox.last_error` | Explain a synchronization failure; stored error text can contain operational/personal context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.outbox.synced_at` | Track durable event acknowledgement. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.payments`

Record a sale tender, payment method and optional external payment reference.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.payments.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.payments.sale_id` | Link the completed sale being paid, refunded or financed. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.payments.method` | Maintain the method needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.payments.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.payments.reference` | Reconcile a supplier invoice or external payment; may contain third-party personal identifiers. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |

#### `laptop.products`

Maintain product identity, prices, reorder threshold and catalogue version.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.products.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.products.sku` | Maintain the sku needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.products.barcode` | Maintain the barcode needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.products.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.products.category_id` | Link the catalogue category. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.products.unit` | Maintain the unit needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.products.cost_price` | Reconcile the exact money, stock, version or operational count represented by cost price. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.products.selling_price` | Reconcile the exact money, stock, version or operational count represented by selling price. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.products.reorder_level` | Reconcile the exact money, stock, version or operational count represented by reorder level. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.products.active` | Maintain the active needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.products.version` | Reconcile the exact money, stock, version or operational count represented by version. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.products.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.products.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.purchase_items`

Preserve product quantities and unit costs for a recorded stock receipt.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.purchase_items.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.purchase_items.purchase_id` | Link the parent stock receipt. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.purchase_items.product_id` | Link the catalogue product affected by this record. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.purchase_items.quantity` | Reconcile the exact money, stock, version or operational count represented by quantity. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.purchase_items.unit_cost` | Reconcile the exact money, stock, version or operational count represented by unit cost. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |

#### `laptop.purchases`

Attribute a stock receipt to its supplier, invoice and receiving staff member.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.purchases.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.purchases.supplier_id` | Link the supplier for a stock receipt. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.purchases.reference` | Reconcile a supplier invoice or external payment; may contain third-party personal identifiers. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.purchases.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.purchases.total_cost` | Maintain the total cost needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.purchases.received_at` | Maintain the received at needed for this record and its lifecycle/reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.purchases.created_by` | Attribute creation/issuance to a staff member or Mansora administrator, according to this table. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.refund_items`

Preserve the quantities, money and stock/cost effect of a returned sale line.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.refund_items.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.refund_items.refund_id` | Link the parent refund. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.refund_items.sale_item_id` | Link the original receipt line. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.refund_items.product_id` | Link the catalogue product affected by this record. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.refund_items.quantity` | Reconcile the exact money, stock, version or operational count represented by quantity. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.refund_items.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.refund_items.restocked` | Maintain the restocked needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |

#### `laptop.refunds`

Record a refund, its reason, customer/sale/shift linkage and responsible approver.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.refunds.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.refunds.sale_id` | Link the completed sale being paid, refunded or financed. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.refunds.refund_no` | Maintain the refund no needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.refunds.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.refunds.cost_total` | Reconcile the exact money, stock, version or operational count represented by cost total. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.refunds.payout_method` | Maintain the payout method needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.refunds.payout_amount` | Maintain the payout amount needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.refunds.credit_reduction` | Reconcile the exact money, stock, version or operational count represented by credit reduction. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.refunds.reason` | Explain the financial, stock or access action; may contain personal free text. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.refunds.requested_by` | Attribute the staff refund request. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.refunds.authorised_by` | Attribute approval of a restricted transaction. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.refunds.shift_id` | Link the responsible till/reconciliation period. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.refunds.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.sale_items`

Preserve the product/price/cost snapshot, quantity and discount sold on a receipt.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.sale_items.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.sale_items.sale_id` | Link the completed sale being paid, refunded or financed. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.sale_items.product_id` | Link the catalogue product affected by this record. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.sale_items.product_name` | Preserve the sold product description; normally goods data but operator-controlled text. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sale_items.sku` | Maintain the sku needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sale_items.quantity` | Reconcile the exact money, stock, version or operational count represented by quantity. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sale_items.unit_price` | Reconcile the exact money, stock, version or operational count represented by unit price. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sale_items.cost_snapshot` | Reconcile the exact money, stock, version or operational count represented by cost snapshot. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sale_items.discount` | Reconcile the exact money, stock, version or operational count represented by discount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sale_items.line_total` | Reconcile the exact money, stock, version or operational count represented by line total. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |

#### `laptop.sales`

Preserve a completed sale, customer/staff/shift linkage, totals and discount authoriser.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.sales.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.sales.receipt_no` | Identify the issued receipt and related customer/staff transaction. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sales.shift_id` | Link the responsible till/reconciliation period. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.sales.cashier_id` | Link the cashier responsible for the sale or till. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.sales.customer_id` | Link the customer profile or debt obligation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.sales.subtotal` | Reconcile the exact money, stock, version or operational count represented by subtotal. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sales.discount_total` | Reconcile the exact money, stock, version or operational count represented by discount total. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sales.total` | Reconcile the exact money, stock, version or operational count represented by total. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sales.cash_tendered` | Reconcile the exact money, stock, version or operational count represented by cash tendered. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sales.change_given` | Reconcile the exact money, stock, version or operational count represented by change given. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sales.cost_total` | Reconcile the exact money, stock, version or operational count represented by cost total. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sales.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.sales.discount_approved_by` | Attribute approval of a sale discount. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.sales.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.schema_migrations`

Track controlled schema versions so migrations are not repeated.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.schema_migrations.id` | Stable record identifier for references and idempotency. No personal data expected in controlled schema metadata; confirm that future migration names or added metadata never include personal content. |
| `laptop.schema_migrations.name` | Display the record/person/business name in its operational context. No personal data expected in controlled schema metadata; confirm that future migration names or added metadata never include personal content. |
| `laptop.schema_migrations.applied_at` | Maintain the applied at needed for this record and its lifecycle/reconciliation. No personal data expected in controlled schema metadata; confirm that future migration names or added metadata never include personal content. |

#### `laptop.shift_cash_movements`

Record approved cash entering or leaving a cashier till.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.shift_cash_movements.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.shift_cash_movements.shift_id` | Link the responsible till/reconciliation period. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.shift_cash_movements.direction` | Maintain the direction needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.shift_cash_movements.amount` | Reconcile the exact money, stock, version or operational count represented by amount. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.shift_cash_movements.reason` | Explain the financial, stock or access action; may contain personal free text. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.shift_cash_movements.authorised_by` | Attribute approval of a restricted transaction. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.shift_cash_movements.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.shifts`

Attribute till opening, reconciliation, variance and sign-off to staff.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.shifts.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.shifts.cashier_id` | Link the cashier responsible for the sale or till. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.shifts.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.shifts.opening_float` | Reconcile the exact money, stock, version or operational count represented by opening float. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.shifts.opened_at` | Record staff shift opening time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.shifts.closed_at` | Record staff shift closing time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.shifts.expected_cash` | Reconcile the exact money, stock, version or operational count represented by expected cash. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.shifts.counted_cash` | Reconcile the exact money, stock, version or operational count represented by counted cash. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.shifts.variance` | Reconcile the exact money, stock, version or operational count represented by variance. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.shifts.notes` | Keep operator-entered context; may contain customer/staff/supplier personal data. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.shifts.reviewed_by` | Attribute shift sign-off to its reviewer. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.shifts.reviewed_at` | Record staff reconciliation sign-off time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.shifts.review_notes` | Maintain the review notes needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |

#### `laptop.stock_balances`

Maintain current quantity, average cost and version for a product.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.stock_balances.product_id` | Link the catalogue product affected by this record. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.stock_balances.quantity` | Reconcile the exact money, stock, version or operational count represented by quantity. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.stock_balances.average_cost` | Reconcile the exact money, stock, version or operational count represented by average cost. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.stock_balances.version` | Reconcile the exact money, stock, version or operational count represented by version. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.stock_balances.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.suppliers`

Maintain supplier identity and optional contact details for stock receipts.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.suppliers.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.suppliers.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.suppliers.phone` | Contact or identify the customer, supplier or business owner by phone. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.suppliers.notes` | Keep operator-entered context; may contain customer/staff/supplier personal data. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.suppliers.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.support_access_grants`

Record why, by whom and for how long aggregate report support access was permitted.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.support_access_grants.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.support_access_grants.scope` | Maintain the scope needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.support_access_grants.purpose` | Record the owner-stated reason for allowing support report access. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.support_access_grants.granted_by` | Attribute the support-access decision to the shop owner. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.support_access_grants.starts_at` | Start the support-consent validity interval. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.support_access_grants.expires_at` | Enforce the credential/grant/session expiry time. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.support_access_grants.revoked_at` | Stop future support access without deleting its historical grant. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.support_access_grants.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.support_access_log`

Tell the shop which Mansora administrator accessed or was refused reports.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.support_access_log.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.support_access_log.admin_name` | Show the administrator name to the shop in its support-access history. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.support_access_log.action` | Maintain the action needed for this record and its lifecycle/reconciliation. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.support_access_log.grant_id` | Link the owner permission governing a support access. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.support_access_log.occurred_at` | Preserve the recorded activity time for audit/sync order. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |

#### `laptop.users`

Attribute shop activity to named staff and enforce staff account permissions.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.users.id` | Stable record identifier for references and idempotency. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.users.username` | Identify the staff login and attribute staff operations. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.users.name` | Display the record/person/business name in its operational context. Direct identity/contact or operator-controlled/free-text content, potentially personal. Should collection/redaction restrictions be added for this field? |
| `laptop.users.role` | Apply the staff role and owner-only restrictions. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.users.status` | Enforce or display lifecycle/accounting state, not erase the underlying record. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.users.permissions` | Enforce the staff member permission set. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.users.password_hash` | Verify a password using its stored hash; no plaintext password is stored in this column. Security credential/authenticator material linked to an account; encryption or hashing is not anonymisation. Which protection and retention duties apply? |
| `laptop.users.failed_attempts` | Throttle repeated incorrect credentials or second-factor attempts. Operational/catalogue/financial metadata, often nonpersonal alone but potentially personal when linked to a customer, worker or sole trader. Lawyer to classify. |
| `laptop.users.locked_until` | Enforce a temporary account lockout. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.users.created_at` | Record creation chronology for reconciliation, security or lifecycle review. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.users.updated_at` | Order current-record changes and reconciliation. Linkable identifier, staff/account attribute or activity chronology; may identify a person through related records. What legal purpose and access limits apply? |
| `laptop.users.email` | Optional staff email, used only to send a one-time sign-in code. Stays on the laptop; sent once to the email provider. Direct contact detail of a worker. Is consent or employment necessity the right basis, and should it be erased when the account is disabled? |

#### `laptop.staff_invites`

Send a staff member a one-time sign-in code by email so they choose their own password. Only a hash of the code is stored; the cloud keeps a delivery record with the code removed.

| Field | Purpose / personal-data review |
| --- | --- |
| `laptop.staff_invites.user_id` | Link the pending invitation to one staff account. Linkable identifier for a worker's account. What legal purpose and access limits apply? |
| `laptop.staff_invites.code_hash` | Verify the emailed code using its SHA-256 hash; the code itself is not stored. Security credential material linked to an account; hashing is not anonymisation. Which protection and retention duties apply? |
| `laptop.staff_invites.expires_at` | Stop the code working after 48 hours. Operational security metadata, potentially personal when linked to a worker. Lawyer to classify. |
| `laptop.staff_invites.attempts` | Cancel the invitation after five wrong codes. Operational security metadata, potentially personal when linked to a worker. Lawyer to classify. |
| `laptop.staff_invites.created_by` | Attribute who sent the invitation. Linkable staff identifier and activity attribution. What legal purpose and access limits apply? |
| `laptop.staff_invites.created_at` | Record when the invitation was sent. Activity chronology linked to a worker. What legal purpose and access limits apply? |
| `laptop.staff_invites.used_at` | Make the code single-use and record when the password was set. Activity chronology linked to a worker. What legal purpose and access limits apply? |



### Billing migration additions — `cloud.billing_accounts`

Identify the client billing contact, address and tax details for Mansora subscription documents.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.billing_accounts.id` | Identify the client billing contact, address and tax details for Mansora subscription documents. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_accounts.tenant_id` | Identify the client billing contact, address and tax details for Mansora subscription documents. Field: tenant id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_accounts.billing_name` | Identify the client billing contact, address and tax details for Mansora subscription documents. Field: billing name. Client or payer contact/identity or masked payment detail may identify a natural person or sole trader; masked details remain linkable. |
| `cloud.billing_accounts.billing_email` | Identify the client billing contact, address and tax details for Mansora subscription documents. Field: billing email. Client or payer contact/identity or masked payment detail may identify a natural person or sole trader; masked details remain linkable. |
| `cloud.billing_accounts.billing_phone` | Identify the client billing contact, address and tax details for Mansora subscription documents. Field: billing phone. Client or payer contact/identity or masked payment detail may identify a natural person or sole trader; masked details remain linkable. |
| `cloud.billing_accounts.address` | Identify the client billing contact, address and tax details for Mansora subscription documents. Field: address. Client or payer contact/identity or masked payment detail may identify a natural person or sole trader; masked details remain linkable. |
| `cloud.billing_accounts.tax_id` | Identify the client billing contact, address and tax details for Mansora subscription documents. Field: tax id. Client or payer contact/identity or masked payment detail may identify a natural person or sole trader; masked details remain linkable. |
| `cloud.billing_accounts.vat_registered` | Identify the client billing contact, address and tax details for Mansora subscription documents. Field: vat registered. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_accounts.created_at` | Identify the client billing contact, address and tax details for Mansora subscription documents. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_accounts.updated_at` | Identify the client billing contact, address and tax details for Mansora subscription documents. Field: updated at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.billing_audit_logs`

Attribute immutable billing actions to actors, businesses and documents for accountability.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.billing_audit_logs.id` | Attribute immutable billing actions to actors, businesses and documents for accountability. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_audit_logs.actor_type` | Attribute immutable billing actions to actors, businesses and documents for accountability. Field: actor type. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_audit_logs.actor_id` | Attribute immutable billing actions to actors, businesses and documents for accountability. Field: actor id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_audit_logs.action` | Attribute immutable billing actions to actors, businesses and documents for accountability. Field: action. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_audit_logs.entity_type` | Attribute immutable billing actions to actors, businesses and documents for accountability. Field: entity type. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_audit_logs.entity_id` | Attribute immutable billing actions to actors, businesses and documents for accountability. Field: entity id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_audit_logs.tenant_id` | Attribute immutable billing actions to actors, businesses and documents for accountability. Field: tenant id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_audit_logs.detail` | Attribute immutable billing actions to actors, businesses and documents for accountability. Field: detail. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.billing_audit_logs.occurred_at` | Attribute immutable billing actions to actors, businesses and documents for accountability. Field: occurred at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.billing_events`

Deduplicate and investigate provider webhook deliveries and their processing outcomes.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.billing_events.id` | Deduplicate and investigate provider webhook deliveries and their processing outcomes. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_events.provider` | Deduplicate and investigate provider webhook deliveries and their processing outcomes. Field: provider. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_events.event_id` | Deduplicate and investigate provider webhook deliveries and their processing outcomes. Field: event id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_events.type` | Deduplicate and investigate provider webhook deliveries and their processing outcomes. Field: type. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_events.payload` | Deduplicate and investigate provider webhook deliveries and their processing outcomes. Field: payload. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.billing_events.outcome` | Deduplicate and investigate provider webhook deliveries and their processing outcomes. Field: outcome. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_events.detail` | Deduplicate and investigate provider webhook deliveries and their processing outcomes. Field: detail. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.billing_events.received_at` | Deduplicate and investigate provider webhook deliveries and their processing outcomes. Field: received at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.billing_exceptions`

Track reconciliation exceptions and authorised resolutions without losing financial evidence.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.billing_exceptions.id` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_exceptions.dedupe_key` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: dedupe key. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_exceptions.kind` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: kind. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_exceptions.tenant_id` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: tenant id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_exceptions.invoice_id` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: invoice id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_exceptions.payment_id` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: payment id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_exceptions.attempt_id` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: attempt id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_exceptions.detail` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: detail. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.billing_exceptions.status` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: status. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_exceptions.resolution` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: resolution. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.billing_exceptions.resolved_by` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: resolved by. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_exceptions.resolved_at` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: resolved at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_exceptions.created_at` | Track reconciliation exceptions and authorised resolutions without losing financial evidence. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.billing_payments`

Record subscription receipts, provider references, refunds and settlement reconciliation.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.billing_payments.id` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.tenant_id` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: tenant id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.method` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: method. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.provider` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: provider. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.attempt_id` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: attempt id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.provider_txn_id` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: provider txn id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.reference` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: reference. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.amount` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: amount. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.fee` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: fee. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.amount_refunded` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: amount refunded. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.currency` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: currency. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.status` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: status. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.sandbox` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: sandbox. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.received_at` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: received at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.receipt_number` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: receipt number. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.recorded_by` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: recorded by. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.notes` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: notes. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.billing_payments.settlement_id` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: settlement id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_payments.created_at` | Record subscription receipts, provider references, refunds and settlement reconciliation. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.billing_refunds`

Document subscription refund amounts, reasons, provider completion and administrator attribution.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.billing_refunds.id` | Document subscription refund amounts, reasons, provider completion and administrator attribution. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_refunds.payment_id` | Document subscription refund amounts, reasons, provider completion and administrator attribution. Field: payment id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_refunds.amount` | Document subscription refund amounts, reasons, provider completion and administrator attribution. Field: amount. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_refunds.reason` | Document subscription refund amounts, reasons, provider completion and administrator attribution. Field: reason. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.billing_refunds.status` | Document subscription refund amounts, reasons, provider completion and administrator attribution. Field: status. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_refunds.provider_ref` | Document subscription refund amounts, reasons, provider completion and administrator attribution. Field: provider ref. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_refunds.created_by` | Document subscription refund amounts, reasons, provider completion and administrator attribution. Field: created by. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_refunds.created_at` | Document subscription refund amounts, reasons, provider completion and administrator attribution. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.billing_settings`

Store platform billing configuration; runtime provider credentials remain outside these SQL settings.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.billing_settings.key` | Store platform billing configuration; runtime provider credentials remain outside these SQL settings. Field: key. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.billing_settings.value` | Store platform billing configuration; runtime provider credentials remain outside these SQL settings. Field: value. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.billing_settings.updated_at` | Store platform billing configuration; runtime provider credentials remain outside these SQL settings. Field: updated at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.client_subscriptions`

Record agreed subscription fees, billing dates, mandate linkage and cancellation history.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.client_subscriptions.agreed_amount` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: agreed amount. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.billing_frequency` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: billing frequency. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.start_date` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: start date. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.billing_anchor` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: billing anchor. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.payment_method` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: payment method. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.mandate_id` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: mandate id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.activation_policy` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: activation policy. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.discount_bps` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: discount bps. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.discount_note` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: discount note. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.client_subscriptions.proration_enabled` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: proration enabled. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.cancel_requested_at` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: cancel requested at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.cancel_reason` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: cancel reason. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.client_subscriptions.cancel_at_period_end` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: cancel at period end. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.paused_at` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: paused at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.cancelled_at` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: cancelled at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.client_subscriptions.last_payment_at` | Record agreed subscription fees, billing dates, mandate linkage and cancellation history. Field: last payment at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.collection_reminders`

Record invoice reminder steps and delivery outcomes without duplicate reminders.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.collection_reminders.id` | Record invoice reminder steps and delivery outcomes without duplicate reminders. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.collection_reminders.invoice_id` | Record invoice reminder steps and delivery outcomes without duplicate reminders. Field: invoice id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.collection_reminders.step` | Record invoice reminder steps and delivery outcomes without duplicate reminders. Field: step. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.collection_reminders.due_on` | Record invoice reminder steps and delivery outcomes without duplicate reminders. Field: due on. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.collection_reminders.status` | Record invoice reminder steps and delivery outcomes without duplicate reminders. Field: status. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.collection_reminders.notification_id` | Record invoice reminder steps and delivery outcomes without duplicate reminders. Field: notification id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.collection_reminders.created_at` | Record invoice reminder steps and delivery outcomes without duplicate reminders. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.credit_notes`

Document numbered invoice credits and their approving administrator and reason.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.credit_notes.id` | Document numbered invoice credits and their approving administrator and reason. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.credit_notes.invoice_id` | Document numbered invoice credits and their approving administrator and reason. Field: invoice id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.credit_notes.number` | Document numbered invoice credits and their approving administrator and reason. Field: number. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.credit_notes.amount` | Document numbered invoice credits and their approving administrator and reason. Field: amount. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.credit_notes.reason` | Document numbered invoice credits and their approving administrator and reason. Field: reason. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.credit_notes.created_by` | Document numbered invoice credits and their approving administrator and reason. Field: created by. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.credit_notes.created_at` | Document numbered invoice credits and their approving administrator and reason. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.disputes`

Track client invoice/payment disputes, explanations and resolution history.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.disputes.id` | Track client invoice/payment disputes, explanations and resolution history. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.disputes.tenant_id` | Track client invoice/payment disputes, explanations and resolution history. Field: tenant id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.disputes.invoice_id` | Track client invoice/payment disputes, explanations and resolution history. Field: invoice id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.disputes.payment_id` | Track client invoice/payment disputes, explanations and resolution history. Field: payment id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.disputes.reason` | Track client invoice/payment disputes, explanations and resolution history. Field: reason. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.disputes.status` | Track client invoice/payment disputes, explanations and resolution history. Field: status. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.disputes.resolution` | Track client invoice/payment disputes, explanations and resolution history. Field: resolution. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.disputes.opened_by` | Track client invoice/payment disputes, explanations and resolution history. Field: opened by. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.disputes.opened_at` | Track client invoice/payment disputes, explanations and resolution history. Field: opened at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.disputes.resolved_at` | Track client invoice/payment disputes, explanations and resolution history. Field: resolved at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.document_sequences`

Allocate unique numbered billing documents by document kind and year.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.document_sequences.kind` | Allocate unique numbered billing documents by document kind and year. Field: kind. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.document_sequences.year` | Allocate unique numbered billing documents by document kind and year. Field: year. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.document_sequences.last` | Allocate unique numbered billing documents by document kind and year. Field: last. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.invoice_line_items`

Explain invoice services, quantities, discounts and integer-pesewa line amounts.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.invoice_line_items.id` | Explain invoice services, quantities, discounts and integer-pesewa line amounts. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoice_line_items.invoice_id` | Explain invoice services, quantities, discounts and integer-pesewa line amounts. Field: invoice id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoice_line_items.position` | Explain invoice services, quantities, discounts and integer-pesewa line amounts. Field: position. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoice_line_items.description` | Explain invoice services, quantities, discounts and integer-pesewa line amounts. Field: description. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.invoice_line_items.service_code` | Explain invoice services, quantities, discounts and integer-pesewa line amounts. Field: service code. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoice_line_items.quantity` | Explain invoice services, quantities, discounts and integer-pesewa line amounts. Field: quantity. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoice_line_items.unit_price` | Explain invoice services, quantities, discounts and integer-pesewa line amounts. Field: unit price. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoice_line_items.discount` | Explain invoice services, quantities, discounts and integer-pesewa line amounts. Field: discount. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoice_line_items.line_total` | Explain invoice services, quantities, discounts and integer-pesewa line amounts. Field: line total. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.invoices`

Preserve client subscription invoice identity, service periods, amounts and payment lifecycle.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.invoices.id` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.tenant_id` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: tenant id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.subscription_id` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: subscription id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.number` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: number. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.status` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: status. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.status_before_dispute` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: status before dispute. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.is_initial` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: is initial. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.issue_date` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: issue date. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.due_date` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: due date. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.period_start` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: period start. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.period_end` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: period end. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.currency` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: currency. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.subtotal` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: subtotal. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.discount_total` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: discount total. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.tax_bps` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: tax bps. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.tax_total` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: tax total. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.total` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: total. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.amount_paid` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: amount paid. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.amount_refunded` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: amount refunded. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.amount_credited` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: amount credited. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.amount_written_off` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: amount written off. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.notes` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: notes. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.invoices.idempotency_key` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: idempotency key. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.merchant_account_id` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: merchant account id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.created_by` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: created by. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.created_at` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.sent_at` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: sent at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.viewed_at` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: viewed at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.paid_at` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: paid at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.invoices.cancelled_at` | Preserve client subscription invoice identity, service periods, amounts and payment lifecycle. Field: cancelled at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.merchant_payment_accounts`

Distinguish Mansora and client merchant settlement ownership and verification status.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.merchant_payment_accounts.id` | Distinguish Mansora and client merchant settlement ownership and verification status. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.merchant_payment_accounts.owner_type` | Distinguish Mansora and client merchant settlement ownership and verification status. Field: owner type. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.merchant_payment_accounts.tenant_id` | Distinguish Mansora and client merchant settlement ownership and verification status. Field: tenant id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.merchant_payment_accounts.provider` | Distinguish Mansora and client merchant settlement ownership and verification status. Field: provider. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.merchant_payment_accounts.display_name` | Distinguish Mansora and client merchant settlement ownership and verification status. Field: display name. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.merchant_payment_accounts.status` | Distinguish Mansora and client merchant settlement ownership and verification status. Field: status. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.merchant_payment_accounts.settlement_note` | Distinguish Mansora and client merchant settlement ownership and verification status. Field: settlement note. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.merchant_payment_accounts.created_at` | Distinguish Mansora and client merchant settlement ownership and verification status. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.notifications`

Queue billing communications, their recipient/content and delivery or failure evidence.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.notifications.id` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.notifications.tenant_id` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: tenant id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.notifications.channel` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: channel. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.notifications.to_address` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: to address. Client or payer contact/identity or masked payment detail may identify a natural person or sole trader; masked details remain linkable. |
| `cloud.notifications.subject` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: subject. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.notifications.body` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: body. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.notifications.status` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: status. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.notifications.error` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: error. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.notifications.invoice_id` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: invoice id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.notifications.kind` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: kind. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.notifications.created_at` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.notifications.sent_at` | Queue billing communications, their recipient/content and delivery or failure evidence. Field: sent at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.payment_allocations`

Reconcile payment amounts and refunded portions against specific invoices.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.payment_allocations.id` | Reconcile payment amounts and refunded portions against specific invoices. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_allocations.payment_id` | Reconcile payment amounts and refunded portions against specific invoices. Field: payment id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_allocations.invoice_id` | Reconcile payment amounts and refunded portions against specific invoices. Field: invoice id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_allocations.amount` | Reconcile payment amounts and refunded portions against specific invoices. Field: amount. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_allocations.refunded` | Reconcile payment amounts and refunded portions against specific invoices. Field: refunded. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.payment_attempts`

Track idempotent payment requests, provider checkout references and completion or failure.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.payment_attempts.id` | Track idempotent payment requests, provider checkout references and completion or failure. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.tenant_id` | Track idempotent payment requests, provider checkout references and completion or failure. Field: tenant id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.invoice_id` | Track idempotent payment requests, provider checkout references and completion or failure. Field: invoice id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.mandate_id` | Track idempotent payment requests, provider checkout references and completion or failure. Field: mandate id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.provider` | Track idempotent payment requests, provider checkout references and completion or failure. Field: provider. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.kind` | Track idempotent payment requests, provider checkout references and completion or failure. Field: kind. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.amount` | Track idempotent payment requests, provider checkout references and completion or failure. Field: amount. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.currency` | Track idempotent payment requests, provider checkout references and completion or failure. Field: currency. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.status` | Track idempotent payment requests, provider checkout references and completion or failure. Field: status. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.reference` | Track idempotent payment requests, provider checkout references and completion or failure. Field: reference. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.idempotency_key` | Track idempotent payment requests, provider checkout references and completion or failure. Field: idempotency key. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.attempt_no` | Track idempotent payment requests, provider checkout references and completion or failure. Field: attempt no. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.checkout_url` | Track idempotent payment requests, provider checkout references and completion or failure. Field: checkout url. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.provider_txn_id` | Track idempotent payment requests, provider checkout references and completion or failure. Field: provider txn id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.failure_reason` | Track idempotent payment requests, provider checkout references and completion or failure. Field: failure reason. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.payment_attempts.sandbox` | Track idempotent payment requests, provider checkout references and completion or failure. Field: sandbox. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.requested_by` | Track idempotent payment requests, provider checkout references and completion or failure. Field: requested by. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.created_at` | Track idempotent payment requests, provider checkout references and completion or failure. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.updated_at` | Track idempotent payment requests, provider checkout references and completion or failure. Field: updated at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_attempts.completed_at` | Track idempotent payment requests, provider checkout references and completion or failure. Field: completed at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.payment_mandates`

Record client consent and lifecycle of automatic-payment authority and protect its provider token.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.payment_mandates.id` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.tenant_id` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: tenant id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.subscription_id` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: subscription id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.provider` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: provider. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.method` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: method. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.status` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: status. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.provider_ref` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: provider ref. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.token_encrypted` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: token encrypted. Encrypted reusable payment authorisation material linked to a client. Encryption is not anonymisation; never expose raw tokens in dashboards, exports or logs. |
| `cloud.payment_mandates.masked` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: masked. Client or payer contact/identity or masked payment detail may identify a natural person or sole trader; masked details remain linkable. |
| `cloud.payment_mandates.max_amount` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: max amount. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.frequency` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: frequency. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.consent_text` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: consent text. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.payment_mandates.consent_at` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: consent at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.approved_at` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: approved at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.cancelled_at` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: cancelled at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.cancel_reason` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: cancel reason. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.payment_mandates.sandbox` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: sandbox. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.payment_mandates.created_at` | Record client consent and lifecycle of automatic-payment authority and protect its provider token. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |


### Billing migration additions — `cloud.service_plans`

Describe offered subscription terms, prices, trial periods and commercial policy text.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.service_plans.description` | Describe offered subscription terms, prices, trial periods and commercial policy text. Field: description. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.service_plans.category` | Describe offered subscription terms, prices, trial periods and commercial policy text. Field: category. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.service_plans.annual_price` | Describe offered subscription terms, prices, trial periods and commercial policy text. Field: annual price. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.service_plans.currency` | Describe offered subscription terms, prices, trial periods and commercial policy text. Field: currency. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.service_plans.trial_days` | Describe offered subscription terms, prices, trial periods and commercial policy text. Field: trial days. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.service_plans.setup_fee` | Describe offered subscription terms, prices, trial periods and commercial policy text. Field: setup fee. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.service_plans.effective_from` | Describe offered subscription terms, prices, trial periods and commercial policy text. Field: effective from. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.service_plans.renewal_policy` | Describe offered subscription terms, prices, trial periods and commercial policy text. Field: renewal policy. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.service_plans.cancellation_policy` | Describe offered subscription terms, prices, trial periods and commercial policy text. Field: cancellation policy. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |
| `cloud.service_plans.addons` | Describe offered subscription terms, prices, trial periods and commercial policy text. Field: addons. Free text or structured content may repeat contact, payment and historical personal details. Review collection limits, minimisation, disclosure and retention across provider and backup copies. |


### Billing migration additions — `cloud.settlements`

Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence.

| Field | Purpose / personal-data review |
| --- | --- |
| `cloud.settlements.id` | Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence. Field: id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.settlements.provider` | Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence. Field: provider. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.settlements.merchant_account_id` | Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence. Field: merchant account id. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.settlements.reference` | Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence. Field: reference. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.settlements.settled_on` | Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence. Field: settled on. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.settlements.gross` | Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence. Field: gross. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.settlements.fees` | Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence. Field: fees. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.settlements.net` | Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence. Field: net. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.settlements.created_by` | Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence. Field: created by. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |
| `cloud.settlements.created_at` | Reconcile provider gross receipts, fees and net settlement amounts with attributed evidence. Field: created at. A technical, commercial or financial field can be linked to client, payer or administrator identities through related records. Assess necessity, access and retention in that context. |

Billing additions above describe schema and potential access paths, not a legal classification or approved retention policy. Provider tokens, webhook payloads, consent and notification copies require specific review. Provider environment keys (`BILLING_ENCRYPTION_KEY`, `PAY_LINK_SECRET` and live provider credentials) are outside SQL; the deployment operator must agree custody, rotation and incident controls. Sandbox evidence does not establish live-provider compliance.

### Notification delivery metadata (migration 5)

These fields remain in the existing platform notification retention/access scope. Resend receives the sender, recipient, subject and message content; provider region, retention and contractual terms still require review.

| Field | Purpose and assessment |
| --- | --- |
| `cloud.notifications.attempt_count` | Bound and audit email retry attempts. Operational delivery evidence linked to the existing notification and recipient. Delivery metadata is linked to recipient/client records; assess necessity, retention and provider cross-border handling. |
| `cloud.notifications.delivery_started_at` | Prevent retry after provider idempotency protection expires. Operational delivery evidence linked to the existing notification and recipient. Delivery metadata is linked to recipient/client records; assess necessity, retention and provider cross-border handling. |
| `cloud.notifications.next_attempt_at` | Schedule and lease queued email delivery. Operational delivery evidence linked to the existing notification and recipient. Delivery metadata is linked to recipient/client records; assess necessity, retention and provider cross-border handling. |
| `cloud.notifications.provider_message_id` | Reconcile provider acceptance without storing API credentials. Operational delivery evidence linked to the existing notification and recipient. Delivery metadata is linked to recipient/client records; assess necessity, retention and provider cross-border handling. |

### Demo-request contact data (migration 6, C39)

The public request form stores business contact details after explicit contact consent. These are platform prospects, not client businesses or financial accounts. Only active platform administrators can list or update them; the tenant database role has no table permission. The public submission response contains no stored record, lead identifier or existing-email signal. Free text must not include credentials, sensitive client data or payment information.

| Field | Purpose |
| --- | --- |
| `cloud.demo_requests.id` | Deduplicate a submitted request identifier without overwriting earlier content |
| `cloud.demo_requests.name` | Contact the person who requested a demo |
| `cloud.demo_requests.business` | Understand the requested business use |
| `cloud.demo_requests.email` | Respond to the explicit request |
| `cloud.demo_requests.phone` | Optional business contact method |
| `cloud.demo_requests.message` | Optional description of requested help |
| `cloud.demo_requests.status` | Track manual follow-up; never creates a client/subscription |
| `cloud.demo_requests.consent_at` | Record when the contact request was submitted with consent |
| `cloud.demo_requests.created_at` | Order incoming requests |
| `cloud.demo_requests.updated_at` | Track manual status changes |

All fields live in the PostgreSQL platform plane and any protected provider backups. Hosted infrastructure logs may additionally record network metadata, governed separately. Public contact settings under `billing_settings.public_contact` (C40) deliberately publish only the business support channels the administrator enters; those values must never contain private credentials or customer contacts.
