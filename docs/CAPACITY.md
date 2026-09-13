# CAPACITY — how many users the current host holds

Measured on the production VPS on **2026-09-13**. Re-measure when the decode model changes, when
the scheduler stops being single-user, or when anyone proposes buying a bigger box.

Companion to ECONOMICS.md: that one asks what a user costs, this one asks how many fit.

## The host

Hostinger VPS, **2 vCPU / 7.8 GiB RAM / 96 GB disk**. Four containers via Docker Compose: `app`
(Next.js, and the scheduler runs inside it), `render` (Python, `.rm` → PNG), `db` (Postgres 16),
`caddy`.

At idle, all four together: **1.0 GiB of 7.8 used**. The heaviest, `render`, holds 60 MiB.

## What a run actually costs

From `runs` on the founder's own account, fourteen runs across 2026-09-06 to 2026-09-13.

**The five runs that decoded nothing are the most useful rows: 41, 37, 38, 33, 33 seconds.** A run
that reads no pages still takes about **36 seconds** — listing 461 documents from the reMarkable
cloud and hash-diffing them against the last snapshot. Every user pays this every night whether
they wrote anything or not.

Subtracting that from the runs that did decode:

| pages | total secs | marginal per page |
| ----: | ---------: | ----------------: |
|    31 |        651 |            19.8 s |
|    16 |        200 |            10.3 s |
|     6 |        201 |            27.5 s |
|     6 |        128 |            15.3 s |
|     1 |         47 |              11 s |
|     1 |         42 |               6 s |

Median ≈ **13 s/page**. Two rows are excluded (1 page/232 s and 7 pages/430 s): both were the
Batch API deadline expiring, burning the `DECODE_BATCH_TIMEOUT_MINUTES` wait before falling back
to the standard API. They measure the timeout, not the work.

**So: ~36 s fixed + ~13 s per page.** Eight pages a night is ~2.3 minutes. The heaviest real night
on record, 31 pages, was 11 minutes.

## Rendering is not the bottleneck

It looks like it should be. `services/render/Dockerfile` runs `uvicorn app:app` with no
`--workers`, so it is one process, and `.rm` → PNG is CPU-bound Python under the GIL — effectively
one core no matter how many the host has.

The timings say otherwise. A **one-page** run takes 42–47 s against 36 s of fixed overhead, so
every per-page local operation — render, merge, compose — fits inside single-digit seconds. The
13 s/page is overwhelmingly latency waiting on Anthropic, which is network, not CPU.

Pessimistically at 3 s/page of render CPU, and ~25 s of local CPU per user per night including
composing four PDFs: two cores across a four-hour window is 28,800 CPU-seconds, or **over 1,000
users of CPU headroom**. `--workers` is a real improvement but not the one that matters, and
`nproc` barely enters the arithmetic.

## What the host holds

| Mode | Capacity |
| --- | --- |
| Runs serialized, 8 pages/user | 14,400 s ÷ 140 s ≈ **100 users** |
| Five runs concurrent (they are almost all network wait) | **400–500 users** |

Memory, CPU and disk all sit above 1,000. Nothing about this box is the first thing to break.

## What breaks first, in order

1. **The single-user scheduler — today.** `ensureDefaultUser` resolves one account from
   `USER_EMAIL`, and `scheduler-boot.ts` schedules for that one user. There is no loop over
   accounts and no queue. A second paying customer needs Phase 2's multi-tenant scheduler, not
   hardware.

2. **The reMarkable cloud, somewhere in the low hundreds.** A single account doing four runs in
   75 minutes already earned a 429 (two runs died on it on 2026-09-10, before the backoff in
   `f0d6e89`). A run makes roughly **eight full tree listings** of a 461-document account, because
   every `uploadPdf(replace)` lists the tree before it deletes. Four hundred accounts starting at
   the same minute is 3,200 tree listings from one IP.

   Two fixes, both cheap and neither needing a bigger host: pass one tree through the upload stage
   instead of re-fetching it, and stagger start times across the hour rather than firing every
   account at 00:01.

3. **Anthropic spend, depending on the customer.** At $10/month against roughly $0.03–0.05 a
   night, tokens are 10–15% of revenue. That is the founder's own writing volume; a heavier writer
   inverts it. `/admin/expenses` shows margin per account for exactly this reason.

4. **The host itself, above ~1,000 users.** Last.

## Operational notes

**No swap.** With 6.8 GiB free that is fine, but it means a memory spike gets a container
OOM-killed rather than slowed. Expect hard failure, not degradation.

**Build cache, not data, fills the disk.** On 2026-09-13 the disk read 43% full: 39.9 GB of
BuildKit cache across 149 entries from repeated deploys, against 88 MB in the `dmstate` volume.
The 24-hour cache rotation works exactly as designed. `scripts/vps-upgrade.sh` now prunes cache
older than a week after every build and prints `docker system df` and `df -h`, so this cannot
quietly return.

**Where the headroom is, when it is needed**, cheapest first:

1. `--workers N` on uvicorn — one line, multiplies render throughput by cores.
2. Stagger run start times within the hour instead of all at 00:01.
3. One tree listing per run instead of eight.
4. Move rendering off-box.

None of these is a bigger VPS.

## Re-measuring

```bash
nproc; free -h; df -h /
docker system df
docker stats --no-stream          # during a run, not at idle — idle tells you nothing
```

```sql
select local_date,
       extract(epoch from (finished_at - started_at))::int as secs,
       (stats->>'pagesDecoded')::int as pages
from runs
where status = 'succeeded' and stats is not null
order by created_at desc limit 20;
```

Keep the zero-page rows. They are what separates the fixed cost of listing an account from the
marginal cost of reading a page; without them the per-page figure looks roughly three times worse
than it is.
