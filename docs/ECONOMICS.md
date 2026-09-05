# dayMarkable — Economics: Token Costs, Pricing, Revenue, and the Ad Question

*All model prices from Anthropic's published pricing, August 2026. Recheck before launch.*

## 1. Token cost per user

### What one nightly run consumes

An image sent to Claude costs roughly `(width × height) / 750` tokens. A reMarkable page
rendered at 1568px long edge ≈ 1.84MP ≈ **~2,500 input tokens per page**. With hash-based
change detection (only pages written on since last night get processed — the biggest cost
lever in the system), a typical active user generates about 6 changed pages a night; a heavy
note-taker 15+.

| Per nightly run | Median user (6 pages) | Heavy user (15 pages) |
|---|---|---|
| Page images (2,500 tok/page) | 15,000 in | 37,500 in |
| System prompt (cached ≈ 0.1×) + user context | ~4,500 in | ~5,500 in |
| Extraction output (~600 tok/page JSON) | 3,600 out | 9,000 out |
| Planner prioritization call | 3,000 in / 1,200 out | 3,000 in / 1,200 out |
| **Total** | **~22k in / ~5k out** | **~46k in / ~10k out** |

### What it costs per month (30 runs), using the Batch API (50% off — a 3AM service has no latency pressure)

| Model strategy | Batch price (in/out per Mtok) | Median user | Heavy user |
|---|---|---|---|
| **Sonnet 5 everywhere (chosen)** | $1.00 / $5.00 | **~$1.40/mo** | ~$2.90/mo |
| Sonnet 5 + Opus 5 escalation on low-confidence pages (~10%) | blended | **~$1.55/mo** | ~$3.20/mo |
| Opus 5 everywhere | $2.50 / $12.50 | ~$3.50/mo | ~$7.25/mo |

Haiku 4.5 would have been roughly half the Sonnet figures, but it read the founder's
handwriting clearly worst of the three (measured September 2026) and is not used. Accuracy is
the product; the saving was not worth it. The per-user calibration sample is cache-controlled,
so it costs ~0.1× after the first page of a run — a fraction of a cent a night.

Meeting-notes generation and invite drafting add modest output tokens (~1,500–2,500 out per
meeting decoded; ≈ $0.30–0.60/user/mo at one meeting a day on Sonnet batch). Email delivery is
noise: SES-class pricing is ~$0.10 per 1,000 sends, and ~60 meeting-note emails a month costs
under a cent per user. Google Calendar / Microsoft Graph API calls are free at this scale.

**Storage vs. re-reading (why the 1-day cache exists):** a user's nightly working set
(downloaded docs, rendered pages, generated outputs) is ~10–20 MB; at S3-class pricing
(~$0.023/GB-mo) keeping it for a day costs ≈ **$0.00003–0.0005/user/month** — effectively
zero. Re-downloading, re-rendering, and re-decoding documents just to update the Action List
or calendar registry would cost ~$0.02–0.05 in tokens *per night* (~$0.60–1.50/user/mo).
Storage is 3–4 orders of magnitude cheaper than compute here, so the service always keeps
one day of outputs in the cloud and updates by diffing, never by re-reading — with retention
capped at 24 hours for the privacy promise.

**Planning number: ~$1.75–2.25/active user/month in tokens** (Sonnet 5 + Opus escalation,
meeting notes included, with headroom). Add infrastructure (compute, Postgres, object storage, email,
egress): ~$0.15–0.30/user/mo at scale, plus ~$150–300/mo fixed while small. Guard the tail:
cap processing at ~40 pages/night on the base plan (covers >99% of users; heavier gets a Pro
tier).

## 2. Pricing and margin

**$10/month or $100/year** for daily updates. **14-day free trial; the user registers (card
on file) up front and billing starts automatically when the trial ends** — standard SaaS
trial mechanics, with a reminder email 3 days before first charge (that email measurably
reduces chargebacks and refund tickets).

All payment processing runs through Stripe **on the web page only** (the responsive site
serves phone users); the mobile app carries no payments, which keeps it clear of the app
stores' 15–30% in-app-purchase commissions. The admin portal can issue **prorated refunds**
for unused subscription days via the Stripe API — budget refunds at 1–2% of revenue in the
model.

Rationale: reMarkable's own Connect subscription ($2.99/mo) anchors what this audience pays
for cloud features, but dayMarkable now ships an AI chief-of-staff — nightly decode, meeting
invites, emailed meeting notes, calendar merge — which justifies a full tier above it. The
annual plan at $100 (2 months free) is the anchor to push at checkout.

Per-subscriber month at $10: tokens ~$1.90, infra ~$0.25, Stripe ~$0.59 (2.9% + $0.30) →
**gross margin ~73%**; the annual plan nets ~$8.33/mo effective for ~77% margin plus cash up
front and lower churn. Even a heavy user at the Sonnet ceiling (~$2.90/mo)
holds margin above 60%.

**Pricing is provisional until measured.** Before committing, the personal-use phase will
meter real token and cost usage across models (Sonnet 5, Opus 5, and a Fable spot
check for quality ceiling) on Jim's own notes — see BUILD_PLAN Phase 1 and the measurement
log sheet in `daymarkable-cost-model.xlsx`. The full what-if math (price × model ×
pages/day × margin, and break-even subscriber counts) lives in that workbook.

## 3. Revenue targets

Sizing: reMarkable has sold 2M+ tablets lifetime (it crossed 1M units on the current
generation and a $1B valuation); assume ~1M active cloud-connected users, of whom the
realistic wedge — daily note-takers who already wish their notes "did something" — is perhaps
100–300k. Targets against that:

| Milestone | Paying subs | MRR | ARR | Note |
|---|---|---|---|---|
| Launch +90 days | 300 | $3k | $36k | r/RemarkableTablet, eWritable, MyDeepGuide reviews |
| Year 1 | 2,500 | $25k | $300k | ~1–2% of the reachable wedge; a real business |
| Year 2 | 10,000 | $100k | $1.2M | requires paid acquisition + Kindle Scribe/Supernote expansion |

(MRR shown at the $10 monthly rate; annual-plan mix lowers effective MRR ~10–17% but improves
cash and churn.) At 10k subs, monthly token bill ≈ $10–12k against ~$100k revenue — costs
scale linearly and stay ~11% of revenue, so growth doesn't break the model.

## 4. Could ads pay for the tokens?

Short answer: **almost, on paper — but no, in practice.** The full reasoning:

**Inventory.** The only ad surface is the generated planner itself — say one tasteful
sponsored line on the Daily Sheet. That's ~30 impressions/user/month on a monochrome,
offline, un-clickable e-ink page.

**What it could earn.** Programmatic ad networks can't serve this inventory at all (no
browser, no click, no tracking), so the model is direct-sold sponsorship, like a newsletter.
Newsletter-style CPMs for an affluent professional niche run $20–40. At a $25 CPM:
30 × $0.025 = **$0.75/user/month** — which no longer covers even the token cost (~$1.75–2.25)
on the models the product actually reads with.

**Why it still fails as a business model, in order of severity:**

1. **You can't sell it until you're big.** No sponsor buys 500 users' worth of e-ink
   impressions. Direct sponsorship needs ~10k+ daily actives before the first dollar arrives —
   exactly the period when you most need the token bill covered.
2. **It has no headroom.** Best case, ads ≈ token costs and contribute nothing to infra,
   support, or profit. One heavy-user skew or CPM soft market and the free tier is underwater.
3. **It taxes the brand you're selling.** The customer paid a premium specifically for a
   distraction-free device, and dayMarkable's other pillar is privacy ("we read your handwritten
   notes — and keep them sacred"). An ad on the morning planner contradicts both, and likely
   suppresses the paid conversion that carries the real margin.

**Verdict:** subscription-first. If a free tier is ever wanted for top-of-funnel, make it a
weekly (not daily) planner with a "Presented by <sponsor>" line, ship it only after ~10k
actives, and treat sponsorship as a subsidy, not a model. The better free-tier lever is
simply the 14-day trial plus a referral month.

## 5. Sensitivities to watch

Change-detection efficiency (processing unchanged pages doubles or triples cost overnight —
make page-hash diffing a launch blocker, not an optimization); average pages/night (instrument
from day one); **on-demand sync usage** (up to 3 syncs per 24h, each replacing the nightly
run, bounds worst-case token cost at ~3× the nightly figure — and on-demand runs use the
standard API, not Batch, so they cost 2× per token on top; a user maxing the quota daily
runs ~$8–11/mo on Sonnet, which at $10 is the tail to watch); model price moves
(they've historically moved down — favorable); annual-plan mix (improves cash and churn).
