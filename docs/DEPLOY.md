# Deploying dayMarkable to a Hostinger VPS (Phase 0)

One VPS runs three containers via Docker Compose: `app` (Next.js web app with the 3AM
scheduler inside it), `db` (Postgres 16), and `render` (the Python rmscene service). An
optional `caddy` container terminates HTTPS. Every secret is read from the host environment;
nothing secret is committed.

## 0. Which Hostinger product

dayMarkable needs a real Linux box that runs Docker: **Hostinger VPS (KVM), not Web/Cloud
shared hosting**. Shared and "Cloud" website plans cannot run Docker, a Node server process, a
Python service, or a 3AM scheduler.

| Plan | Fits? | Why |
|---|---|---|
| Web / Business / Cloud hosting | No | PHP-oriented shared hosting; no Docker, no long-running Node processes |
| **KVM 2** (2 vCPU, 8 GB RAM, 100 GB NVMe) | **Yes — recommended for Phase 0–2** | Next.js build + Postgres + the Python render container fit comfortably; headroom for a few hundred users |
| KVM 1 (1 vCPU, 4 GB) | Marginal | `next build` on the box needs ~3 GB; runs but rebuilds are slow |
| KVM 4+ | Later | Only when nightly decode volume or concurrent on-demand syncs demand it |

Choose the **Docker-ready template** ("Ubuntu 24.04 with Docker") when creating the VPS; it
ships Docker Engine + Compose. Pick the data centre closest to you (US East for New York
time). Hostinger's 1-click "Docker Manager" is optional; this runbook uses plain
`docker compose` over SSH, which the Docker Manager can also import.

Domain: `daymarkable.com` is registered. Use the apex for the Phase 2 marketing site and put
the app on **`app.daymarkable.com`**. In Hostinger's DNS zone (hPanel → Domains → DNS):

```
A     app     <VPS IPv4>     TTL 300
AAAA  app     <VPS IPv6>     (optional)
```

Email sending (`EMAIL_FROM`): verify `daymarkable.com` in Resend and add the DKIM/SPF/DMARC
records Resend gives you to the same zone; send from `notes@daymarkable.com`.

## 0b. Alternative host: Hetzner Cloud (cheaper, same runbook)

The compose stack is host-agnostic. Hetzner Cloud is the most cost-effective Docker VPS for
this workload; everything from section 1 onward applies verbatim.

| Plan | Spec | Approx. monthly | Fit |
|---|---|---|---|
| CX22 | 2 vCPU, 4 GB, 40 GB | ~$4.50 | Runs; rebuilds on the box are slow |
| **CX32** | 4 vCPU, 8 GB, 80 GB | ~$7.50 | **Recommended through Phase 2** |
| CAX (Arm) | 2–4 Arm cores | ~$4–7 | Only with multi-arch image builds (see below) |

Console steps (https://console.hetzner.cloud):

1. **Project → Add Server.** Location: Ashburn (`ash`) or Hillsboro (`hil`) for US users.
   Image: **Apps → Docker CE** (Ubuntu with Docker Engine + Compose preinstalled). Type:
   Shared vCPU **x86** CX32. Add your SSH key. Optional: enable backups (20% of the server
   price) for the Postgres volume.
2. **Firewall** (Networking → Firewalls): allow inbound TCP 22 from your IP, TCP 80 and 443
   from anywhere; deny everything else. The app itself only listens on `127.0.0.1:3000`.
3. **DNS**: point `app.daymarkable.com` at the server's IPv4 (and IPv6) in Hostinger's DNS
   zone, or move the zone to Hetzner DNS (free) if you prefer one console.
4. `ssh root@<ip>`, then continue at section 2 (clone), 3 (environment), 4 (start).

Migrating from Hostinger (or any previous box):

```bash
# old box
docker compose exec -T db pg_dump -U daymarkable daymarkable > daymarkable.sql
# new box, after `docker compose up -d db`
docker compose exec -T db psql -U daymarkable daymarkable < daymarkable.sql
```

Copy `DATA_ENCRYPTION_KEY` unchanged: the stored device token, meeting bodies, and cache
files are sealed with it. The 1-day cache does not need to move; the next run rebuilds it.
Switch DNS last, then run `docker compose --profile edge up -d caddy` on the new box for the
certificate.

Arm servers (CAX) or Oracle Cloud Always Free: the images must be built for `linux/arm64`.
Either build on the Arm box itself (`docker compose build` there) or publish multi-arch images
from a laptop with `docker buildx build --platform linux/amd64,linux/arm64`. All dependencies
(PGlite, pdf-lib, pypdfium2, resvg-py, rmscene) ship Arm builds.

Object storage for Phase 2's external cache: Hetzner Object Storage or Cloudflare R2 (no
egress fees) are the low-cost S3-compatible choices.

## 1. Prepare the VPS

Hostinger "VPS" or "Docker" plan, Ubuntu 22.04+ with Docker Engine and the Compose plugin:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version
```

Point your domain (e.g. `app.daymarkable.com`) at the VPS IP before enabling the edge profile.

## 2. Put the code on the box

```bash
git clone <your repo> daymarkable && cd daymarkable
```

## 3. Host environment

Create `/etc/daymarkable.env` (or use Hostinger's environment panel) with these variables.
Compose reads them from the shell environment; the simplest way is `set -a; source
/etc/daymarkable.env; set +a` before every `docker compose` command, or `--env-file`.

| Variable | Required | Notes |
|---|---|---|
| `APP_URL` | yes | `https://app.daymarkable.com` (magic links, email CTA) |
| `APP_DOMAIN` | edge profile | `app.daymarkable.com` for Caddy |
| `POSTGRES_PASSWORD` | yes | any long random string |
| `DATA_ENCRYPTION_KEY` | yes | `openssl rand -base64 32`; losing it makes stored tokens and caches unreadable |
| `ANTHROPIC_API_KEY` | yes | decode |
| `USER_EMAIL` | yes | the one Phase 0 login address; meeting notes go here |
| `USER_TIMEZONE` | no | default `America/New_York` |
| `RMAPI_DEVICE_TOKEN` | first boot only | from `pnpm spike pair`; it is moved into the DB encrypted on first run. You can also pair from `/setup`. |
| `EMAIL_API_KEY`, `EMAIL_FROM` | for real email | Resend key + verified sender |
| `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD_HASH` | for `/admin` | hash via `pnpm admin:hash "<password>"`; never store the plaintext |
| `DECODE_MODEL`, `DECODE_ESCALATION_MODEL`, `DECODE_MODEL_ROTATION`, `DECODE_CONFIDENCE_THRESHOLD` | no | model is config, not a constant |

## 4. Build and start

```bash
set -a; source /etc/daymarkable.env; set +a
docker compose build
docker compose up -d db render app
docker compose logs -f app        # expect: migrations applied, "3AM scheduler running inside the web server"
```

The app listens on `127.0.0.1:3000` only. Add HTTPS:

```bash
docker compose --profile edge up -d caddy
```

## 5. First run

1. Open `https://<APP_DOMAIN>/login`, request a link (it arrives by email when `EMAIL_API_KEY`
   is set; otherwise read it from `docker compose logs app`).
2. Complete `/setup` (pairing, folders, timezone, conventions, email).
3. Press **Sync now** once to seed the tablet; the scheduler takes over at 03:00 local.

## 6. Operations

- Logs carry counts and hashes, never note content: `docker compose logs app`.
- The 1-day cache lives in the `dmstate` volume under `/data/cache/<runId>`; the run's final
  step purges the previous run and a 48h sweep is the failsafe.
- Upgrade: `git pull && docker compose build app && docker compose up -d app`. Migrations run
  on start.
- Backups: `docker compose exec db pg_dump -U daymarkable daymarkable > backup.sql` (contains
  only the encrypted working set, never pages).
- Admin portal: `https://<APP_DOMAIN>/admin` (separate login, 60-minute sessions, every action
  in `admin_audit`).

## 7. Proving the 3AM cron on the host

`docker compose logs app | grep scheduler` shows a tick every 15 minutes with the decision and
reason; the first line after 03:00 local reads `run <id> started: nightly for <date>`.
