# Deploying dayMarkable to a Hostinger VPS (Phase 0)

One VPS runs three containers via Docker Compose: `app` (Next.js web app with the 3AM
scheduler inside it), `db` (Postgres 16), and `render` (the Python rmscene service). An
optional `caddy` container terminates HTTPS. Every secret is read from the host environment;
nothing secret is committed.

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
| `APP_URL` | yes | `https://app.daymarkable.com` (used in magic links and emails) |
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
