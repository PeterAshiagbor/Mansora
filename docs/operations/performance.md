# Large-catalogue performance

This report measures the real desktop command engine and the embedded API using
synthetic data. It does not certify performance on physical Windows laptops or
production PostgreSQL/WAN infrastructure.

## Reproduce

```sh
npm ci
npm run test:perf -- --output performance-results.json
```

The script is deliberately outside `npm test`: the large seed and timed runs
are expensive. The ordinary suite runs only a small fixture/financial-integrity
regression and a candidate-index equivalence test. `--samples` defaults to 20 local trials
(at least 5); `--sync-samples` defaults to 5 (at least 3). Local commands have
three warmups, sync has one; warmups are excluded. Median averages the two
central sorted values; p95 is nearest rank. With five sync trials, p95 is the
observed maximum and is a coarse estimate, not a production SLO.

Each run creates an encrypted temporary SQLCipher store, populates it via direct
inserts under the real schema and immutable-record constraints, checks every
foreign key, then cleans up. It does not connect to an existing shop. Seeded
sales have matching lines, cash payments, cost snapshots, inventory movements,
stock balances, cashier/shift/customer references and audit records. The small
fixture test checks report totals against independently calculated amounts and
compares report/history results with and without the new indexes.

## Fixture and measurement scope

- 20,000 active products, 2,000 synthetic customers, 200,000 sales with 600,000
  lines distributed uniformly across January–December 2025.
- One owner/cashier, twelve closed/reviewed monthly shifts and one open benchmark
  shift. The write benchmark adds its warmup/trial sales in January 2026, outside
  the historical report period, and generates real audit/outbox/stock updates.
- Each historical line has one unit, a 500-pesewa selling price and 300-pesewa
  cost. Annual revenue is 300,000,000 pesewas; COGS 180,000,000. All money remains
  integer pesewas. Inventory movements reconcile to 20,000,000 remaining units
  before the write trials. There are 620,000 historical inventory movements.
- Historical outbox payloads are not fabricated. Refunds, credit, expenses and
  complex discount/payment mixes are not seeded. These results do not measure
  their worst-case distributions or whole-browser rendering of large tables.
- Command timings include validation, permission resolution, SQL and result
  construction, but exclude browser/IPC/rendering. Results are warm-cache
  measurements on one managed Linux VM, with no Docker containers running.
- The sync workload is 1,000 fresh product upsert events, five sequential HTTP
  requests of 200, to a real Fastify listener backed by PGlite. Every response
  must acknowledge all events with zero rejections. This is neither 1,000 full
  sale payloads nor a WAN/production-PostgreSQL measurement. The desktop currently
  sends smaller batches, so its round-trip overhead can be higher.

## Machine

AMD EPYC 9V74 host, two available CPUs, x86-64 Linux, 8 GiB cgroup memory limit
(the host reports about 9.7 GiB), Node 24.22.1, SQLite 3.53.2 through encrypted
`better-sqlite3-multiple-ciphers`. Storage is the managed workspace's overlay
filesystem. Raw command summaries and query plans are retained under
`tests/performance/results/`. Repeat on the actual supported laptop and database
before setting an operational latency target.

## Results

The baseline has only released SQLite migration 1. Three covering indexes were
then measured on a fresh fixture and **rejected**. They are available only as an
explicit disposable experiment:

```sh
npm run test:perf -- --candidate-indexes --output candidate-results.json
```

No application schema migration or query change is shipped. The current release
continues to use the baseline indexes. All values below are milliseconds.



| Operation | N | Baseline median | Baseline p95 | Candidate median | Candidate p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| product.list name fragment | 20 | 3.84 | 4.39 | 3.48 | 3.64 |
| product.lookup barcode | 20 | 0.12 | 0.27 | 0.10 | 0.13 |
| sale.complete three lines | 20 | 2.91 | 3.68 | 2.88 | 3.78 |
| report.sales month | 20 | 370.39 | 493.76 | 446.01 | 467.01 |
| report.profit month | 20 | 241.38 | 251.00 | 280.90 | 313.22 |
| report.sales year | 20 | 6220.27 | 9147.02 | 6055.02 | 6429.14 |
| report.profit year | 20 | 2670.76 | 2755.57 | 3505.40 | 3670.54 |
| stock.overview all | 20 | 90.84 | 112.02 | 98.60 | 120.40 |
| sale.list one day | 20 | 0.93 | 1.03 | 0.89 | 1.21 |
| sync.push 1000 product events (5 x 200) | 5 | 1856.85 | 1911.01 | 1974.97 | 2037.40 |

## Index choice and remaining work

The candidates cover sales date/amount/cashier aggregates, sale-line reporting
joins and payment aggregates. Query plans confirm SQLite actually used the new
covering indexes, but the result was not a useful overall improvement:

- Monthly sales median rose from 370.39 to 446.01 ms, despite a small p95 reduction.
- Monthly profit p95 rose from 251.00 to 313.22 ms; annual profit p95 rose from
  2,755.57 to 3,670.54 ms.
- Annual sales p95 improved, but its median improved by only about 2.7%; the
  baseline had much larger tail variation. This does not establish a robust gain.
- Main database size rose from 588,017,664 to 703,238,144 bytes (about 19.6%,
  excluding transient WAL). Fixture creation/verification rose from 238.42 to
  284.15 seconds (about 19.2%). Sale completion p95 stayed near 3.7 ms.
- Unrelated search/lookup/sync differences are run-to-run variation, not claimed
  effects of these SQLite indexes. Both runs are single-VM observations rather
  than a statistically powered production comparison.

The candidates therefore remain in `tests/performance/candidates.ts` only.
`--candidate-indexes` applies them to the temporary fixture; normal runs and the
application schema do not. The equivalence test verifies that applying/removing
them does not change sales, profit or history results. No released migration was
edited, and no production index was added merely to make a tuning claim.

### Operations remaining above 200 ms at p95

| Baseline operation | p95 | Proposed fix and required validation |
| --- | ---: | --- |
| Monthly sales report | 493.76 ms | Separate fast totals from the 20,000-product detail result; profile compact per-period/per-cashier/payment aggregates. Preserve report definitions, arbitrary date ranges, late entries and refunds in golden tests before changing the contract. |
| Monthly profit report | 251.00 ms | Profile compact per-product period aggregates keyed by reporting period, with edge-day fallback for arbitrary windows, instead of repeatedly grouping raw sale lines. Validate COGS snapshots and restocked-refund handling exactly. |
| Annual sales report | 9,147.02 ms | Use transactionally maintained monthly/yearly aggregates for aligned periods and bounded product detail retrieval; first profile payment/split-sale grouping and date aggregates separately. Re-measure the complete command, not only one SQL fragment. |
| Annual profit report | 2,755.57 ms | Use compact period/product COGS and refund aggregates; validate annual totals against the raw ledger before allowing a cached result. A wider join index can be tested independently, but the combined candidates here were not justified. |
| 1,000-product-event sync | 1,911.01 ms | Profile real PostgreSQL and WAN latency, then test bounded batch transactions/savepoints or grouped upserts. Acknowledgements must remain durable; crash/retry, deduplication and tenant-isolation suites must pass unchanged. |

These are measured follow-ups, not hidden fixes. This task allows indexes but not
rewriting report results or sync durability. No other measured operation exceeds
200 ms at p95. Repeat the benchmark on supported Windows hardware and the actual
production database before choosing capacity or latency promises.
