#!/bin/bash
# LaunchOS Deploy Script for Hetzner
# Usage: ./deploy.sh

set -e

echo "=== LaunchOS Deploy ==="

# Check .env.production exists
if [ ! -f .env.production ]; then
    echo "ERROR: .env.production not found. Copy .env.production.example and fill in your values."
    exit 1
fi

# Build and start
echo "Building Docker image..."
docker compose -f docker-compose.prod.yml build

echo "Starting services..."
docker compose -f docker-compose.prod.yml up -d

# Wait for postgres
echo "Waiting for PostgreSQL..."
sleep 5

# Run setup tables
echo "Running database setup..."
docker compose -f docker-compose.prod.yml exec -T postgres psql -U ${POSTGRES_USER:-crm} -d ${POSTGRES_DB:-crm} < setup-tables.sql

echo ""
echo "=== Deploy Complete ==="
echo ""
echo "App running at: http://$(hostname -I | awk '{print $1}'):80"
echo ""
echo "Next steps:"
echo "  1. Point your domain DNS to this server's IP"
echo "  2. Set up SSL:"
echo "     docker compose -f docker-compose.prod.yml run --rm certbot certonly --webroot -w /var/www/certbot -d yourdomain.com"
echo "  3. Uncomment the HTTPS server block in nginx.conf"
echo "  4. Restart nginx: docker compose -f docker-compose.prod.yml restart nginx"
echo "  5. Set up cron jobs:"
echo "     crontab -e"
echo "     * * * * * curl -s -X POST http://localhost:3000/api/reminders/process -H 'Authorization: Bearer YOUR_SEQUENCE_PROCESS_SECRET'"
echo "     */5 * * * * curl -s -X POST http://localhost:3000/api/sequences/process -H 'Authorization: Bearer YOUR_SEQUENCE_PROCESS_SECRET'"
echo "     */30 * * * * curl -s -X POST http://localhost:3000/api/email-intelligence/cron?secret=YOUR_CRON_SECRET"
echo "     */10 * * * * curl -s -X POST http://localhost:3000/api/automation-rules/run-scheduled -H 'Authorization: Bearer YOUR_SEQUENCE_PROCESS_SECRET'"
echo "  6. Update Google OAuth redirect URI to https://yourdomain.com/api/google/callback"
echo "  7. Update Stripe webhook URL to https://yourdomain.com/api/stripe/webhook"
echo ""
