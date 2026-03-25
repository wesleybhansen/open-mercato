# CRM Build Backlog

Items to address before MVP launch. Ordered roughly by priority.

## Must Build (Next Session)
- [ ] **AI Landing Page Wizard (rebuild)** — Replace chat UI with guided wizard. See notes below.
  - Step 1: Pick template (DONE — visual grid with iframe previews, working)
  - Step 2: Guided form wizard (BUILT — 3-screen wizard with tone selector, benefits repeater, social proof, catch-all input)
    - Form fields depend on template category (lead magnet vs booking vs services etc)
    - Common fields: business name, offer description, target audience, CTA action
    - Category-specific: lead magnet needs "what they get", services needs "services list", booking needs "what they're booking"
    - Benefits/features list (repeatable — add/remove items)
    - Social proof (testimonials, stats — optional)
    - AI pre-fills as much as possible from business name + description
    - AI "Generate Copy" button fills remaining fields
    - User can edit any field manually
  - Step 3: Live preview with feedback (BUILT — revision textarea, regenerate, publish button)

  **Fixed (2026-03-25):**
  - AI page generation WORKS — Gemini rewrites template body, head/styles preserved
  - Fixed template path resolution (process.cwd() was repo root, not apps/mercato)
  - Reduced token usage 60%+ by sending only body content to AI
  - 90s timeout for Gemini API calls
  - Revision endpoint also uses body-only approach

  **Quick fixes (queued):**
  - Replace blue "C" icon with logo from ~/Desktop/Personal Knowledge Base (favicon)
  - Add "Preview" button on template hover (full-screen template preview before selecting)
  - Remove: page-privacy, page-terms, page-thank-you, thank-you-* templates from picker
  - Reclassify misplaced utility templates (page-booking → booking, page-lead-magnet → lead magnet, etc.)
  - AI revision quality — revise endpoint prompt needs to be more aggressive about making requested changes

  **Next priorities:**
  - Template-aware AI prompting — AI should know the page type (lead magnet vs booking vs services) and generate appropriate content. Lead magnet shouldn't have booking fields, services page shouldn't have download CTAs.
  - Gemini rate limiting — free tier too restrictive for iterative revisions. Options: (a) upgrade to paid Gemini tier (~$0.01-0.03/generation), (b) batch revisions client-side, (c) add cooldown/queue for AI requests
  - Logo upload for headers (users upload logo or no logo shown)
  - Test end-to-end: publish page → submit form → verify contact in CRM
  - Sidebar branding still says "Open Mercato"
  - Template previews don't always load consistently in the picker grid
  - Backend: Template parser, AI service, content renderer all exist and work
  - Backend: Gemini API integration works (tested directly)
  - Backend: Form submission → contact creation works

## Must Fix
- [ ] Login API returns 500 (browser login works, need to debug)
- [x] Form submission → auto-create contact (DONE — inline in submit endpoint, creates contact + person profile + activity)
- [x] Landing page publish flow (DONE — toggle button in list page)
- [x] New tenant onboarding permissions (DONE — setup.ts seeds features, only existing demo tenant needed manual fix)

## Should Build
- [ ] Email compose modal (accessible from contact detail page — "Send Email" button)
- [ ] Email template management UI (create/edit/list templates with variable placeholders)
- [ ] Email campaign builder UI (select recipients by tag, pick template, schedule/send)
- [ ] Landing page form field editor (add/remove/reorder form fields in the page editor)
- [ ] Landing page submissions list view (see all form submissions for a page)
- [ ] Integration API key management UI (generate/revoke API keys for LaunchBot/Blog-Ops)

## Design / UX
- [ ] Dark mode hover fixes (icons not matching text on hover, some buttons go dark)
- [ ] Onboarding page layout fixes (card top spacing, centering)
- [ ] Landing page template preview thumbnails (currently shows "Preview" placeholder)
- [ ] Side panel for contact/deal detail (Twenty-inspired pattern — detail alongside list)
- [ ] Simplify sidebar for new users (hide admin-only items, clean up groups)

## Billing (Deferred — Wesley deciding on model)
- [ ] Decide billing model (credit-based vs subscription vs free with usage limits)
- [ ] Stripe checkout integration for credit purchases
- [ ] Usage metering (deduct credits per email/SMS/AI)
- [ ] Billing settings page location (currently under Settings, may want profile dropdown)
- [ ] Low balance notifications
- [ ] Free tier monthly credit allowance

## Infrastructure
- [ ] Deploy to Hetzner VPS (Docker compose, Nginx reverse proxy, SSL)
- [ ] Set up Resend API key for email sending
- [ ] Configure sending domain (SPF/DKIM/DMARC)
- [ ] Database backups (pg_dump cron to S3/R2)
- [ ] Error tracking (Sentry)
- [ ] Health check endpoint

## Future (Post-MVP)
- [ ] SMS module (Twilio)
- [ ] Calendar & booking
- [ ] Workflow templates
- [ ] Reporting & analytics dashboards
- [ ] Reputation management
- [ ] Phone system
- [ ] Courses & memberships
