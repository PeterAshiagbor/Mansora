# DRAFT — not legal advice — for review by a Ghanaian lawyer

# Security incident and data breach response plan

## Who does what

| Role | Person | Backup |
|---|---|---|
| Incident lead (decides, coordinates, keeps the record) | [Peter Ashiagbor] | [name] |
| Technical lead (contains and fixes) | [name] | [name] |
| Client contact (tells shops) | [name] | [name] |
| Lawyer | [firm, phone] | |

Contacts to keep current: Data Protection Commission [phone, email, address]; Cyber Security Authority / CERT-GH
[phone, email, incident reporting portal]; Railway, Resend and Paystack support; Ghana Police Service Cybercrime Unit [phone].

## What counts as an incident

Any event where client data or Mansora's own data may have been seen, changed, lost or made unavailable by someone who
should not have, for example: a stolen or lost shop laptop; a leaked password, API key or backup passphrase; someone signing
in who should not; data from one shop visible to another; a server breach at a provider; a long outage with data loss;
an email sent to the wrong person with business figures.

## Steps

**1. Within the first hour: contain.** Revoke the affected device, sessions or keys (the admin dashboard can deactivate a
laptop and end sessions). Rotate leaked secrets in Railway. Keep logs; do not delete evidence.

**2. Within 24 hours: assess.** What data, which shops, how many people, was it encrypted, is it still happening?
Start the incident record (template below).

**3. Within 48 hours: tell affected shops.** Mansora is the shop's processor and must tell the shop without undue delay
(data processing agreement, clause 8.2). Say what is known, what has been done, and what the shop should do.

**4. As soon as reasonably practicable: notify the Data Protection Commission and the people affected**, where Act 843
requires it. For shop data, the shop is the controller and decides, with Mansora's help. For Mansora's own data, Mansora
notifies. Give enough detail for people to protect themselves (for example, change a password, watch for scam calls).

**5. Report to CERT-GH** serious cyber attacks (ransomware, server compromise, account takeover), and whenever the Cyber
Security Authority directs it under Act 1038. Report crimes to the Police Cybercrime Unit.

**6. Fix and learn.** Fix the cause, check the fix, and write down what will change. Review this plan.

## Lost or stolen shop laptop

The laptop store is encrypted, so data is protected if the laptop was locked or off. Still: deactivate the device from the
admin dashboard so it cannot sync; ask the owner to change staff passwords; restore the shop on a new laptop from the
cloud or a backup. Note: deactivation does not erase the laptop and does not stop it selling offline.

## Incident record template

| Field | |
|---|---|
| Date and time found, by whom | |
| What happened | |
| Data and people affected (number, shops) | |
| Encrypted? | |
| Containment actions and times | |
| Shops told (when, how) | |
| DPC notified (when, reference) or reason not required | |
| People notified (when, how) | |
| CERT-GH / police report | |
| Cause and fix | |
| Closed by, date | |

Keep incident records for 6 years. Run a practice drill once a year (for example, a lost laptop) and record it.
