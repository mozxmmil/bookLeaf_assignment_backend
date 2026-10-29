# Deployment Guide

Recommended setup: **Vercel** (frontend) + **one VPS** with **Nginx** and **Docker** (API + Postgres).

```
Browser ──HTTPS──▶ Vercel (Next.js, frontend repo)
   │
   └──HTTPS──▶ api.yourdomain.com ──▶ Nginx :443 ──▶ 127.0.0.1:4815 ──▶ api (Docker) ──▶ db (Docker)
                                      (on the VPS,     └──────── docker-compose.prod.yml ────────┘
                                       HTTPS by Certbot)
```

| Part | Repo | Runs on | Config |
|---|---|---|---|
| Frontend | [`bookLeaf_assignment_frontend`](https://github.com/mozxmmil/bookLeaf_assignment_frontend) | Vercel | `NEXT_PUBLIC_API_URL` in Vercel's project settings |
| API + Postgres | `bookLeaf_assignment_backend` (this repo) | VPS, in Docker | `.env` in the repo folder on the VPS (copied from `.env.prod.example`) |
| Reverse proxy | this repo, `nginx/bookleaf-api.conf` | VPS, Nginx installed on the server | domain name in the same file |

- The API runs as a long-lived server, not on serverless functions, because it holds SSE connections open.
- Only Nginx (ports 80 and 443) is reachable from the internet. The API is published on `127.0.0.1` only, and Postgres is not published at all.
- **Certbot** gets a free Let's Encrypt certificate, adds the HTTPS settings to the Nginx file, and renews the certificate automatically.
- If the VPS already runs Nginx for other sites, that's fine: this adds one more site file and doesn't change the others.
- Built for a shared VPS: the API uses host port **4815** (not 3000/4000/5000/8000/8080), Postgres publishes no port, and the containers, network and volume are all prefixed `bookleaf-prod`, so nothing clashes with other apps.

## What you need
- A VPS with Ubuntu 22.04/24.04 and at least 1 vCPU and 2 GB RAM. With 1 GB, add swap (step 1) or the image build can run out of memory.
- **A domain or subdomain for the API.** The Vercel site is HTTPS, and browsers block calls from an HTTPS page to a plain `http://<ip>` API (mixed content). Let's Encrypt only issues certificates for hostnames.
  - No domain? Use `sslip.io`: `203-0-113-10.sslip.io` resolves to `203.0.113.10` and works with Let's Encrypt.
- Both repos on GitHub (**private**) and a Vercel account.

## 1. Prepare the VPS (once)
```bash
sudo apt update && sudo apt upgrade -y

# Docker + Compose plugin
curl -fsSL https://get.docker.com | sh

# Nginx + Certbot (skip nginx if it is already installed)
sudo apt install -y nginx certbot python3-certbot-nginx

# Firewall: SSH + web only
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable

# Only on 1 GB machines: 2 GB swap
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
Also open ports 80 and 443 in your cloud provider's firewall if it has one (AWS security group, Oracle security list, and so on).

## 2. Point the domain at the VPS
Add a DNS **A record**: `api.yourdomain.com → <VPS IP>`. If you use Cloudflare, set it to "DNS only" (grey cloud) at first.
Wait until `ping api.yourdomain.com` shows the VPS IP before step 6. Skip this step if you use `sslip.io`.

## 3. Get the code and configure it
The repo is private, so give the server a read-only **deploy key**:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/bookleaf_deploy -N ""
cat ~/.ssh/bookleaf_deploy.pub
```
Copy the printed line into GitHub → this repo → Settings → Deploy keys → Add deploy key. Leave "Allow write access" off.
```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/bookleaf_deploy\n' >> ~/.ssh/config
git clone git@github.com:mozxmmil/bookLeaf_assignment_backend.git
cd bookLeaf_assignment_backend    # every command below runs from here

cp .env.prod.example .env
openssl rand -hex 32    # run twice: one value for POSTGRES_PASSWORD, one for JWT_SECRET
nano .env               # CLIENT_ORIGIN, POSTGRES_PASSWORD, JWT_SECRET, GEMINI_API_KEY (POSTGRES_USER/POSTGRES_DB are pre-filled)
```
- Docker Compose reads `.env` from this folder automatically, and passes it to the API container.
- You don't create the database user by hand. On its first start, the Postgres container creates `POSTGRES_USER` with `POSTGRES_PASSWORD` and the database `POSTGRES_DB`. The API builds its connection string from the same three values, and creates the tables itself (migrations run on start).
- `DATABASE_URL`, `PORT` and `NODE_ENV` are set by `docker-compose.prod.yml` and win over `.env`, so leave them out.
- If you don't have the Vercel URL yet, leave the placeholder in `CLIENT_ORIGIN` and fix it in step 7.

## 4. Start the API and database
First check that port 4815 is free (no output = free). If it's taken, put another free port in `API_PORT` in `.env` and in both `proxy_pass` lines of `nginx/bookleaf-api.conf`.
```bash
sudo ss -tlnp | grep ':4815 '
```
```bash
echo "alias dc='docker compose -f docker-compose.prod.yml'" >> ~/.bashrc && source ~/.bashrc
dc up -d --build        # the first build takes a few minutes
dc ps                   # db and api should become "healthy"; api shows 127.0.0.1:4815->4000/tcp
dc logs api | tail -5   # look for "BookLeaf API on ..." (4000 is the port inside the container)
curl http://127.0.0.1:4815/api/v1/health   # {"status":"ok",...}
```
Migrations run automatically every time the API container starts.

## 5. Seed the data (once)
```bash
dc exec api node dist/db/seed.js
```
> ⚠️ The seed **clears all tables** before loading `data/bookleaf_sample_data.json`. Run it once, never on a live database that has real tickets.

## 6. Nginx site + HTTPS
```bash
sudo cp nginx/bookleaf-api.conf /etc/nginx/sites-available/bookleaf-api
sudo sed -i 's/api.example.com/api.yourdomain.com/' /etc/nginx/sites-available/bookleaf-api   # your domain
sudo ln -s /etc/nginx/sites-available/bookleaf-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

curl http://api.yourdomain.com/api/v1/health    # works over HTTP now

sudo certbot --nginx -d api.yourdomain.com      # asks for an email and the terms once
```
Certbot gets the certificate and edits `/etc/nginx/sites-available/bookleaf-api`:
- it adds `listen 443 ssl` and the certificate paths;
- it redirects HTTP to HTTPS.

Renewal is automatic through a systemd timer. Check it with `sudo certbot renew --dry-run`.

Check `https://api.yourdomain.com/api/v1/health` and `https://api.yourdomain.com/api/docs` in the browser.

What the Nginx file does (`nginx/bookleaf-api.conf`):
- forwards all traffic to the API on `127.0.0.1:4815`, with the usual `X-Forwarded-*` headers (the API trusts one proxy hop);
- turns buffering off for `/api/v1/stream` and keeps it open for up to an hour, so SSE live updates reach the browser at once.

## 7. Frontend on Vercel
| Setting | Value |
|---|---|
| Repository | Import `bookLeaf_assignment_frontend` from GitHub |
| Root directory | leave as is (the repo root is the Next.js app) |
| Framework | Next.js (auto-detected) |
| Env var | `NEXT_PUBLIC_API_URL=https://api.yourdomain.com` |

- `NEXT_PUBLIC_*` values are built into the bundle, so after changing one, **redeploy** on Vercel.
- Then set `CLIENT_ORIGIN` in `.env` to the Vercel production URL exactly, with no trailing slash. Apply it with `dc up -d` (this recreates only the API).
- Preview deployments get different URLs and are blocked by CORS. Test on the production URL, or add more origins, comma-separated.

## 8. Smoke test
1. Log in as `priya.sharma@example.com / author123` and raise a ticket.
2. In another browser or an incognito window, log in as `admin@bookleaf.com / admin123`. The ticket should appear live with a category and priority.
3. Open the ticket. An AI draft should load. Send the reply and check that the author window updates without a refresh.

## Day-to-day
| Task | Command |
|---|---|
| Deploy a new version | `git pull && dc up -d --build` |
| API logs | `dc logs -f api` |
| Nginx logs | `sudo tail -f /var/log/nginx/error.log` (and `access.log`) |
| After editing the Nginx file | `sudo nginx -t && sudo systemctl reload nginx` |
| Backup | `dc exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup-$(date +%F).sql` |
| Restore | `dc exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < backup.sql` |
| Restart the API | `dc restart api` |

`dc down` keeps the data. `dc down -v` **deletes** the database volume.

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| `502 Bad Gateway` | The API isn't running (`dc ps`, `dc logs api`), or `API_PORT` in `.env` doesn't match `proxy_pass` in the Nginx file |
| `dc up` says `set POSTGRES_... in .env` (or `env file .env not found`) | `.env` is missing or incomplete. It must sit next to `docker-compose.prod.yml` and be named exactly `.env`. |
| API logs show `password authentication failed` | `POSTGRES_USER`, `POSTGRES_PASSWORD` or `POSTGRES_DB` was changed after the first start. Postgres only reads them when its volume is empty. Put the old values back, or, if the DB has nothing to keep, run `dc down -v && dc up -d` (**deletes all data**) and seed again. |
| `dc up` says port 4815 is already allocated | Another app on the VPS uses it. Pick a free port (`sudo ss -tlnp` lists used ones), set it as `API_PORT` in `.env`, put the same port in both `proxy_pass` lines, then `dc up -d` and reload Nginx. |
| Certbot fails | DNS doesn't point at the VPS yet, or port 80 is closed in the cloud firewall |
| Your domain shows the default "Welcome to nginx" page | `server_name` in the site file still says `api.example.com`, or the site isn't linked into `sites-enabled` |
| Browser console shows a CORS error | `CLIENT_ORIGIN` doesn't exactly match the Vercel URL |
| Browser shows "mixed content" | `NEXT_PUBLIC_API_URL` uses `http://`, or Vercel wasn't redeployed after you changed it |
| Build killed on a small VPS | Not enough RAM. Add swap (step 1). |
| Live updates stop, polling still works | A proxy is buffering `/api/v1/stream`. The provided Nginx file turns buffering off for that path. If you add Cloudflare's proxy (orange cloud) or another proxy in front, check its settings. |

## Alternative: managed free tiers (no VPS)
**Neon** (Postgres) → **Render** (API) → **Vercel** (web).
1. **Neon:** copy the connection string (`...?sslmode=require`). From this repo, run `npx prisma migrate deploy` and `npm run db:seed` with `DATABASE_URL` set to it.
2. **Render** Web Service:
   - Repository: this repo (root directory left empty).
   - Build `npm ci && npm run build`.
   - Start `npx prisma migrate deploy && npm start`.
   - Env: the same variables as `.env.prod.example`, plus `DATABASE_URL` and `NODE_ENV=production`.
3. **Vercel:** same as step 7, with `NEXT_PUBLIC_API_URL=https://<api>.onrender.com`.

> Render's free plan sleeps when idle, so the first request can take ~30–50 s. Open the API URL before a demo.

## Keep both repos private
Add BookLeaf's email as a collaborator on **both** repos: GitHub → Settings → Collaborators. **Never make either repo public.**
