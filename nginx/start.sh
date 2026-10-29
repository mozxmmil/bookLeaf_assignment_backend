#!/bin/sh
# Nginx entrypoint for docker-compose.prod.yml.
# Serves plain HTTP until Certbot has the certificate, then switches to HTTPS on its own.
# Also reloads twice a day so a renewed certificate is picked up.
set -eu
CERT="/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem"

render() {
  # Substitute only ${API_DOMAIN}; nginx's own $variables are left untouched.
  envsubst '${API_DOMAIN}' < "/etc/nginx/bookleaf/$1.conf.template" > /etc/nginx/conf.d/default.conf
  echo "nginx: using $1 config for ${API_DOMAIN}"
}

if [ -f "$CERT" ]; then render https; else render http; fi

(
  set +e
  ticks=0
  while sleep 60; do
    ticks=$((ticks + 1))
    if [ -f "$CERT" ] && ! grep -q 'listen 443' /etc/nginx/conf.d/default.conf; then
      render https && nginx -s reload
    elif [ "$ticks" -ge 720 ]; then
      ticks=0
      nginx -s reload
    fi
  done
) &

exec nginx -g 'daemon off;'
