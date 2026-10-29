# Deployment Guide

Recommended setup: **Vercel** (web) + **one VPS running Docker** (API + Postgres + Nginx + Certbot).

```
Browser ──HTTPS──▶ Vercel (Next.js, frontend repo)
   │
   └──HTTPS──▶ api.yourdomain.com ──▶ Nginx :443 ──▶ api:4000 ──▶ db:5432
                                       ▲ certificate from Certbot (Let's Encrypt)
                                       └──── VPS (docker-compose.prod.yml, this repo) ───┘
```

| Part | Repo | Deployed to | Config |
|---|---|---|---|
| Frontend | [`bookLeaf_assignment_frontend`](https://github.com/mozxmmil/bookLeaf_assignment_frontend) | Vercel | `NEXT_PUBLIC_API_URL` in Vercel's project settings |
| Backend | `bookLeaf_assignment_backend` (this repo) | VPS (Docker) | `.env.prod` (copied from `.env.prod.example`) |

The API runs as a long-lived server, not on serverless functions, because it holds SSE connections open.
Only Nginx (ports 80 and 443) is reachable from the internet. The API and Postgres have no published ports.

### How HTTPS is set up
Nginx has no built-in certificate support, so a **Certbot** container handles it. Nothing needs to be done by hand:
1. On first start there is no certificate yet, so Nginx serves plain HTTP (`nginx/http.conf.template`).
2. Certbot asks Let's Encrypt for a certificate. Let's Encrypt checks the domain by fetching a file from `http://<domain>/.well-known/acme-challenge/`, which Nginx serves from a volume shared with Certbot.
3. Within a minute of the certificate arriving, Nginx switches to HTTPS (`nginx/https.conf.template`) and redirects HTTP to HTTPS (`nginx/start.sh`).
4. Certbot checks for renewal twice a day, and Nginx reloads twice a day to pick up the renewed certificate.

The proxy rules are in `nginx/locations.conf`:
- Buffering is turned off for `/api/v1/stream`, so SSE events reach the browser at once.
- Docker's DNS is used to find the `api` container on every request, so a rebuilt API container is found without restarting Nginx.

## What you need
- A VPS with Ubuntu 22.04/24.04 and at least 1 vCPU and 2 GB RAM. With 1 GB, add swap (step 1) or the image build can run out of memory.
- **A domain or subdomain for the API.** The Vercel site is HTTPS, and browsers block calls from an HTTPS page to a plain `http://<ip>:4000` API (mixed content). Certbot gets a free Let's Encrypt certificate, but only for a hostname.
  - No domain? Use `sslip.io`: `203-0-113-10.sslip.io` resolves to `203.0.113.10`, so Certbot can get a certificate for it.
- The repo on GitHub (**private**) and a Vercel account.

## 1. Prepare the VPS (once)
```bash
# Docker + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER        # log out and back in after this

# Firewall: SSH + web only
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable

# Only on 1 GB machines: 2 GB swap
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
Also open ports 80 and 443 in your cloud provider's firewall if it has one (AWS security group, Oracle security list, and so on).

## 2. Point the domain at the VPS
Add a DNS **A record**: `api.yourdomain.com → <VPS IP>`. If you use Cloudflare, set it to "DNS only" (grey cloud) at first so Certbot can get its certificate.
Wait until `ping api.yourdomain.com` shows the VPS IP before step 4.
Skip this step if you use `sslip.io`.

## 3. Get the code and configure it
```bash
git clone https://github.com/mozxmmil/bookLeaf_assignment_backend.git   # private repo: use a deploy key or a fine-grained token
cd bookLeaf_assignment_backend    # every command below runs from here
cp .env.prod.example .env.prod
openssl rand -hex 32    # run twice: one value for POSTGRES_PASSWORD, one for JWT_SECRET
nano .env.prod          # API_DOMAIN, CERTBOT_EMAIL, CLIENT_ORIGIN, POSTGRES_PASSWORD, JWT_SECRET, GEMINI_API_KEY
```
If you don't have the Vercel URL yet, put a placeholder in `CLIENT_ORIGIN` and fix it in step 6.

## 4. Start the stack
```bash
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.prod'   # add to ~/.bashrc
dc up -d --build
dc ps                   # db and api should become "healthy"
dc logs -f api          # look for "All migrations have been successfully applied" and "BookLeaf API on ..."
dc logs certbot         # look for "Successfully received certificate"
dc logs nginx | grep using   # "using https config" appears within a minute of the certificate
```
Migrations run automatically every time the API container starts.

## 5. Seed the data (once)
```bash
dc exec api node dist/db/seed.js
```
> ⚠️ The seed **clears all tables** before loading `data/bookleaf_sample_data.json`. Run it once, never on a live database that has real tickets.

Check `https://api.yourdomain.com/api/v1/health` and `https://api.yourdomain.com/api/docs`.

## 6. Web on Vercel
| Setting | Value |
|---|---|
| Repository | Import `bookLeaf_assignment_frontend` from GitHub |
| Root directory | leave as is (the repo root is the Next.js app) |
| Framework | Next.js (auto-detected) |
| Env var | `NEXT_PUBLIC_API_URL=https://api.yourdomain.com` |

- `NEXT_PUBLIC_*` values are built into the bundle, so after changing one, **redeploy** on Vercel.
- Then set `CLIENT_ORIGIN` in `.env.prod` to the Vercel production URL exactly, with no trailing slash. Apply it with `dc up -d` (this recreates only the API).
- Preview deployments get different URLs and are blocked by CORS. Test on the production URL, or add more origins, comma-separated.

## 7. Smoke test
1. Log in as `priya.sharma@example.com / author123` and raise a ticket.
2. In another browser or an incognito window, log in as `admin@bookleaf.com / admin123`. The ticket should appear live with a category and priority.
3. Open the ticket. An AI draft should load. Send the reply and check that the author window updates without a refresh.

## Day-to-day
| Task | Command |
|---|---|
| Deploy a new version | `git pull && dc up -d --build` |
| Logs | `dc logs -f api` · `dc logs nginx` · `dc logs certbot` |
| Check the Nginx config | `dc exec nginx nginx -t` |
| Backup | `dc exec -T db pg_dump -U bookleaf bookleaf > backup-$(date +%F).sql` |
| Restore | `dc exec -T db psql -U bookleaf bookleaf < backup.sql` |
| Restart the API | `dc restart api` |

`dc down` keeps the data. `dc down -v` **deletes** the database volume.

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| `dc logs certbot` shows "request failed" | DNS doesn't point at the VPS yet, or port 80 is closed in the cloud firewall. Certbot retries every 30 min. After fixing it, run `dc restart certbot` to retry now. |
| Site still on plain HTTP | No certificate yet. Check `dc logs certbot`. |
| `502 Bad Gateway` | The API isn't running or healthy. Check `dc ps` and `dc logs api`. |
| Browser console shows a CORS error | `CLIENT_ORIGIN` doesn't exactly match the Vercel URL |
| Browser shows "mixed content" | `NEXT_PUBLIC_API_URL` uses `http://`, or Vercel wasn't redeployed after you changed it |
| Build killed on a small VPS | Not enough RAM. Add swap (step 1). |
| Live updates stop, polling still works | A proxy is buffering `/api/v1/stream`. The provided `nginx/locations.conf` already turns buffering off for that path. If you add Cloudflare's proxy (orange cloud) or another proxy in front, check its settings. |

## Alternative: managed free tiers (no VPS)
**Neon** (Postgres) → **Render** (API) → **Vercel** (web).
1. **Neon:** copy the connection string (`...?sslmode=require`). From this repo, run `npx prisma migrate deploy` and `npm run db:seed` with `DATABASE_URL` set to it.
2. **Render** Web Service:
   - Repository: this repo (root directory left empty).
   - Build `npm ci && npm run build`.
   - Start `npx prisma migrate deploy && npm start`.
   - Env: the same variables as `.env.prod.example`, plus `DATABASE_URL` and `NODE_ENV=production`.
3. **Vercel:** same as step 6, with `NEXT_PUBLIC_API_URL=https://<api>.onrender.com`.

> Render's free plan sleeps when idle, so the first request can take ~30–50 s. Open the API URL before a demo.

## Keep both repos private
Add BookLeaf's email as a collaborator on **both** repos: GitHub → Settings → Collaborators. **Never make either repo public.**
