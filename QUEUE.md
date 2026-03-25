# CRM Build Queue

Ordered by priority. Each item includes what it does for users and rough effort.

---

## Priority 1: Core Functionality Gaps

These features are needed before the CRM is useful for day-to-day business.

### 1.1 Payments & Invoicing (3-4 days)
**Why:** Solopreneurs need to get paid. This is table stakes.
- [ ] Stripe Connect integration (users connect their Stripe account in settings)
- [ ] Products/services catalog — name, description, price, recurring vs one-time
- [ ] Create invoice from contact or deal — line items, total, due date
- [ ] Send invoice via email with Stripe payment link
- [ ] Invoice status tracking (draft → sent → paid → overdue)
- [ ] Quick "payment link" generator — create a product → get a shareable checkout URL
- [ ] Checkout page (hosted, styled to match their brand) — visitor pays → contact created in CRM
- [ ] Payment received → deal auto-marked as Won, activity logged
- [ ] Payments list page in sidebar (simple mode)
- [ ] Stripe webhook handler for payment events
- [ ] Dashboard widget: revenue this month, outstanding invoices

### 1.2 Notes & Tasks (1-2 days)
**Why:** Users need to track follow-ups and remember things about contacts.
- [ ] Add note to contact from side panel (quick text + timestamp)
- [ ] Create task from contact side panel (title, due date, done/not done)
- [ ] Tasks list in dashboard action items
- [ ] Overdue tasks highlighted
- [ ] Notes visible in contact activity timeline

### 1.3 Tags & Segments (1 day)
**Why:** Users need to organize and filter contacts.
- [ ] Add/remove tags from contact side panel
- [ ] Filter contacts by tag
- [ ] Create tag with color
- [ ] Bulk tag (select multiple contacts → apply tag)

### 1.4 Contact Import (1 day)
**Why:** Users have existing contacts in spreadsheets.
- [ ] CSV upload with column mapping
- [ ] Preview before import
- [ ] Duplicate detection (by email)
- [ ] Available in onboarding wizard and contacts page

---

## Priority 2: Infrastructure (Must Do Before Launch)

### 2.1 Gemini Paid Tier
- [ ] Wesley upgrades Gemini API key to pay-as-you-go
- [ ] Verify all AI features work reliably

### 2.2 Email Setup (Resend)
- [ ] Configure Resend API key
- [ ] Set up sending domain (SPF/DKIM/DMARC)
- [ ] Test signup verification email flow
- [ ] Test email compose → send → track

### 2.3 End-to-End Testing
- [ ] Signup → verify → login → dashboard
- [ ] Create landing page → publish → visit public URL → submit form
- [ ] Verify contact created from form submission
- [ ] Send email to contact → verify tracking (opens/clicks)
- [ ] Create deal → move through pipeline → mark as won
- [ ] Create invoice → send → pay (Stripe test mode)

### 2.4 Deploy to Hetzner
- [ ] Docker compose for CRM
- [ ] Nginx reverse proxy + SSL
- [ ] PostgreSQL + Redis setup
- [ ] Domain configuration
- [ ] Verify everything works in production

### 2.5 AI Usage Cap + BYOK
- [ ] ai_usage table (org_id, month, calls, tokens)
- [ ] Admin settings: set monthly cap
- [ ] Pre-call check: under cap? → proceed. Over cap + user key? → use user key. Over cap + no key? → show "add key" message
- [ ] User settings: enter own Gemini/OpenAI/Anthropic key

---

## Priority 3: Polish & UX

### 3.1 Settings Page
- [ ] Interface mode toggle (Simple ↔ Advanced)
- [ ] Account info (name, email, password change)
- [ ] API key management (for LaunchBot/Blog-Ops integration)
- [ ] BYOK key entry
- [ ] Connected services (Stripe, Resend)
- [ ] Team members (if applicable)

### 3.2 Onboarding Improvements
- [ ] Save business profile from wizard to database
- [ ] Use business profile in AI prompts across all features
- [ ] Redirect new signups to /backend/welcome
- [ ] Contact import step in wizard

### 3.3 Landing Page Improvements
- [ ] Template preview button (full-screen before selecting)
- [ ] Remove privacy/terms/thank-you templates
- [ ] Reclassify misplaced utility templates
- [ ] Logo upload for landing page headers
- [ ] Improve AI revision prompt (more aggressive changes)
- [ ] Template-specific form fields (booking pages get date picker, etc.)

### 3.4 UI Polish
- [ ] Dark mode hover state fixes (icons matching text)
- [ ] Replace logo with actual brand logo when available
- [ ] Mobile responsive testing
- [ ] Loading states and skeleton screens
- [ ] Error boundaries

---

## Priority 4: Integration & Automation

### 4.1 Blog-Ops Integration
- [ ] Define API contract between CRM and Blog-Ops
- [ ] Contact sync (bidirectional)
- [ ] Email sequence triggering (CRM → Blog-Ops)
- [ ] Content pull (Blog-Ops → CRM for review)

### 4.2 LaunchBot Integration
- [ ] CRM skill for LaunchBot agents
- [ ] Agent can query contacts, deals, pipeline
- [ ] Agent can create contacts, log activities
- [ ] "Ask AI" button on contact pages → sends context to LaunchBot

### 4.3 Workflow Automation (AI-driven)
- [ ] Natural language workflow builder ("when X happens, do Y")
- [ ] Pre-built templates: welcome sequence, follow-up, re-engage
- [ ] Email/SMS actions in workflows
- [ ] Blog-Ops trigger actions

---

## Priority 5: Growth Features

### 5.1 SMS (Twilio)
- [ ] Send/receive SMS from contact detail
- [ ] SMS in activity timeline

### 5.2 Calendar & Booking
- [ ] Booking page builder (shareable URL)
- [ ] Google Calendar sync
- [ ] Automated reminders

### 5.3 Reporting & Analytics
- [ ] Pipeline conversion funnel
- [ ] Revenue reports
- [ ] Landing page performance
- [ ] Email campaign stats

### 5.4 Courses & Memberships
- [ ] Course builder
- [ ] Drip content
- [ ] Payment gating via Stripe

---

## Current Status

### Completed
- [x] CRM core (contacts, companies, deals, pipeline) — Open Mercato
- [x] AI landing page builder (Gemini, 55 templates, wizard)
- [x] Simplified sidebar (simple vs advanced mode)
- [x] AI Assistant floating chat
- [x] AI-driven dashboard (action items, stats, quick actions)
- [x] Merged contacts view with side panel
- [x] AI email composer (draft + send)
- [x] AI onboarding wizard (5 steps, pipeline suggestions)
- [x] Email module (send/receive APIs, tracking)
- [x] Integration APIs (for LaunchBot/Blog-Ops)
- [x] Twenty-inspired theme (light + dark)
- [x] Self-service signup
- [x] Branding (CRM, blue icon)

### Next Up
→ **Priority 1.1: Payments & Invoicing** — this fills the biggest gap
