# dayMarkable on Hostinger: step-by-step setup checklist

This guide takes you from "I own daymarkable.com" to "dayMarkable is running at
https://app.daymarkable.com and reads my tablet every night." It assumes you can use a web
browser, copy and paste, and follow instructions carefully. You do not need to understand
Docker, Linux, or DNS beyond what is explained here.

Plan for about **2 hours** the first time, in four sittings if you like. Each part ends with a
check so you know it worked before moving on.

Tick the boxes as you go.

---

## Part A — What you need before you start (15 minutes)

- [ ] **A1. Your Hostinger account** with `daymarkable.com` registered in it.
- [ ] **A2. A credit card** for the Hostinger VPS (roughly $7–10 per month).
- [ ] **A3. Your Anthropic API key.** Sign in at https://console.anthropic.com → *API Keys* →
      *Create Key*. Copy it somewhere safe. It starts with `sk-ant-`. This is the key that pays
      for reading your handwriting; never paste it anywhere except the server settings below.
- [ ] **A4. A GitHub personal access token** so the server can download the code. The code is
      in a private repository at https://github.com/DiothasSystems/daymarkable.
      1. On GitHub: click your avatar → *Settings* → *Developer settings* → *Personal access
         tokens* → *Fine-grained tokens* → *Generate new token*.
      2. Name: `daymarkable-vps`. Expiration: 90 days is fine. Repository access: *Only select
         repositories* → `DiothasSystems/daymarkable`. Permissions: *Contents: Read-only*.
      3. Generate and copy the token (starts with `github_pat_`). You cannot see it again later.
- [ ] **A5. A Resend account** for the emails dayMarkable sends (sign-in links and meeting
      notes). Sign up free at https://resend.com (3,000 emails per month free).
      1. *Domains* → *Add Domain* → `daymarkable.com`. Resend shows you 3 DNS records
         (DKIM, SPF, DMARC). Leave that page open; you will add them in Part B.
      2. *API Keys* → *Create API Key* → name `daymarkable`, permission *Sending access*. Copy it
         (starts with `re_`).
- [ ] **A6. A text file on your computer** (Notepad is fine) called `daymarkable-secrets.txt`
      where you paste each value as you collect it. Delete it when Part D is done, or keep it in
      a password manager. You will need:

  | Name | Where it comes from |
  |---|---|
  | `ANTHROPIC_API_KEY` | A3 |
  | `GITHUB_TOKEN` | A4 |
  | `EMAIL_API_KEY` | A5 |
  | `POSTGRES_PASSWORD` | you make it up: 24+ random characters, letters and digits only |
  | `DATA_ENCRYPTION_KEY` | generated in Part C (C6) |
  | `ADMIN_LOGIN_ID` | you choose, e.g. `jim` |
  | admin password | you choose: 12+ characters. You will store only its *hash* (C7) |

---

## Part B — Buy the server and point the domain at it (30 minutes)

- [ ] **B1. Buy the VPS.** In Hostinger (hpanel.hostinger.com) → *VPS* → *Add VPS* (or
      hostinger.com/vps). Choose **KVM 2** (2 vCPU, 8 GB RAM). Pick the longest billing period
      you are comfortable with; the plan is what matters, not the term.
- [ ] **B2. Choose the operating system.** During setup Hostinger asks for an OS. Choose
      **"OS with Control Panel / Applications" → Docker → "Ubuntu 24.04 with Docker"** (the
      wording varies slightly; you want Ubuntu + Docker, not plain Ubuntu and not any panel like
      CyberPanel). Location: the data centre nearest you (for the US East coast choose Boston or
      Virginia if offered, otherwise any US location).
- [ ] **B3. Set the root password** when asked. Make it long and store it in your secrets
      file as `ROOT_PASSWORD`. You can also add an SSH key if you already have one; if that
      sentence means nothing to you, skip it. The password is enough.
- [ ] **B4. Wait for the green "Running" status** on the VPS page (2–5 minutes). Write down
      the **IPv4 address** shown there (four numbers with dots, e.g. `185.201.10.42`). Store it
      as `VPS_IP`.
- [ ] **B5. Add the DNS records.** hPanel → *Domains* → `daymarkable.com` → *DNS / Nameservers*
      → *DNS records*. Add:

  | Type | Name | Points to / content | TTL |
  |---|---|---|---|
  | A | `app` | your `VPS_IP` | 300 (or default) |

  Then add the three records Resend showed you in A5 exactly as displayed (they are usually
  one TXT for SPF, one TXT or CNAME for DKIM, one TXT for DMARC). The "Name" Resend shows
  often includes `.daymarkable.com`; in Hostinger you enter only the part before that.
- [ ] **B6. Check DNS.** After 5–10 minutes open https://dnschecker.org, enter
      `app.daymarkable.com`, type A. You should see your `VPS_IP` in most locations. In Resend,
      click *Verify DNS Records* on the domain page; wait until it says *Verified* (can take up
      to an hour, occasionally longer). You can continue with Part C meanwhile.

**Check:** VPS shows Running, `app.daymarkable.com` resolves to the VPS IP.

---

## Part C — Connect to the server and prepare it (30 minutes)

You will type commands into the server. Everything you type is shown as a line in a grey
box. Type it exactly (or paste it) and press Enter. Lines starting with `#` are comments and
do nothing.

- [ ] **C1. Open a terminal to the server.** Easiest: hPanel → *VPS* → your server →
      **Browser terminal** (a black window opens in your browser). Log in as `root` with the
      password from B3. Nothing appears while you type the password; that is normal.

      Alternative from Windows: open *Windows Terminal* or *PowerShell* and type
      `ssh root@VPS_IP` (with your real IP), answer `yes` to the fingerprint question, enter the
      password.
- [ ] **C2. Confirm Docker is there.**

  ```bash
  docker compose version
  ```
  You should see a version number such as `Docker Compose version v2.x`. If you see "command
  not found", the wrong OS image was chosen; rebuild the VPS with the Docker template (hPanel →
  VPS → *Operating system* → change) and return to C1.
- [ ] **C3. Basic protection.** Create a firewall so only web traffic and your terminal reach
      the box:

  ```bash
  apt-get update -y && apt-get install -y ufw git
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  ufw status
  ```
  Expect `Status: active` with three ALLOW lines.
- [ ] **C4. Download the code.** Replace `github_pat_XXXX` with your token from A4:

  ```bash
  cd /root
  git clone https://github_pat_XXXX@github.com/DiothasSystems/daymarkable.git
  cd daymarkable
  ls
  ```
  You should see `docker-compose.yml`, `Dockerfile`, `apps`, `packages`, `docs`.
- [ ] **C5. Create the settings file.** dayMarkable reads all secrets from a file named
      `.env` in this folder. Start from the template:

  ```bash
  cp .env.example .env
  ```
- [ ] **C6. Generate the two random secrets** and write them down in your secrets file:

  ```bash
  echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)"
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  ```
  Copy both lines exactly. The encryption key protects your tablet token and notes on disk.
  **If you ever lose it, the stored data cannot be read again**, so keep it in your password
  manager too.
- [ ] **C7. Create the admin password hash.** dayMarkable never stores the admin password
      itself, only a scrambled version. Choose a password (12+ characters), then run this on
      the server, replacing the text in quotes:

  ```bash
  docker run --rm node:22-slim sh -c "npm -s i bcryptjs@3 >/dev/null 2>&1 && node -e \"require('bcryptjs').hash(process.argv[1],12).then(h=>console.log(h))\" 'YOUR-ADMIN-PASSWORD'"
  ```
  It prints one line starting with `$2b$12$`. Copy the whole line as `ADMIN_PASSWORD_HASH`.
  (The password itself goes only in your password manager.)
- [ ] **C8. Fill in the settings file.** Open it in the simple editor `nano`:

  ```bash
  nano .env
  ```
  Use the arrow keys to move. Set these lines (delete any existing value after the `=` and
  paste yours). Leave lines you do not recognise alone.

  ```
  APP_URL=https://app.daymarkable.com
  APP_DOMAIN=app.daymarkable.com
  ANTHROPIC_API_KEY=sk-ant-...            (A3)
  DATA_ENCRYPTION_KEY=...                 (C6)
  POSTGRES_PASSWORD=...                   (C6)
  EMAIL_API_KEY=re_...                    (A5)
  EMAIL_FROM=dayMarkable <notes@daymarkable.com>
  USER_EMAIL=your.address@example.com     (the email you will sign in with; meeting notes go here)
  USER_TIMEZONE=America/New_York
  ADMIN_LOGIN_ID=jim                      (your choice)
  ADMIN_PASSWORD_HASH=$2b$12$...          (C7, the whole line)
  DATABASE_URL=                           (leave EMPTY on the server; Docker fills it in)
  RENDER_SERVICE_URL=                     (leave EMPTY on the server)
  RMAPI_DEVICE_TOKEN=                     (leave empty; you will pair from the website)
  ```
  Save: press `Ctrl+O`, Enter. Exit: `Ctrl+X`.

  Important: `DATABASE_URL` and `RENDER_SERVICE_URL` must be **empty** on the server. The
  `.env.example` file has local-development values there; blank them out.
- [ ] **C9. Double-check the file** (secrets are shown, so do this only when nobody is looking
      over your shoulder):

  ```bash
  grep -E "^(APP_URL|APP_DOMAIN|USER_EMAIL|ADMIN_LOGIN_ID|DATABASE_URL|RENDER_SERVICE_URL)=" .env
  ```
  `DATABASE_URL=` and `RENDER_SERVICE_URL=` should show nothing after the `=`.

**Check:** `ls /root/daymarkable/.env` exists; `ufw status` is active.

---

## Part D — Build and start dayMarkable (20 minutes, mostly waiting)

- [ ] **D1. Build.** This downloads everything and compiles the app. It takes 5–10 minutes the
      first time and prints a lot; that is normal.

  ```bash
  cd /root/daymarkable
  docker compose build
  ```
  The last lines should not contain the word `ERROR`. If the build stops with an error, copy
  the last 30 lines and send them to whoever is helping you (or to Claude Code).
- [ ] **D2. Start the database, the renderer, and the app.**

  ```bash
  docker compose up -d db render app
  ```
- [ ] **D3. Watch it come up.**

  ```bash
  docker compose logs -f app
  ```
  Within a minute you should see `migrations applied` and then
  `3AM scheduler running inside the web server`, and finally a line with `Ready` and port
  3000. Press `Ctrl+C` to stop watching (the app keeps running).
- [ ] **D4. Turn on HTTPS.** This starts the small web server that gets a free certificate for
      `app.daymarkable.com` automatically. DNS from B6 must be working first.

  ```bash
  docker compose --profile edge up -d caddy
  docker compose logs caddy | tail -20
  ```
  Look for `certificate obtained successfully`. If you see repeated errors mentioning
  `challenge`, DNS is not pointing at the server yet; wait 15 minutes and rerun the second
  line.
- [ ] **D5. Open the site.** In your browser go to **https://app.daymarkable.com**. You should
      see the dayMarkable sign-in page with the emblem and a padlock in the address bar.

**Check:** the sign-in page loads over https. If the browser says "connection refused", run
`docker compose ps` — every service should say `running` or `healthy`.

---

## Part E — Sign in and set up your account (15 minutes)

- [ ] **E1. Request a sign-in link.** Enter the same email you put in `USER_EMAIL`, click
      *Email me a sign-in link*. Check your inbox (and spam folder the first time). Click the
      link within 15 minutes.

      If no email arrives after 5 minutes, Resend's domain is probably not verified yet (B6).
      Workaround for today: on the server run `docker compose logs app | grep "magic link"`
      and paste the printed link into your browser. Emails will flow once Resend shows
      *Verified*.
- [ ] **E2. Pair your tablet.** The setup wizard opens. Step 1 asks for a one-time code:
      1. In another tab, go to https://my.remarkable.com/device/browser/connect and sign in
         with your reMarkable account.
      2. Copy the 8-character code shown.
      3. Paste it into the wizard within a few minutes and click *Pair tablet*. You should see
         "Paired" with your document and folder counts.
- [ ] **E3. Choose what to read.** Step 2 lists your tablet folders. Tick the folders you keep
      notes in, or tick nothing to read every notebook. Click *Save folders*, then *Next*.
- [ ] **E4. Timezone.** Confirm your timezone (runs happen at 03:00 in it). *Save*, *Next*.
- [ ] **E5. Ink conventions.** Leave the defaults (asterisk = action, underline = follow-up,
      "TODO" = action) unless you already mark your notes differently. *Save*, *Next*.
- [ ] **E6. Email preferences.** Keep "one email per decoded meeting" on. *Save*, then
      *Finish setup*.
- [ ] **E7. First sync.** On the *Today* page press **Sync now**. It reads pages written since
      yesterday (so write a test page on the tablet first if you like: a title, a date, a line
      like `* call Steve Tuesday 2pm`). Two or three minutes later the page refreshes.
- [ ] **E8. Look at the tablet.** Sync the reMarkable (it syncs on its own when connected to
      Wi-Fi, or tap the sync icon). A folder **dayMarkable** now contains *Planner*, *Action
      List*, and *Meeting Notes*. Tick a box on the planner: it will be read tonight.

**Check:** *Documents* in the website shows three notebooks; the tablet shows the folder.

---

## Part F — The admin portal (5 minutes)

- [ ] **F1.** Go to **https://app.daymarkable.com/admin**. Sign in with `ADMIN_LOGIN_ID` and the
      admin password you chose in C7 (not the hash).
- [ ] **F2.** You should see *Overview* with 1 customer. *Users* shows your account with daily
      usage and token cost; *Feedback* shows ratings you give on the *Runs* page; *Audit log*
      shows your admin login. Five wrong passwords in a row lock the login for 15 minutes.
- [ ] **F3.** Sign out (top right). Admin sessions expire after an hour anyway.

---

## Part G — After the first night

- [ ] **G1. Next morning**, open https://app.daymarkable.com. *Runs* should show an
      **Automatic** run at about 03:00 with the number of pages read and the cost. The tablet
      folder has fresh notebooks and your inbox has one email per meeting decoded.
- [ ] **G2. Rate the run** (stars on the *Runs* page). Your ratings feed the admin *Feedback*
      screen and guide model tuning.
- [ ] **G3. Delete `daymarkable-secrets.txt`** from your computer once everything is in your
      password manager.

---

## Everyday operations (keep this handy)

All commands start with connecting to the server (C1) and `cd /root/daymarkable`.

| I want to… | Type |
|---|---|
| See if everything is running | `docker compose ps` |
| Read recent app messages | `docker compose logs --tail 100 app` |
| See tonight's scheduler decisions | `docker compose logs app \| grep scheduler \| tail` |
| Restart the app | `docker compose restart app` |
| Update to the latest code | `git pull && docker compose build app && docker compose up -d app` |
| Change a setting in `.env` | `nano .env`, save, then `docker compose up -d app` |
| Back up the database | `docker compose exec -T db pg_dump -U daymarkable daymarkable > backup-$(date +%F).sql` |
| Stop everything | `docker compose down` (data is kept) |
| Start everything | `docker compose up -d && docker compose --profile edge up -d caddy` |

Where things live on the server:

- Code and settings: `/root/daymarkable` (settings in `.env`, never committed to GitHub).
- Database and the 1-day cache: Docker volumes named `daymarkable_pgdata` and
  `daymarkable_dmstate`. They survive restarts and updates. Note pages and generated PDFs are
  purged after one day by design; only tasks, events, and meeting summaries are kept, encrypted.

---

## If something goes wrong

| Symptom | Likely cause | What to do |
|---|---|---|
| `docker compose up` complains `set POSTGRES_PASSWORD in the host environment` | A required line in `.env` is empty | `nano .env`, fill it, rerun |
| Sign-in email never arrives | Resend domain not verified, or `EMAIL_API_KEY` wrong | Check Resend → Domains; meanwhile use the log workaround in E1 |
| Browser shows "Your connection is not private" | Certificate not issued yet | `docker compose logs caddy \| tail`; confirm B5/B6; wait and retry D4 |
| Sync now says "render service not reachable" | Render container stopped | `docker compose up -d render` |
| Pairing says the code expired | Codes last a few minutes | Get a fresh code and paste immediately |
| A run shows *failed* with a tablet error | reMarkable cloud hiccup or token revoked | Re-pair from *Account → Tablet*; the next night retries automatically |
| The app is up but slow after an update | Build still running | Wait for `docker compose build` to finish before `up -d` |
| You lost `DATA_ENCRYPTION_KEY` | — | Stored token and notes are unrecoverable; set a new key, re-pair the tablet, the next run rebuilds the lists from fresh pages |

For anything else: copy the last 40 lines of `docker compose logs app` and share them. The
logs never contain your note content, only counts and identifiers.
