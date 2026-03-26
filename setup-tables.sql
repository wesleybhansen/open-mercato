-- ==============================================================================
-- CRM Custom Tables Setup
-- Run this after initializing Open Mercato: psql -U crm -d crm < setup-tables.sql
-- ==============================================================================

-- Landing Pages
CREATE TABLE IF NOT EXISTS landing_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  title TEXT NOT NULL, slug TEXT NOT NULL, template_id TEXT, template_category TEXT,
  status TEXT NOT NULL DEFAULT 'draft', config JSONB, custom_domain TEXT, published_html TEXT,
  owner_user_id UUID, view_count INTEGER NOT NULL DEFAULT 0, submission_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS landing_pages_org_slug_idx ON landing_pages(organization_id, slug);

CREATE TABLE IF NOT EXISTS landing_page_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  landing_page_id UUID NOT NULL REFERENCES landing_pages(id), name TEXT NOT NULL DEFAULT 'default',
  fields JSONB NOT NULL DEFAULT '[]', redirect_url TEXT, notification_email TEXT, success_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  form_id UUID NOT NULL, landing_page_id UUID NOT NULL, data JSONB NOT NULL,
  contact_id UUID, source_ip TEXT, user_agent TEXT, referrer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS form_submissions_org_page_idx ON form_submissions(organization_id, landing_page_id);

-- Email
CREATE TABLE IF NOT EXISTS email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  email_address TEXT NOT NULL, display_name TEXT, provider TEXT NOT NULL DEFAULT 'resend',
  config JSONB, is_default BOOLEAN NOT NULL DEFAULT true, sending_domain TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  account_id UUID, direction TEXT NOT NULL, from_address TEXT NOT NULL, to_address TEXT NOT NULL,
  cc TEXT, bcc TEXT, subject TEXT NOT NULL, body_html TEXT NOT NULL, body_text TEXT,
  thread_id TEXT, contact_id UUID, deal_id UUID, campaign_id UUID,
  status TEXT NOT NULL DEFAULT 'draft', tracking_id UUID NOT NULL DEFAULT gen_random_uuid(),
  opened_at TIMESTAMPTZ, clicked_at TIMESTAMPTZ, bounced_at TIMESTAMPTZ, metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS email_messages_org_contact_idx ON email_messages(organization_id, contact_id);
CREATE INDEX IF NOT EXISTS email_messages_tracking_idx ON email_messages(tracking_id);

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  name TEXT NOT NULL, subject TEXT NOT NULL, body_html TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'transactional',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  name TEXT NOT NULL, template_id UUID, subject TEXT, body_html TEXT,
  status TEXT NOT NULL DEFAULT 'draft', segment_filter JSONB, scheduled_at TIMESTAMPTZ,
  stats JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ);

CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id UUID NOT NULL, contact_id UUID NOT NULL,
  email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ, opened_at TIMESTAMPTZ, clicked_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS email_campaign_recipients_idx ON email_campaign_recipients(campaign_id, contact_id);

CREATE TABLE IF NOT EXISTS email_unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  email TEXT NOT NULL, contact_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS email_unsubscribes_org_email_idx ON email_unsubscribes(organization_id, email);

-- Billing / Credits
CREATE TABLE IF NOT EXISTS credit_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL UNIQUE, balance NUMERIC(10,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  amount NUMERIC(10,4) NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL,
  service TEXT, reference_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS credit_transactions_org_date_idx ON credit_transactions(organization_id, created_at);

CREATE TABLE IF NOT EXISTS credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL,
  credit_amount NUMERIC(10,4) NOT NULL, price NUMERIC(10,2) NOT NULL,
  stripe_price_id TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO credit_packages (name, credit_amount, price, sort_order) VALUES
  ('Starter', 10, 10, 1), ('Growth', 25, 25, 2), ('Pro', 50, 50, 3) ON CONFLICT DO NOTHING;

-- Payments
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  name TEXT NOT NULL, description TEXT, price NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD', billing_type TEXT NOT NULL DEFAULT 'one_time',
  recurring_interval TEXT, stripe_price_id TEXT, stripe_product_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  invoice_number TEXT NOT NULL, contact_id UUID, deal_id UUID,
  status TEXT NOT NULL DEFAULT 'draft', line_items JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0, tax NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
  due_date TIMESTAMPTZ, notes TEXT, stripe_payment_link TEXT, stripe_invoice_id TEXT,
  sent_at TIMESTAMPTZ, paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS invoices_org_status_idx ON invoices(organization_id, status);

CREATE TABLE IF NOT EXISTS payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  product_id UUID REFERENCES products(id), name TEXT NOT NULL, url_slug TEXT NOT NULL,
  stripe_payment_link_id TEXT, stripe_url TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
  view_count INTEGER NOT NULL DEFAULT 0, payment_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  invoice_id UUID, contact_id UUID, amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id TEXT, stripe_checkout_session_id TEXT, metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS payment_records_org_idx ON payment_records(organization_id, created_at);

-- Notes & Tasks
CREATE TABLE IF NOT EXISTS contact_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  contact_id UUID NOT NULL, content TEXT NOT NULL, author_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS contact_notes_contact_idx ON contact_notes(contact_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  title TEXT NOT NULL, description TEXT, contact_id UUID, deal_id UUID,
  due_date TIMESTAMPTZ, is_done BOOLEAN NOT NULL DEFAULT false, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS tasks_org_done_idx ON tasks(organization_id, is_done, due_date);

-- AI Usage
CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  month TEXT NOT NULL, call_count INTEGER NOT NULL DEFAULT 0, token_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_org_month_idx ON ai_usage(organization_id, month);

CREATE TABLE IF NOT EXISTS ai_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  organization_id UUID, user_id UUID, setting_key TEXT NOT NULL, setting_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- Business Profiles
CREATE TABLE IF NOT EXISTS business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL UNIQUE, business_name TEXT, business_type TEXT,
  business_description TEXT, main_offer TEXT, ideal_clients TEXT, team_size TEXT,
  client_sources JSONB DEFAULT '[]', pipeline_stages JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- Stage Automations
CREATE TABLE IF NOT EXISTS stage_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  trigger_stage TEXT NOT NULL, action_type TEXT NOT NULL, action_config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- Calendar & Booking
CREATE TABLE IF NOT EXISTS booking_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  title TEXT NOT NULL, slug TEXT NOT NULL, description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  availability JSONB NOT NULL DEFAULT '{"monday":{"start":"09:00","end":"17:00"},"tuesday":{"start":"09:00","end":"17:00"},"wednesday":{"start":"09:00","end":"17:00"},"thursday":{"start":"09:00","end":"17:00"},"friday":{"start":"09:00","end":"17:00"}}',
  buffer_minutes INTEGER NOT NULL DEFAULT 15, is_active BOOLEAN NOT NULL DEFAULT true,
  owner_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  booking_page_id UUID REFERENCES booking_pages(id), contact_id UUID,
  guest_name TEXT NOT NULL, guest_email TEXT NOT NULL, guest_phone TEXT,
  start_time TIMESTAMPTZ NOT NULL, end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed', notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS bookings_org_time_idx ON bookings(organization_id, start_time);

-- Google Calendar
CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  user_id UUID NOT NULL, google_email TEXT NOT NULL,
  access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, token_expiry TIMESTAMPTZ NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary', is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS google_cal_user_idx ON google_calendar_connections(user_id);

-- SMS
CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  contact_id UUID, direction TEXT NOT NULL, from_number TEXT NOT NULL, to_number TEXT NOT NULL,
  body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', twilio_sid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS sms_messages_contact_idx ON sms_messages(contact_id, created_at);

-- Courses
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  title TEXT NOT NULL, description TEXT, slug TEXT NOT NULL,
  price NUMERIC(10,2), currency TEXT NOT NULL DEFAULT 'USD',
  is_free BOOLEAN NOT NULL DEFAULT false, is_published BOOLEAN NOT NULL DEFAULT false, image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);

CREATE TABLE IF NOT EXISTS course_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), course_id UUID NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS course_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), module_id UUID NOT NULL REFERENCES course_modules(id),
  title TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'text', content TEXT, video_url TEXT,
  duration_minutes INTEGER, sort_order INTEGER NOT NULL DEFAULT 0,
  is_free_preview BOOLEAN NOT NULL DEFAULT false, drip_days INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS course_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, organization_id UUID NOT NULL,
  course_id UUID NOT NULL REFERENCES courses(id), contact_id UUID,
  student_name TEXT NOT NULL, student_email TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ,
  payment_id UUID, status TEXT NOT NULL DEFAULT 'active');
CREATE INDEX IF NOT EXISTS enrollments_course_idx ON course_enrollments(course_id, status);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES course_enrollments(id),
  lesson_id UUID NOT NULL REFERENCES course_lessons(id),
  completed_at TIMESTAMPTZ, UNIQUE(enrollment_id, lesson_id));

-- Done
SELECT 'All custom tables created successfully' AS status;
