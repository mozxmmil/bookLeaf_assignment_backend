#!/bin/sh
# Certbot loop for docker-compose.prod.yml.
# Gets the first certificate for API_DOMAIN through the HTTP challenge that nginx serves from /var/www/certbot,
# then checks twice a day for renewal (certificates last 90 days and renew in the last 30).
set -u
CERT="/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem"
trap exit TERM

until [ -f "$CERT" ]; do
  certbot certonly --webroot -w /var/www/certbot -d "$API_DOMAIN" \
    --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email --non-interactive && break
  # Let's Encrypt allows only a few failed validations per hour, so don't retry quickly.
  echo "certbot: request failed. Check that the DNS A record points here and port 80 is open. Retrying in 30 min."
  sleep 1800 & wait $!
done

while :; do
  certbot renew --quiet
  sleep 43200 & wait $!
done
