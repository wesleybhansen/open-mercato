# CRM Platform — Detailed Build Plan

> Based on exploration and validation completed 2026-03-24.
> Foundation: Open Mercato (MIT, forked). Deployed on Hetzner VPS alongside LaunchBot.

---

## Phase 1: Foundation (Weeks 1-3)

**Goal:** Forked Open Mercato running on Hetzner, stripped to CRM essentials, with Twenty-inspired UI and self-service signup.

---

### 1.1 Fork & Initial Setup (Days 1-2)

**Tasks:**
- [ ] Fork `open-mercato/open-mercato` to your GitHub account
- [ ] Clone fork locally
- [ ] Set upstream remote: `git remote add upstream https://github.com/open-mercato/open-mercato.git`
- [ ] Install Node 24 via nvm: `nvm install 24`
- [ ] Copy `.env.example`, configure `DATABASE_URL` + `JWT_SECRET`
- [ ] Run `yarn install && yarn dev:greenfield`
- [ ] Verify the app runs at `localhost:3000`
- [ ] Log in to admin, click through customers module (people, companies, deals, pipeline)
- [ ] Create a test tenant/org, verify data isolation

**Validation:** You can log in, create a contact, create a deal, move it through pipeline stages.

---

### 1.2 Strip Unnecessary Modules (Day 3)

**Edit `apps/mercato/src/modules.ts` — disable modules you don't need:**

**Keep (CRM essentials):**
- `auth`, `directory`, `staff` — auth & user management
- `customers` — contacts, companies, deals, pipelines
- `customer_accounts`, `portal` — self-service signup & user portal
- `onboarding` — first-run setup
- `dashboards` — configurable dashboards
- `notifications` — real-time alerts
- `messages` — internal messaging
- `workflows` — automation engine
- `entities` — custom fields system
- `configs`, `dictionaries`, `currencies` — system config
- `query_index`, `audit_logs`, `attachments` — infrastructure
- `events`, `search`, `scheduler`, `progress` — background processing
- `api_keys` — for LaunchBot/Blog-Ops integration
- `payment_gateways`, `gateway_stripe` — billing
- `feature_toggles` — per-tenant feature control
- `api_docs` — API documentation

**Disable (not needed for CRM):**
- `catalog` — product catalog (e-commerce)
- `sales` — full quote-to-invoice lifecycle (too complex, we'll build simpler invoicing later)
- `shipping_carriers` — shipping management
- `sync_akeneo` — PIM integration
- `data_sync` — external data sync
- `inbox_ops` — AI email ingestion (may re-enable later)
- `integrations` — marketplace registry
- `content` — static content pages
- `resources` — resource management
- `planner` — planning module
- `perspectives` — data perspectives
- `translations` — i18n management (keep i18n in UI, remove admin module)
- `business_rules` — business rules engine (workflows covers this)
- `ai_assistant` — built-in AI (we use LaunchBot instead)
- `example` — example module

**After editing:** Run `yarn generate && yarn db:migrate` to verify nothing breaks.

**Validation:** App runs with only CRM-relevant modules. Sidebar is clean and focused.

---

### 1.3 Deploy to Hetzner (Days 4-5)

**On your Hetzner VPS (alongside LaunchBot):**

- [ ] Install Node 24, PostgreSQL 17 + pgvector, Redis 7
- [ ] Or use Docker for all services (recommended for consistency with LaunchBot)
- [ ] Create docker-compose for CRM:

```yaml
# docker-compose.crm.yml
services:
  crm-app:
    build: .
    container_name: crm-app
    ports:
      - "3100:3000"
    environment:
      - DATABASE_URL=postgres://crm:password@crm-postgres:5432/crm
      - REDIS_URL=redis://crm-redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - AUTO_SPAWN_WORKERS=true
      - AUTO_SPAWN_SCHEDULER=true
      - CACHE_STRATEGY=redis
      - CACHE_REDIS_URL=redis://crm-redis:6379
      - SELF_SERVICE_ONBOARDING_ENABLED=true
    depends_on:
      - crm-postgres
      - crm-redis
    restart: unless-stopped
    mem_limit: 2g

  crm-postgres:
    image: pgvector/pgvector:pg17-trixie
    container_name: crm-postgres
    environment:
      - POSTGRES_USER=crm
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=crm
    volumes:
      - crm-pgdata:/var/lib/postgresql/data
    restart: unless-stopped
    mem_limit: 1g

  crm-redis:
    image: redis:7-alpine
    container_name: crm-redis
    restart: unless-stopped
    mem_limit: 256m

volumes:
  crm-pgdata:
```

- [ ] Set up Nginx/Caddy reverse proxy:
  - `crm.yourdomain.com` → `localhost:3100`
  - SSL via Let's Encrypt / Cloudflare
- [ ] Initialize the database: `docker exec crm-app yarn initialize`
- [ ] Verify the app runs at `crm.yourdomain.com`

**Validation:** CRM accessible via HTTPS on your domain. Can create accounts, contacts, deals from browser.

---

### 1.4 Self-Service Signup & Onboarding (Days 6-8)

**Open Mercato's `customer_accounts` module has signup built in. Customize it:**

- [ ] Enable `SELF_SERVICE_ONBOARDING_ENABLED=true` in `.env`
- [ ] Test the signup flow: visit portal → sign up → verify email → land on dashboard
- [ ] Customize the signup page (overlay the frontend page with your branding)
- [ ] Customize the portal dashboard (remove irrelevant widgets, add CRM-focused ones)
- [ ] Configure default role permissions for new signups (what features they can access)
- [ ] Set up the tenant provisioning flow:
  - New signup → auto-create tenant + org
  - Seed default pipeline stages (Lead → Contacted → Qualified → Proposal → Won/Lost)
  - Seed default dictionary values (lead sources, statuses, activity types)
- [ ] Configure Resend for verification emails (set `RESEND_API_KEY`, `EMAIL_FROM`)

**Files to modify/create:**
- Overlay: `apps/mercato/src/modules/customer_accounts/frontend/signup.tsx` — custom signup page
- Overlay: `apps/mercato/src/modules/portal/frontend/dashboard.tsx` — custom portal home
- Modify: `apps/mercato/src/modules/customer_accounts/setup.ts` — default role features

**Validation:** A new user can sign up, verify email, log in, and see a clean CRM dashboard with an empty contacts list and pipeline.

---

### 1.5 Twenty-Inspired UI Overhaul (Days 9-15)

**Use Open Mercato's overlay system to restyle without touching core.**

#### Layout & Navigation
- [ ] Override the main layout to add more whitespace, Inter font, cleaner typography
- [ ] Simplify the sidebar — only show: Dashboard, Contacts, Companies, Deals, Landing Pages (future), Email (future)
- [ ] Add a side panel component — clicking a contact/deal row opens detail alongside the list (not full-page navigation)

**Files to create (overlays):**
- `apps/mercato/src/modules/portal/backend/layout.tsx` — main layout override
- `apps/mercato/src/components/side-panel.tsx` — reusable side panel component
- `apps/mercato/src/styles/globals.css` — Inter font, spacing overrides, Tailwind customizations

#### Contact & Deal Pages
- [ ] Override the people list page — cleaner data table with inline hover actions
- [ ] Override the people detail page — Notion-like layout with activity timeline, side panel compatible
- [ ] Override the deals pipeline page — cleaner Kanban cards with deal value, contact name, stage time
- [ ] Add keyboard shortcuts (Cmd+K for command palette is likely already there via Open Mercato)

**Files to create (overlays):**
- `apps/mercato/src/modules/customers/backend/people/page.tsx`
- `apps/mercato/src/modules/customers/backend/people/[id]/page.tsx`
- `apps/mercato/src/modules/customers/backend/deals/pipeline/page.tsx`

#### Dashboard
- [ ] Override the dashboard to show: new leads this week, pipeline value, upcoming follow-ups, recent activity
- [ ] Clean card-based design with Tremor charts (Open Mercato already uses similar charting)

**Design reference:** Study Twenty's demo at https://demo.twenty.com. Focus on spacing, typography, the way records open in a side panel, and the overall feeling of cleanliness. Implement with shadcn/ui + Tailwind.

**Validation:** The CRM looks and feels modern, clean, and simple. Non-technical users aren't overwhelmed.

---

## Phase 2: Essential Features (Weeks 4-9)

**Goal:** Landing pages, email, integration APIs, and billing. This is the MVP.

---

### 2.1 Landing Pages Module (Weeks 4-5)

**Create new module: `src/modules/landing_pages/`**

#### Data Model
```
landing_pages
  - id (UUID)
  - tenant_id, organization_id
  - title (text)
  - slug (text, unique per org)
  - template_id (text — references template folder name e.g. "lead-magnet-bold")
  - template_category (text — "lead-magnet", "booking", "services", etc.)
  - status (draft | published | archived)
  - config (JSONB — template variables: headline, subheadline, CTA text, colors, logo URL, form fields, etc.)
  - custom_domain (text, nullable)
  - published_html (text — rendered final HTML, cached)
  - created_at, updated_at, deleted_at

landing_page_forms
  - id (UUID)
  - landing_page_id (FK)
  - fields (JSONB — array of {name, type, label, required, placeholder})
  - redirect_url (text, nullable)
  - notification_email (text, nullable)
  - created_at

form_submissions
  - id (UUID)
  - tenant_id, organization_id
  - form_id (FK)
  - landing_page_id (FK)
  - data (JSONB — submitted field values)
  - contact_id (FK to customers, nullable — set after auto-creation)
  - source_ip (text)
  - user_agent (text)
  - created_at
```

#### Template Engine
- [ ] Copy templates from `~/Desktop/High level Templates/` into `apps/mercato/public/templates/` or a dedicated storage location
- [ ] Build a template registry: scan template folders, categorize by name prefix (lead-magnet-*, booking-*, etc.)
- [ ] Build a template renderer:
  1. Read template HTML
  2. Parse `:root` CSS variables
  3. Replace with user's configured values (colors, fonts, radius)
  4. Replace text content placeholders (headline, subheadline, CTA, nav logo, etc.) using data attributes or comment markers
  5. Inject/modify form fields based on landing_page_forms config
  6. Inject form submission handler (POST to CRM API)
  7. Cache rendered HTML in `published_html` column

#### UI Pages (Backend)
- [ ] Landing page list — grid/card view showing template thumbnails, status badges
- [ ] Template picker — browse by category, preview on click
- [ ] Page editor — form-based (NOT drag-and-drop):
  - Template preview (live updates as user types)
  - Content fields: business name, headline, subheadline, body text, CTA text
  - Design fields: primary color, accent color, background color (injected as CSS vars)
  - Form config: add/remove/reorder fields, set required, choose field types
  - Logo upload (via attachments module)
- [ ] Published page preview
- [ ] Analytics: views, form submissions, conversion rate (simple counters)

#### Public Page Serving
- [ ] API route: `GET /api/pages/:slug` — serves rendered HTML
- [ ] Or: Nginx location block serving from the app
- [ ] Form submission endpoint: `POST /api/pages/:slug/submit`
  - Validate fields
  - Create form_submission record
  - Auto-create contact in customers module (emit `landing_pages.form.submitted` event)
  - Send notification to page owner
  - Return redirect URL or success message

#### Domain Routing (MVP: subdirectory or subdomain)
- [ ] MVP: Pages served at `crm.yourdomain.com/p/:slug`
- [ ] Later: Custom subdomains via Nginx wildcard + Cloudflare API

**Widget injection:**
- Inject "Landing Pages" into sidebar navigation
- Inject "Lead Source" badge on contact detail (shows which landing page they came from)
- Dashboard widget: "Landing Page Performance" (views, submissions, conversion rate)

---

### 2.2 Email Module (Weeks 5-7)

**Create new module: `src/modules/email/`**

#### Data Model
```
email_accounts
  - id (UUID)
  - tenant_id, organization_id
  - email_address (text)
  - display_name (text)
  - provider (resend | smtp)
  - config (JSONB, encrypted — SMTP host/port/credentials if applicable)
  - is_default (boolean)
  - sending_domain (text — for deliverability tracking)
  - created_at, updated_at

email_messages
  - id (UUID)
  - tenant_id, organization_id
  - account_id (FK)
  - direction (inbound | outbound)
  - from_address, to_address, cc, bcc (text)
  - subject (text)
  - body_html (text)
  - body_text (text)
  - thread_id (text, nullable — for conversation threading)
  - contact_id (FK to customers, nullable)
  - deal_id (FK to customer_deals, nullable)
  - status (draft | queued | sent | delivered | opened | clicked | bounced | failed)
  - opened_at, clicked_at, bounced_at (timestamps)
  - tracking_id (UUID — for open/click pixel)
  - metadata (JSONB — Resend message ID, delivery info)
  - created_at, sent_at

email_templates
  - id (UUID)
  - tenant_id, organization_id
  - name (text)
  - subject (text — supports {{variables}})
  - body_html (text — supports {{variables}})
  - category (transactional | marketing | sequence)
  - created_at, updated_at

email_campaigns
  - id (UUID)
  - tenant_id, organization_id
  - name (text)
  - template_id (FK)
  - status (draft | scheduled | sending | sent | cancelled)
  - segment_filter (JSONB — tag filter, custom field filter, etc.)
  - scheduled_at (timestamp, nullable)
  - stats (JSONB — {total, sent, delivered, opened, clicked, bounced})
  - created_at, sent_at

email_campaign_recipients
  - id (UUID)
  - campaign_id (FK)
  - contact_id (FK)
  - status (pending | sent | delivered | opened | clicked | bounced | unsubscribed)
  - sent_at, opened_at, clicked_at
```

#### Email Sending (Resend Integration)
- [ ] Service: `ResendEmailService` — wraps Resend API
  - `sendEmail(to, subject, html, trackingId)` — sends with open/click tracking
  - `sendBulk(recipients[])` — batch sending for campaigns
- [ ] Open tracking: inject 1x1 pixel `<img src="/api/email/track/open/:trackingId">`
- [ ] Click tracking: wrap links with `/api/email/track/click/:trackingId?url=...`
- [ ] Tracking endpoints:
  - `GET /api/email/track/open/:id` — record open, return 1x1 gif
  - `GET /api/email/track/click/:id` — record click, redirect to original URL
- [ ] Webhook endpoint: `POST /api/email/webhook/resend` — handle delivery/bounce/complaint events from Resend

#### Email Receiving (Webhook-based, MVP)
- [ ] Resend inbound webhook: `POST /api/email/inbound`
  - Parse incoming email
  - Match sender to contact by email address
  - Create `email_messages` record with `direction: 'inbound'`
  - Link to contact
  - Emit `email.received` event
- [ ] Per-tenant inbound address: `inbox-{orgSlug}@mail.yourdomain.com` (configure Resend inbound routing)

#### Email Composition UI
- [ ] Compose modal — accessible from contact detail ("Send Email" button), deal detail, or standalone
- [ ] Rich text editor (TipTap or similar — lightweight, React-based)
- [ ] Template picker — insert template, auto-fill {{contact.firstName}}, {{contact.company}}, etc.
- [ ] Email thread view — show conversation history per contact

#### Email Campaign UI
- [ ] Campaign list page — name, status, stats (open rate, click rate)
- [ ] Campaign builder:
  1. Name the campaign
  2. Pick or create a template
  3. Select recipients (by tag, by custom field filter, by segment)
  4. Preview with sample contact data
  5. Schedule or send immediately
- [ ] Campaign detail — per-recipient delivery status, aggregate stats

#### Deliverability Setup
- [ ] Documentation/guide for shared sending domain setup (SPF, DKIM, DMARC records)
- [ ] Domain verification via Resend API
- [ ] Unsubscribe handling:
  - One-click unsubscribe link in every marketing email (CAN-SPAM compliance)
  - `POST /api/email/unsubscribe/:contactId` — sets `emailOptOut` flag on contact
  - Campaigns skip contacts with opt-out

#### Widget Injections
- Inject "Email" tab on contact detail page (show email timeline)
- Inject "Send Email" button in contact row actions
- Inject email stats widget on dashboard
- Inject "Last Emailed" column option on contacts table

---

### 2.3 Integration APIs Module (Week 8)

**Create new module: `src/modules/integrations_api/`**

This module exposes REST API endpoints that Blog-Ops and LaunchBot call. It's the CRM's external API surface.

#### API Endpoints for LaunchBot
```
GET  /api/ext/contacts          — list contacts (filtered, paginated)
GET  /api/ext/contacts/:id      — contact detail with activity timeline
POST /api/ext/contacts          — create contact
PUT  /api/ext/contacts/:id      — update contact

GET  /api/ext/deals             — list deals (filtered by stage, owner, etc.)
GET  /api/ext/deals/:id         — deal detail
PUT  /api/ext/deals/:id         — update deal (move stage, update value)

GET  /api/ext/pipeline/summary  — pipeline overview (count + value per stage)

POST /api/ext/activities        — log an activity on a contact or deal
POST /api/ext/emails/send       — trigger an email send

GET  /api/ext/landing-pages     — list landing pages with stats
GET  /api/ext/dashboard/summary — KPI summary (leads, deals, revenue, emails)
```

#### API Endpoints for Blog-Ops
```
POST /api/ext/contacts/sync     — bulk upsert contacts (from Blog-Ops audience profiles)
POST /api/ext/emails/enqueue    — enqueue email sequence (Blog-Ops provides content, CRM sends)
  Body: { contactId, sequence: [{ delayMinutes, subject, bodyHtml }] }
GET  /api/ext/contacts/segments — get contact segments/tags for targeting
POST /api/ext/webhooks/register — Blog-Ops registers webhook URLs for events it wants
```

#### Authentication
- [ ] API key-based auth (use Open Mercato's `api_keys` module)
- [ ] Each tenant generates API keys in CRM settings
- [ ] Keys scoped to the tenant — all queries auto-filtered
- [ ] Rate limiting per key

#### Webhook Outbound
- [ ] Webhook registry: tenants register URLs for events they want
- [ ] Events available: `contact.created`, `contact.updated`, `deal.stage_changed`, `deal.won`, `deal.lost`, `form.submitted`, `email.sent`, `email.opened`
- [ ] Worker sends webhooks asynchronously with retry (3 attempts, exponential backoff)

---

### 2.4 Credit-Based Billing Module (Week 9)

**Create new module: `src/modules/billing/`**

#### Data Model
```
credit_balances
  - id (UUID)
  - tenant_id, organization_id
  - balance (numeric 10,4 — in dollars, e.g. 25.0000)
  - updated_at

credit_transactions
  - id (UUID)
  - tenant_id, organization_id
  - amount (numeric 10,4 — positive for credits added, negative for usage)
  - type (purchase | usage | adjustment | refund)
  - description (text — "Email sent to john@example.com", "Purchased 100 credits")
  - service (email | sms | phone | ai | null)
  - reference_id (text, nullable — Stripe payment ID, email message ID, etc.)
  - created_at

credit_packages
  - id (UUID)
  - name (text — "Starter Pack", "Growth Pack")
  - amount (numeric 10,4 — dollar value of credits)
  - price (numeric 10,2 — what user pays in Stripe)
  - stripe_price_id (text)
  - is_active (boolean)
  - created_at
```

#### Stripe Integration
- [ ] Extend Open Mercato's `gateway_stripe` module
- [ ] Checkout endpoint: `POST /api/billing/purchase` — creates Stripe Checkout session for credit package
- [ ] Webhook: `POST /api/billing/webhook/stripe` — on `checkout.session.completed`, add credits to balance
- [ ] Settings page: current balance, transaction history, buy credits button

#### Usage Metering
- [ ] Event subscribers that deduct credits:
  - `email.sent` → deduct $0.005
  - `sms.sent` (future) → deduct $0.02
  - `ai.interaction` (future) → deduct $0.05
- [ ] Pre-send check: if balance < cost, block the action and show "Add credits" prompt
- [ ] Low balance notification: when balance drops below $2.00, send notification

#### Settings UI
- [ ] Billing page in user portal:
  - Current credit balance (prominent display)
  - "Add Credits" button → credit package selector → Stripe checkout
  - Transaction history table (date, description, amount, balance after)
  - Usage breakdown chart (emails sent this month, cost by category)

---

## Phase 2 Complete — MVP Checkpoint

**At this point, a program member can:**
1. Sign up for the CRM (self-service)
2. Add and manage contacts and companies
3. Track deals through a visual pipeline
4. Create and publish a landing page using a template
5. Capture leads via landing page forms (auto-creates contacts)
6. Send and receive emails
7. Run email campaigns to contact segments
8. Connect their LaunchBot agent via API key
9. Connect Blog-Ops for email sequence delivery
10. Purchase credits and pay for usage

**This is the point where you beta test with 5-10 program members.**

---

## Phase 3: Nice-to-Haves, Tier 1 (Weeks 10-16)

### 3.1 SMS Module (Week 10)

**Create new module: `src/modules/sms/`**

- [ ] Twilio integration service (send/receive SMS)
- [ ] Entities: `sms_messages` (direction, from, to, body, status, contact_id, cost)
- [ ] Inbound webhook: `POST /api/sms/webhook/twilio`
- [ ] Auto-match sender phone to contact
- [ ] Compose UI: "Send SMS" from contact detail page
- [ ] Widget injection: SMS tab on contact detail, SMS history in activity timeline
- [ ] Billing integration: deduct credits per SMS
- [ ] Workflow action: "Send SMS" step in workflows

### 3.2 Pipeline Enhancements (Week 11)

**Extend the existing `customers` module via overlays + event subscribers:**

- [ ] Stage-based automations via workflow triggers:
  - Deal enters "Won" → send celebration email, notify team
  - Deal enters "Lost" → send feedback request
  - Deal stuck in stage > X days → send follow-up reminder
- [ ] Conversion tracking dashboard widget:
  - Leads → Contacted → Qualified → Won conversion rates
  - Average time in each stage
  - Revenue forecast based on pipeline value × probability
- [ ] Deal value reporting: total pipeline, weighted pipeline, won this month/quarter

### 3.3 Invoicing (Weeks 12-13)

**Create new module: `src/modules/invoicing/` (simpler than Open Mercato's full sales module)**

- [ ] Entities: `invoices` (number, contact_id, deal_id, line_items JSONB, total, status, due_date, stripe_payment_link)
- [ ] Create invoice from deal (pre-fills contact and amount)
- [ ] Generate Stripe payment link per invoice
- [ ] Send invoice via email (template with payment link)
- [ ] Track payment status via Stripe webhook
- [ ] Invoice list page with status filters (draft, sent, paid, overdue)
- [ ] Dashboard widget: revenue this month, outstanding invoices

### 3.4 AI Features (Weeks 14-16)

**Create new module: `src/modules/ai_features/`**

- [ ] Email writer: select contact → "Draft email" → AI generates personalized email based on contact context, recent activity, deal stage
- [ ] Lead scoring: nightly job analyzes contact engagement (emails opened, pages visited, forms filled) → assigns score 1-100
- [ ] Smart contact enrichment: given email or company domain, AI researches and fills in missing fields (job title, company size, LinkedIn)
- [ ] All AI calls go through the billing credit system
- [ ] Provider: Claude API (primary), with fallback configuration

---

## Phase 4: Nice-to-Haves, Tier 2 (Weeks 17-24)

### 4.1 Workflow Enhancements (Weeks 17-19)

**Extend the existing `workflows` module:**

- [ ] Pre-built workflow templates:
  - "New Lead Welcome" — form submitted → wait 5 min → send welcome email → wait 2 days → send follow-up
  - "Deal Follow-Up" — deal created → wait 3 days → if no activity → send reminder email
  - "Re-engage Cold Leads" — contact last active > 30 days → send re-engagement email
  - "Post-Sale" — deal won → send thank-you email → wait 7 days → send review request
- [ ] Email and SMS as workflow action steps
- [ ] Blog-Ops trigger step: "Start Blog-Ops email sequence"
- [ ] Conditional branching on contact properties (has tag X, deal value > Y, email opened)
- [ ] Time-based wait nodes (wait X hours/days)

### 4.2 Calendar & Booking (Weeks 20-21)

**Create new module: `src/modules/calendar/`**

- [ ] Entities: `booking_pages` (slug, owner, availability JSONB, duration, buffer), `bookings` (page_id, contact_id, datetime, status, meeting_link)
- [ ] Booking page builder: shareable URL, user sets available hours/days
- [ ] Google Calendar sync (OAuth → read/write events)
- [ ] Automated reminders: email/SMS X hours before booking
- [ ] No-show detection: if no activity after booking time → trigger workflow
- [ ] Embed booking widget on landing pages
- [ ] Widget injection: "Book Meeting" button on contact detail

### 4.3 Reporting & Analytics (Weeks 22-23)

**Create new module: `src/modules/reporting/`**

- [ ] Pipeline report: deals by stage, conversion funnel, revenue forecast
- [ ] Email report: sent/delivered/opened/clicked/bounced rates, trends over time
- [ ] Landing page report: views, submissions, conversion rates per page
- [ ] Contact growth report: new contacts over time, by source
- [ ] Activity report: emails sent, calls logged, deals moved per team member
- [ ] All reports as dashboard widgets (user picks which to show)
- [ ] Date range picker, export to CSV

### 4.4 Reputation Management (Week 24)

**Create new module: `src/modules/reputation/`**

- [ ] Google Places API integration: fetch reviews for a business
- [ ] Review monitoring dashboard: average rating, recent reviews, response status
- [ ] Automated review request: workflow action → send email/SMS with review link
- [ ] Review gating: if sentiment positive → direct to Google, if negative → direct to private feedback form
- [ ] Dashboard widget: star rating, review count, recent reviews

---

## Phase 5: Nice-to-Haves, Tier 3 (Weeks 25-30)

### 5.1 Phone System (Weeks 25-27)

**Create new module: `src/modules/phone/`**

- Twilio Voice integration
- Call tracking numbers (assignable to landing pages/campaigns)
- Click-to-call from contact detail
- Call recording and playback
- Missed call → auto-SMS ("Sorry we missed you!")
- Call logging as activities
- Billing: credits per minute

### 5.2 Courses & Memberships (Weeks 28-30)

**Create new module: `src/modules/courses/`**

- Course builder: modules → lessons → content (text, video embed, files)
- Drip content: unlock lessons on schedule
- Progress tracking per contact
- Enrollment: free or paid (via Stripe)
- Video hosting: Mux integration or S3 + CloudFront
- Certificate generation on completion
- Community discussion per course (simple threaded comments)

---

## Deployment & Operations

### CI/CD Pipeline
- [ ] GitHub Actions: lint → typecheck → test → build → deploy on push to `main`
- [ ] Deploy: SSH to Hetzner → pull latest → rebuild Docker image → restart container
- [ ] Database migrations run automatically on container start

### Monitoring
- [ ] Health check endpoint: `GET /api/health`
- [ ] Uptime monitoring: UptimeRobot or similar (free tier)
- [ ] Error tracking: Sentry (free tier for low volume)
- [ ] Log aggregation: Docker logs → optional forwarding to Grafana Cloud (free tier)

### Backups
- [ ] PostgreSQL: daily pg_dump to S3/R2 (cron job)
- [ ] Retain 30 days of backups
- [ ] Test restore procedure before launch

### Security
- [ ] HTTPS enforced via Nginx + Let's Encrypt
- [ ] Database credentials in environment variables (not committed)
- [ ] API keys hashed in database
- [ ] Rate limiting enabled on public endpoints (signup, login, form submission, API)
- [ ] CORS configured for your domains only

---

## Summary Timeline

| Phase | Weeks | What Ships |
|-------|-------|-----------|
| **1. Foundation** | 1-3 | Fork + deploy + UI overhaul + signup |
| **2. Essentials (MVP)** | 4-9 | Landing pages + email + API integrations + billing |
| **— Beta test —** | | 5-10 program members use it |
| **3. Tier 1** | 10-16 | SMS + pipeline + invoicing + AI |
| **4. Tier 2** | 17-24 | Workflows + calendar + reporting + reputation |
| **5. Tier 3** | 25-30 | Phone + courses |

**First usable product: Week 9 (~2 months)**
**Full platform: Week 30 (~7 months)**
