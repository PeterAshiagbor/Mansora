# Incident response

Log every incident: time, client, who reported it, what happened, what was done.

| Situation | Immediate action | Then |
| --- | --- | --- |
| Shop cannot sync | Nothing is lost; selling continues. Check Sync status on the laptop for the message | Check internet, then API `/health`. "Not authorised" means the laptop was deactivated |
| Sync errors (rejected records) | Do not reinstall. Local records are intact | Developer inspects the rejected event's reason in the outbox; fix and release |
| Laptop lost or stolen | Deactivate the laptop in the dashboard | Restore the latest backup on a replacement. Tell the owner which records, if any, were never synced or backed up. Consider whether customer data was exposed (the database is encrypted and tied to the Windows account) |
| Owner forgot password | No remote reset exists in v1 | Restore from backup does not help (same passwords). Developer-assisted recovery on site; **a proper owner-recovery flow is not built** |
| Staff member suspected of fraud | Owner disables the login (immediate) | Review Audit history filtered by that person; review shift variances and refunds |
| Cloud API down | Shops keep working offline | Restore service; laptops catch up by themselves |
| Cloud database damaged | Stop the API to prevent further writes | Restore from managed backup into a clean instance; laptops re-send anything unacknowledged. Events acknowledged after the restore point are **not** re-sent automatically — see backup and recovery |
| Suspected breach of the cloud | Revoke admin sessions (delete `admin_sessions`), rotate database credentials | Review `admin_audit_logs`; assess notification duties under Act 843 with legal advice |
| Wrong data seen across clients | Treat as critical. Take the API offline | Preserve logs; reproduce with the isolation tests |

Escalation contacts, on-call rota and response times are **not yet defined**.
