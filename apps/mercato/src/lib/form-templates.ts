export type FormFieldDef = {
  id: string
  type: 'short_text' | 'long_text' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'multi_select' | 'radio' | 'checkbox' | 'rating' | 'yes_no' | 'file' | 'section' | 'page_break'
  label: string
  placeholder?: string
  description?: string
  required?: boolean
  options?: string[]
  validation?: { min?: number; max?: number }
  crmMapping?: string
  width?: 'full' | 'half'
}

export type FormTemplate = {
  id: string
  name: string
  category: 'Contact' | 'Booking' | 'Feedback' | 'Lead Gen' | 'Application' | 'Order'
  description: string
  icon: string
  fields: FormFieldDef[]
  popular?: boolean
}

const generalContactForm: FormTemplate = {
  id: 'general-contact',
  name: 'General Contact Form',
  category: 'Contact',
  description: 'Simple contact form with name, email, and message fields.',
  icon: 'Mail',
  popular: true,
  fields: [
    { id: 'f1', type: 'short_text', label: 'Full Name', placeholder: 'Jane Smith', required: true, crmMapping: 'display_name', width: 'full' },
    { id: 'f2', type: 'email', label: 'Email Address', placeholder: 'jane@example.com', required: true, crmMapping: 'primary_email', width: 'half' },
    { id: 'f3', type: 'phone', label: 'Phone Number', placeholder: '+1 (555) 000-0000', crmMapping: 'primary_phone', width: 'half' },
    { id: 'f4', type: 'select', label: 'Subject', placeholder: 'Select a topic', required: true, options: ['General Inquiry', 'Support', 'Sales', 'Partnership', 'Other'], width: 'full' },
    { id: 'f5', type: 'long_text', label: 'Message', placeholder: 'Tell us how we can help...', required: true, width: 'full' },
  ],
}

const clientOnboarding: FormTemplate = {
  id: 'client-onboarding',
  name: 'Client Onboarding Questionnaire',
  category: 'Contact',
  description: 'Comprehensive intake form for new clients with company details and project scope.',
  icon: 'ClipboardList',
  fields: [
    { id: 'f1', type: 'short_text', label: 'Full Name', placeholder: 'Jane Smith', required: true, crmMapping: 'display_name', width: 'half' },
    { id: 'f2', type: 'email', label: 'Email Address', placeholder: 'jane@company.com', required: true, crmMapping: 'primary_email', width: 'half' },
    { id: 'f3', type: 'phone', label: 'Phone Number', placeholder: '+1 (555) 000-0000', crmMapping: 'primary_phone', width: 'half' },
    { id: 'f4', type: 'short_text', label: 'Company Name', placeholder: 'Acme Inc.', crmMapping: 'company_name', width: 'half' },
    { id: 'f5', type: 'short_text', label: 'Website', placeholder: 'https://example.com', width: 'full' },
    { id: 'f6', type: 'select', label: 'Industry', options: ['Technology', 'Healthcare', 'Finance', 'Education', 'Retail', 'Manufacturing', 'Real Estate', 'Consulting', 'Other'], width: 'half' },
    { id: 'f7', type: 'multi_select', label: 'Services Interested In', options: ['Web Design', 'Development', 'SEO', 'Marketing', 'Branding', 'Consulting', 'Support'], width: 'half' },
    { id: 'f8', type: 'select', label: 'Budget Range', options: ['Under $5,000', '$5,000 - $10,000', '$10,000 - $25,000', '$25,000 - $50,000', '$50,000+'], width: 'half' },
    { id: 'f9', type: 'select', label: 'Timeline', options: ['ASAP', '1-2 weeks', '1 month', '2-3 months', 'Flexible'], width: 'half' },
    { id: 'f10', type: 'select', label: 'How Did You Hear About Us?', options: ['Google Search', 'Social Media', 'Referral', 'Advertisement', 'Blog/Article', 'Other'], width: 'full' },
    { id: 'f11', type: 'long_text', label: 'Additional Notes', placeholder: 'Anything else you\'d like us to know...', width: 'full' },
  ],
}

const consultationBooking: FormTemplate = {
  id: 'consultation-booking',
  name: 'Free Consultation Booking',
  category: 'Booking',
  description: 'Let prospects book a free consultation with date and topic preferences.',
  icon: 'CalendarCheck',
  popular: true,
  fields: [
    { id: 'f1', type: 'short_text', label: 'Full Name', placeholder: 'Jane Smith', required: true, crmMapping: 'display_name', width: 'half' },
    { id: 'f2', type: 'email', label: 'Email Address', placeholder: 'jane@example.com', required: true, crmMapping: 'primary_email', width: 'half' },
    { id: 'f3', type: 'phone', label: 'Phone Number', placeholder: '+1 (555) 000-0000', required: true, crmMapping: 'primary_phone', width: 'full' },
    { id: 'f4', type: 'date', label: 'Preferred Date', required: true, width: 'half' },
    { id: 'f5', type: 'select', label: 'Preferred Time', required: true, options: ['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'], width: 'half' },
    { id: 'f6', type: 'long_text', label: 'What Would You Like to Discuss?', placeholder: 'Briefly describe what you need help with...', required: true, width: 'full' },
    { id: 'f7', type: 'select', label: 'How Did You Find Us?', options: ['Google', 'Social Media', 'Referral', 'Email', 'Other'], width: 'full' },
  ],
}

const appointmentRequest: FormTemplate = {
  id: 'appointment-request',
  name: 'Appointment Request',
  category: 'Booking',
  description: 'Collect appointment requests with service type and scheduling preferences.',
  icon: 'Calendar',
  fields: [
    { id: 'f1', type: 'short_text', label: 'Full Name', placeholder: 'Jane Smith', required: true, crmMapping: 'display_name', width: 'half' },
    { id: 'f2', type: 'email', label: 'Email Address', placeholder: 'jane@example.com', required: true, crmMapping: 'primary_email', width: 'half' },
    { id: 'f3', type: 'phone', label: 'Phone Number', placeholder: '+1 (555) 000-0000', required: true, crmMapping: 'primary_phone', width: 'full' },
    { id: 'f4', type: 'select', label: 'Service Type', required: true, options: ['Initial Consultation', 'Follow-Up', 'Review Meeting', 'Strategy Session', 'Technical Support'], width: 'full' },
    { id: 'f5', type: 'date', label: 'Preferred Date', required: true, width: 'half' },
    { id: 'f6', type: 'select', label: 'Preferred Time', required: true, options: ['Morning (9-12)', 'Afternoon (12-3)', 'Late Afternoon (3-5)'], width: 'half' },
    { id: 'f7', type: 'long_text', label: 'Special Requirements', placeholder: 'Any accessibility needs or special requests...', width: 'full' },
  ],
}

const customerSatisfaction: FormTemplate = {
  id: 'customer-satisfaction',
  name: 'Customer Satisfaction Survey',
  category: 'Feedback',
  description: 'Measure customer satisfaction with ratings and open-ended feedback.',
  icon: 'Star',
  popular: true,
  fields: [
    { id: 'f1', type: 'rating', label: 'Overall Satisfaction', description: 'How satisfied are you with our service?', required: true, validation: { min: 1, max: 5 }, width: 'full' },
    { id: 'f2', type: 'long_text', label: 'What Did We Do Well?', placeholder: 'Tell us what you enjoyed...', width: 'full' },
    { id: 'f3', type: 'long_text', label: 'What Could We Improve?', placeholder: 'Tell us how we can do better...', width: 'full' },
    { id: 'f4', type: 'rating', label: 'How Likely Are You to Recommend Us? (NPS)', description: 'On a scale of 1-10', required: true, validation: { min: 1, max: 10 }, width: 'full' },
    { id: 'f5', type: 'yes_no', label: 'May We Contact You to Follow Up?', width: 'half' },
    { id: 'f6', type: 'email', label: 'Email Address', placeholder: 'jane@example.com', crmMapping: 'primary_email', width: 'half' },
  ],
}

const postProjectReview: FormTemplate = {
  id: 'post-project-review',
  name: 'Post-Project Review',
  category: 'Feedback',
  description: 'Gather detailed feedback after completing a project with multi-dimension ratings.',
  icon: 'Award',
  fields: [
    { id: 'f1', type: 'short_text', label: 'Project Name', placeholder: 'Website Redesign', required: true, width: 'full' },
    { id: 'f2', type: 'rating', label: 'Overall Quality', description: 'Rate the overall quality of work delivered', required: true, validation: { min: 1, max: 5 }, width: 'half' },
    { id: 'f3', type: 'rating', label: 'Communication', description: 'How was communication throughout the project?', required: true, validation: { min: 1, max: 5 }, width: 'half' },
    { id: 'f4', type: 'rating', label: 'Timeliness', description: 'Was the project delivered on time?', required: true, validation: { min: 1, max: 5 }, width: 'half' },
    { id: 'f5', type: 'rating', label: 'Value for Money', description: 'Did you receive good value?', required: true, validation: { min: 1, max: 5 }, width: 'half' },
    { id: 'f6', type: 'long_text', label: 'What Was the Best Part?', placeholder: 'Tell us what stood out...', width: 'full' },
    { id: 'f7', type: 'long_text', label: 'What Would You Change?', placeholder: 'What could be improved next time...', width: 'full' },
    { id: 'f8', type: 'yes_no', label: 'Would You Hire Us Again?', required: true, width: 'half' },
    { id: 'f9', type: 'long_text', label: 'Testimonial', description: 'Would you like to leave a testimonial we can share?', placeholder: 'Write a short testimonial...', width: 'full' },
  ],
}

const newsletterSignup: FormTemplate = {
  id: 'newsletter-signup',
  name: 'Newsletter Signup',
  category: 'Lead Gen',
  description: 'Minimal signup form to grow your email list with interest segmentation.',
  icon: 'Newspaper',
  popular: true,
  fields: [
    { id: 'f1', type: 'email', label: 'Email Address', placeholder: 'jane@example.com', required: true, crmMapping: 'primary_email', width: 'full' },
    { id: 'f2', type: 'short_text', label: 'First Name', placeholder: 'Jane', crmMapping: 'first_name', width: 'full' },
    { id: 'f3', type: 'multi_select', label: 'Topics of Interest', options: ['Product Updates', 'Industry News', 'Tips & Tutorials', 'Case Studies', 'Events & Webinars'], width: 'full' },
    { id: 'f4', type: 'checkbox', label: 'I agree to receive marketing emails', description: 'You can unsubscribe at any time.', required: true, width: 'full' },
  ],
}

const quoteRequest: FormTemplate = {
  id: 'quote-request',
  name: 'Quote / Estimate Request',
  category: 'Lead Gen',
  description: 'Capture detailed project requirements for quote generation.',
  icon: 'FileText',
  popular: true,
  fields: [
    { id: 'f1', type: 'short_text', label: 'Full Name', placeholder: 'Jane Smith', required: true, crmMapping: 'display_name', width: 'half' },
    { id: 'f2', type: 'email', label: 'Email Address', placeholder: 'jane@example.com', required: true, crmMapping: 'primary_email', width: 'half' },
    { id: 'f3', type: 'phone', label: 'Phone Number', placeholder: '+1 (555) 000-0000', crmMapping: 'primary_phone', width: 'half' },
    { id: 'f4', type: 'short_text', label: 'Company Name', placeholder: 'Acme Inc.', crmMapping: 'company_name', width: 'half' },
    { id: 'f5', type: 'multi_select', label: 'Services Needed', required: true, options: ['Web Design', 'Web Development', 'Mobile App', 'SEO/SEM', 'Content Creation', 'Branding', 'Consulting'], width: 'full' },
    { id: 'f6', type: 'long_text', label: 'Project Description', placeholder: 'Describe your project in detail...', required: true, width: 'full' },
    { id: 'f7', type: 'select', label: 'Budget Range', options: ['Under $5,000', '$5,000 - $10,000', '$10,000 - $25,000', '$25,000 - $50,000', '$50,000+'], width: 'half' },
    { id: 'f8', type: 'select', label: 'Timeline', options: ['ASAP', '1-2 weeks', '1 month', '2-3 months', 'Flexible'], width: 'half' },
    { id: 'f9', type: 'select', label: 'How Did You Hear About Us?', options: ['Google Search', 'Social Media', 'Referral', 'Advertisement', 'Blog/Article', 'Other'], width: 'full' },
  ],
}

const eventRsvp: FormTemplate = {
  id: 'event-rsvp',
  name: 'Event RSVP',
  category: 'Application',
  description: 'Collect RSVPs for events with guest count and dietary preferences.',
  icon: 'PartyPopper',
  fields: [
    { id: 'f1', type: 'short_text', label: 'Full Name', placeholder: 'Jane Smith', required: true, crmMapping: 'display_name', width: 'half' },
    { id: 'f2', type: 'email', label: 'Email Address', placeholder: 'jane@example.com', required: true, crmMapping: 'primary_email', width: 'half' },
    { id: 'f3', type: 'number', label: 'Number of Guests', placeholder: '1', required: true, validation: { min: 1, max: 10 }, width: 'half' },
    { id: 'f4', type: 'multi_select', label: 'Dietary Requirements', options: ['None', 'Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut Allergy', 'Halal', 'Kosher'], width: 'half' },
    { id: 'f5', type: 'radio', label: 'Attendance Type', required: true, options: ['In-Person', 'Virtual'], width: 'full' },
    { id: 'f6', type: 'long_text', label: 'Questions or Comments', placeholder: 'Anything you\'d like to ask or share...', width: 'full' },
  ],
}

const jobApplication: FormTemplate = {
  id: 'job-application',
  name: 'Job Application',
  category: 'Application',
  description: 'Full job application form with resume upload and experience details.',
  icon: 'Briefcase',
  fields: [
    { id: 'f1', type: 'short_text', label: 'Full Name', placeholder: 'Jane Smith', required: true, crmMapping: 'display_name', width: 'half' },
    { id: 'f2', type: 'email', label: 'Email Address', placeholder: 'jane@example.com', required: true, crmMapping: 'primary_email', width: 'half' },
    { id: 'f3', type: 'phone', label: 'Phone Number', placeholder: '+1 (555) 000-0000', required: true, crmMapping: 'primary_phone', width: 'full' },
    { id: 'f4', type: 'select', label: 'Position Applied For', required: true, options: ['Software Engineer', 'Designer', 'Product Manager', 'Marketing Manager', 'Sales Representative', 'Customer Support', 'Other'], width: 'full' },
    { id: 'f5', type: 'short_text', label: 'LinkedIn Profile URL', placeholder: 'https://linkedin.com/in/janesmith', width: 'full' },
    { id: 'f6', type: 'number', label: 'Years of Experience', required: true, validation: { min: 0, max: 50 }, width: 'half' },
    { id: 'f7', type: 'file', label: 'Resume / CV', description: 'Upload your resume (PDF preferred)', required: true, width: 'half' },
    { id: 'f8', type: 'long_text', label: 'Cover Letter', placeholder: 'Tell us why you\'re a great fit...', width: 'full' },
    { id: 'f9', type: 'date', label: 'Earliest Start Date', required: true, width: 'half' },
    { id: 'f10', type: 'short_text', label: 'Salary Expectations', placeholder: '$80,000 - $100,000', width: 'half' },
  ],
}

const workshopRegistration: FormTemplate = {
  id: 'workshop-registration',
  name: 'Workshop Registration',
  category: 'Application',
  description: 'Registration form for workshops and training sessions with level selection.',
  icon: 'GraduationCap',
  fields: [
    { id: 'f1', type: 'short_text', label: 'Full Name', placeholder: 'Jane Smith', required: true, crmMapping: 'display_name', width: 'half' },
    { id: 'f2', type: 'email', label: 'Email Address', placeholder: 'jane@example.com', required: true, crmMapping: 'primary_email', width: 'half' },
    { id: 'f3', type: 'phone', label: 'Phone Number', placeholder: '+1 (555) 000-0000', crmMapping: 'primary_phone', width: 'full' },
    { id: 'f4', type: 'select', label: 'Session', required: true, options: ['Morning Session (9 AM - 12 PM)', 'Afternoon Session (1 PM - 4 PM)', 'Full Day (9 AM - 4 PM)', 'Evening Session (6 PM - 9 PM)'], width: 'full' },
    { id: 'f5', type: 'radio', label: 'Experience Level', required: true, options: ['Beginner', 'Intermediate', 'Advanced'], width: 'full' },
    { id: 'f6', type: 'select', label: 'How Did You Hear About This Workshop?', options: ['Email', 'Social Media', 'Website', 'Friend/Colleague', 'Other'], width: 'full' },
    { id: 'f7', type: 'long_text', label: 'Accessibility Needs', placeholder: 'Let us know if you have any accessibility requirements...', width: 'full' },
  ],
}

const serviceOrderForm: FormTemplate = {
  id: 'service-order',
  name: 'Service Order Form',
  category: 'Order',
  description: 'Accept service orders with quantity, scheduling, and special instructions.',
  icon: 'ShoppingCart',
  fields: [
    { id: 'f1', type: 'short_text', label: 'Full Name', placeholder: 'Jane Smith', required: true, crmMapping: 'display_name', width: 'half' },
    { id: 'f2', type: 'email', label: 'Email Address', placeholder: 'jane@example.com', required: true, crmMapping: 'primary_email', width: 'half' },
    { id: 'f3', type: 'phone', label: 'Phone Number', placeholder: '+1 (555) 000-0000', required: true, crmMapping: 'primary_phone', width: 'full' },
    { id: 'f4', type: 'select', label: 'Service', required: true, options: ['Basic Package', 'Standard Package', 'Premium Package', 'Enterprise Package', 'Custom'], width: 'full' },
    { id: 'f5', type: 'number', label: 'Quantity', required: true, validation: { min: 1, max: 100 }, width: 'half' },
    { id: 'f6', type: 'date', label: 'Preferred Start Date', required: true, width: 'half' },
    { id: 'f7', type: 'long_text', label: 'Special Instructions', placeholder: 'Any specific requirements or notes...', width: 'full' },
    { id: 'f8', type: 'checkbox', label: 'I agree to the terms and conditions', required: true, width: 'full' },
  ],
}

export const formTemplates: FormTemplate[] = [
  generalContactForm,
  clientOnboarding,
  consultationBooking,
  appointmentRequest,
  customerSatisfaction,
  postProjectReview,
  newsletterSignup,
  quoteRequest,
  eventRsvp,
  jobApplication,
  workshopRegistration,
  serviceOrderForm,
]

export function getFormTemplateById(id: string): FormTemplate | undefined {
  return formTemplates.find((t) => t.id === id)
}

export function getFormTemplatesByCategory(category: FormTemplate['category']): FormTemplate[] {
  return formTemplates.filter((t) => t.category === category)
}
