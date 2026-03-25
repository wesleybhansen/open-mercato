# CRM Simplification & AI Integration Plan

> Goal: Transform from a confusing enterprise platform into a simple, AI-powered CRM that solopreneurs want to use. Default is simple. Advanced mode available in settings.

---

## Architecture: Mode System

**User preference:** `interface_mode: 'simple' | 'advanced'` stored in user profile or localStorage.
**Default:** `simple` for all new signups.
**Toggle:** Settings → Preferences → Interface Mode.

**What changes between modes:**
| Feature | Simple Mode | Advanced Mode |
|---------|------------|---------------|
| Sidebar items | 5-7 core items | Full Open Mercato nav (20+) |
| Dashboard | AI-driven action items + KPIs | Configurable widget grid |
| Contacts | Merged People + Companies with side panel | Separate People, Companies, detail pages |
| Deals | Pipeline Kanban (default view) | Pipeline + list + filters + custom fields |
| Workflows | AI-powered ("tell me what to automate") | Visual workflow builder |
| Team features | Hidden | Teams, roles, leave, availability |
| Settings | Account + preferences | Full admin panel |
| AI Assistant | Always visible (floating chat) | Available but not prominent |

**Implementation:** The sidebar is built in the backend layout. We create a `getSidebarConfig(mode)` function that returns different nav items based on mode. All modules stay enabled — we just control visibility.

---

## Build Phases

### Phase 1: Sidebar Simplification (Day 1)

**Task 1.1: Create mode preference system**
- Add `interface_mode` column to user preferences (or use localStorage for MVP)
- Create API endpoint: `GET/PUT /api/preferences/interface-mode`
- Default: `simple`

**Task 1.2: Simplified sidebar**
- Override the backend layout to build sidebar based on mode
- Simple mode nav structure:

```
Dashboard          (icon: LayoutDashboard)
Contacts           (icon: Users) → merged People + Companies
Pipeline           (icon: Kanban) → deals pipeline board
Landing Pages      (icon: FileText)
Email              (icon: Mail)
─────────────
Settings           (icon: Settings) → account, preferences, integrations
```

- Remove from simple mode: Teams, Team Members, Roles, Leave Requests, Availability, Attachments, Staff, Workflows (standalone), API Docs, Planner
- Advanced mode: shows everything

**Task 1.3: Mode toggle in settings**
- Settings page with radio buttons: Simple / Advanced
- Saves preference, reloads sidebar

---

### Phase 2: AI Assistant (Days 2-4)

**Task 2.1: Floating chat widget**
- Fixed-position button in bottom-right corner of every page
- Click to open chat panel (slide up from bottom-right, ~400px wide, ~500px tall)
- Chat interface similar to what we built for landing pages but persistent
- Minimizable, remembers open/closed state

**Task 2.2: Assistant API endpoint**
- `POST /api/ai/assistant` — receives message + context, returns AI response
- System prompt includes:
  - CRM feature documentation (what you can do, where things are)
  - Current page context (which page the user is on)
  - User's recent activity summary
  - Ability to suggest actions ("Click People in the sidebar to add a contact")

**Task 2.3: Action capabilities**
The assistant should be able to suggest links and actions:
- "Go to [Landing Pages](/backend/landing-pages) to create a page"
- "You can add a contact by clicking [here](/backend/customers/people/create)"
- "Your pipeline has 3 stale deals — [view pipeline](/backend/customers/deals/pipeline)"

Phase 2+ (later): Assistant can execute actions (create contacts, send emails, update deals) via tool calls.

**Task 2.4: Contextual help triggers**
- On empty states ("No contacts yet"), show a prompt: "Need help getting started? Ask the AI assistant."
- On first visit to any section, show a brief tooltip: "This is where you manage your contacts. Click + to add one."

---

### Phase 3: Redesigned Dashboard (Days 5-7)

**Task 3.1: Simple mode dashboard layout**
- Replace the configurable widget grid with a focused, opinionated layout:

```
┌─────────────────────────────────────────────────────────┐
│  Welcome back, [Name]                                    │
│  Here's what needs your attention today.                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  📋 Action Items (AI-generated)                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │ ○ Follow up with [Contact] — proposal sent 5 days  ││
│  │ ○ 3 new leads from [Landing Page] need review      ││
│  │ ○ Reply to [Contact]'s email (received yesterday)  ││
│  │ ○ Deal with [Contact] stale for 10 days            ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
├──────────────────┬──────────────────┬───────────────────┤
│  New Contacts    │  Pipeline        │  Landing Pages    │
│  ┌──────────┐   │  ┌──────────┐   │  ┌──────────┐    │
│  │    12    │   │  │  $15,200 │   │  │   47     │    │
│  │ this week│   │  │  pipeline│   │  │  views   │    │
│  └──────────┘   │  └──────────┘   │  └──────────┘    │
│  +3 vs last week│  5 open deals   │  12 submissions  │
├──────────────────┴──────────────────┴───────────────────┤
│                                                         │
│  Quick Actions                                          │
│  [+ Add Contact] [+ Create Page] [+ New Deal] [✉ Email]│
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Recent Activity                                        │
│  • Sarah Chen opened your email — 2h ago                │
│  • New lead: James Cooper (from Free Guide page) — 5h   │
│  • Deal won: Aisha Patel — $3,200 — yesterday           │
│  • Landing page "Scale Your Business" got 8 views today │
└─────────────────────────────────────────────────────────┘
```

**Task 3.2: AI action items generation**
- API endpoint: `GET /api/ai/action-items`
- On dashboard load, queries:
  - Deals not updated in 5+ days
  - New form submissions without linked deals
  - Unanswered emails
  - Contacts with no recent activity
- AI prioritizes and generates natural language action items
- Cache for 15 minutes (don't re-generate on every page load)

**Task 3.3: KPI cards**
- Simple stat cards: New contacts, pipeline value, landing page views/submissions
- Compare to last period (week over week)

**Task 3.4: Recent activity feed**
- Pull from customer_activities table
- Show: emails sent/opened, form submissions, deal changes, contact created
- Link each item to the relevant record

---

### Phase 4: Simplified Contacts (Days 8-10)

**Task 4.1: Merged contacts view**
- Single `/backend/contacts` route (override in simple mode)
- Tabs at top: "People" | "Companies" | "All"
- Default view: People (most common for solopreneurs)
- Clean data table: Name, Email, Phone, Tags, Last Activity, Created
- Search bar prominent at top

**Task 4.2: Side panel (Twenty-style)**
- Click a contact row → side panel slides in from the right (alongside the list)
- Panel shows:
  - Contact info (name, email, phone, company, tags)
  - Quick actions: Send Email, Create Deal, Add Tag, Add Note
  - Tabs: Overview | Emails | Deals | Activity
  - Activity timeline (form submissions, emails, notes, deal changes)
- Edit inline — click a field to edit

**Task 4.3: Quick add contact**
- "+" button in header → slide-out form
- Minimal fields: Name, Email, Phone (optional), Company (optional), Tags
- AI auto-enrichment later: enter email → AI fills in name, company, LinkedIn

---

### Phase 5: AI Email Composer (Days 11-12)

**Task 5.1: Compose modal**
- Accessible from: contact side panel "Send Email" button, email page "Compose" button, AI assistant ("draft an email to...")
- Modal with: To (pre-filled), Subject, Body (rich text)
- "AI Draft" button: generates email based on contact context

**Task 5.2: AI draft generation**
- Endpoint: `POST /api/ai/draft-email`
- Input: contactId, optional purpose ("follow up", "introduce", "check in")
- AI reads: contact details, recent activity, deal stage, previous emails
- Generates: subject + body tailored to context and user's tone preference

**Task 5.3: Send flow**
- Preview → Edit → Send
- Logs in email_messages table
- Links to contact activity timeline
- Tracking pixel + click tracking injected automatically

---

### Phase 6: AI Onboarding (Days 13-15)

**Task 6.1: First-login wizard**
- After signup + email verification → redirect to `/backend/onboarding` (not regular dashboard)
- Multi-step wizard:

Step 1: "Tell us about your business"
- Business name (pre-filled from signup)
- What do you do? (free text or dropdown: coaching, consulting, agency, product, services, other)
- Who are your ideal clients?

Step 2: "How do you get clients?"
- Checkboxes: Landing pages, Social media, Referrals, Cold outreach, Ads, Events
- This configures which features to highlight

Step 3: "Set up your pipeline"
- AI suggests pipeline stages based on business type
- User can accept, modify, or skip
- Example for coaching: Lead → Discovery Call → Proposal → Client
- Example for e-commerce: Inquiry → Quote → Order → Delivered

Step 4: "Create your first landing page?" (optional)
- Quick-start: pick template, fill in basics, AI generates
- Or skip: "I'll do this later"

Step 5: "Import contacts?" (optional)
- CSV upload
- Or skip

→ Dashboard with AI-generated getting-started action items

**Task 6.2: AI pipeline configuration**
- Based on business type, AI suggests pipeline stages
- Endpoint: `POST /api/ai/suggest-pipeline`
- Input: business type + description
- Output: array of {name, order, description}

**Task 6.3: Getting-started action items**
- After onboarding, dashboard shows:
  - "Add your first contact"
  - "Create a landing page"
  - "Connect your email"
- These disappear as the user completes them

---

## Build Order & Priorities

| Phase | What | Days | Impact |
|-------|------|------|--------|
| 1 | Sidebar simplification + mode toggle | 1 | High — immediate UX improvement |
| 2 | AI Assistant chat widget | 3 | High — helps every confused user |
| 3 | Redesigned dashboard | 3 | High — first thing users see |
| 4 | Simplified contacts + side panel | 3 | High — core daily use |
| 5 | AI email composer | 2 | Medium — key workflow |
| 6 | AI onboarding wizard | 3 | High — first impression |
| **Total** | | **15 days** | |

---

## Technical Decisions

**AI Provider:** Gemini (configured, working). All AI features use the same pattern: API endpoint → Gemini call → structured response.

**Mode Storage:** Start with localStorage for quick implementation. Later move to user preferences in database.

**Sidebar Override:** Use Open Mercato's overlay system — create app-level backend layout that replaces the sidebar based on mode.

**AI Assistant:** Client-side React component (floating chat). Server-side API endpoint with Gemini. System prompt includes CRM documentation. Context-aware (knows which page user is on).

**Dashboard:** Server component that queries DB for stats. AI action items generated via API, cached 15 min.

---

## What We're NOT Changing

- Open Mercato core modules stay enabled (not deleted)
- All existing API endpoints continue working
- Advanced mode reveals everything for power users
- Integration APIs for LaunchBot/Blog-Ops unchanged
- Landing page builder unchanged (already AI-driven)
- Multi-tenancy architecture unchanged
