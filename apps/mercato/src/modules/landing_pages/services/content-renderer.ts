import * as fs from 'fs'
import * as path from 'path'
import type { TemplateSchema, TemplateSection } from './template-parser'
import type { PageContent, SectionContent } from './ai-page-builder'

import { TEMPLATES_DIR } from './paths'

/**
 * Render a template with AI-generated content injected.
 * Returns the final HTML ready to serve.
 */
export function renderWithContent(
  schema: TemplateSchema,
  content: PageContent,
  options: { formAction?: string; pageTitle?: string } = {},
): string {
  const htmlPath = path.join(TEMPLATES_DIR, schema.templateId, 'index.html')
  let html = fs.readFileSync(htmlPath, 'utf-8')

  // Update page title
  if (options.pageTitle) {
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(options.pageTitle)}</title>`)
  }

  // Update brand name in nav
  if (content.brandName) {
    html = html.replace(
      /(<[^>]*class="[^"]*(?:nav-logo|logo|brand)[^"]*"[^>]*>)([\s\S]*?)(<\/[^>]+>)/gi,
      `$1${escapeHtml(content.brandName)}$3`
    )
    // Also update footer brand
    html = html.replace(/(&copy;\s*\d{4}\s*)([^<]+)/gi, `$1${escapeHtml(content.brandName)}`)
  }

  // Process each section
  for (const section of schema.sections) {
    const sectionContent = content.sections[section.id]
    if (!sectionContent) continue

    // Remove disabled sections
    if (!sectionContent.enabled) {
      html = removeSectionFromHtml(html, section)
      continue
    }

    // Inject field content
    html = injectSectionContent(html, section, sectionContent)
  }

  // Apply CSS variable overrides
  if (content.cssOverrides) {
    const overrides = Object.entries(content.cssOverrides)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n')
    if (overrides) {
      html = html.replace('</head>', `<style>:root {\n${overrides}\n}</style>\n</head>`)
    }
  }

  // Inject form handler
  if (options.formAction) {
    html = injectFormHandler(html, options.formAction)
  }

  return html
}

function removeSectionFromHtml(html: string, section: TemplateSection): string {
  // Try to find and remove the section including its comment
  const sectionHtml = section.html
  if (sectionHtml) {
    // Remove the section and any preceding comment
    const commentPattern = `<!--[^>]*${escapeRegex(section.name)}[^>]*-->\\s*`
    const regex = new RegExp(commentPattern + escapeRegex(sectionHtml.substring(0, 100)), 'i')
    const simpleRemoval = html.replace(sectionHtml, '')
    if (simpleRemoval !== html) return simpleRemoval
  }
  return html
}

function injectSectionContent(html: string, section: TemplateSection, content: SectionContent): string {
  const fields = content.fields || {}

  for (const field of section.fields) {
    const value = fields[field.key]
    if (value === undefined || value === null) continue

    switch (field.type) {
      case 'text':
        html = replaceFieldText(html, section, field.key, field.current, String(value))
        break
      case 'textarea':
        html = replaceFieldText(html, section, field.key, field.current, String(value))
        break
      case 'repeater':
        if (Array.isArray(value)) {
          html = replaceRepeaterContent(html, section, field.key, field.items || [], value)
        }
        break
    }
  }

  return html
}

function replaceFieldText(html: string, section: TemplateSection, fieldKey: string, currentText: string, newText: string): string {
  if (!currentText || !newText || currentText === newText) return html

  // Escape special regex chars in current text but be flexible with whitespace
  const escaped = escapeRegex(currentText).replace(/\s+/g, '\\s+')
  const regex = new RegExp(escaped, 'i')

  // First try exact match within the section's HTML area
  const replaced = html.replace(regex, escapeReplacement(newText))
  return replaced
}

function replaceRepeaterContent(
  html: string,
  section: TemplateSection,
  fieldKey: string,
  currentItems: Record<string, string>[],
  newItems: Record<string, any>[],
): string {
  if (currentItems.length === 0 || newItems.length === 0) return html

  // Strategy: Replace content of existing items, then duplicate/remove as needed
  // For simplicity, replace the text content of each existing item
  const minLen = Math.min(currentItems.length, newItems.length)

  for (let i = 0; i < minLen; i++) {
    const current = currentItems[i]
    const replacement = newItems[i]

    for (const [key, currentVal] of Object.entries(current)) {
      const newVal = replacement[key]
      if (newVal && currentVal && newVal !== currentVal) {
        const escaped = escapeRegex(currentVal).replace(/\s+/g, '\\s+')
        const regex = new RegExp(escaped, 'i')
        html = html.replace(regex, escapeReplacement(String(newVal)))
      }
    }
  }

  // If we have more new items than current, we'd need to duplicate DOM elements
  // For MVP, we work with the existing number of items
  // TODO: Handle adding/removing repeater items by cloning DOM patterns

  return html
}

function injectFormHandler(html: string, formAction: string): string {
  const script = `
<script>
(function() {
  document.querySelectorAll('form').forEach(function(form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var fd = new FormData(form);
      var data = {};
      fd.forEach(function(v, k) { data[k] = v; });

      var btn = form.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

      fetch('${formAction}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: data })
      })
      .then(function(r) { return r.json(); })
      .then(function(result) {
        if (result.ok) {
          var s = form.closest('[id]')?.querySelector('.form-success, [class*="success"]');
          if (s) { s.style.display = 'block'; s.classList.add('visible'); form.style.display = 'none'; }
          else { form.innerHTML = '<div style="text-align:center;padding:24px;"><h3 style="margin-bottom:8px;">Thank you!</h3><p>' + (result.message || 'We\\'ll be in touch.') + '</p></div>'; }
        }
      })
      .catch(function() {
        if (btn) { btn.disabled = false; btn.textContent = 'Try Again'; }
      });
    });
  });
})();
</script>`

  // Remove existing form handlers
  html = html.replace(/function handleSubmit[\s\S]*?(?=<\/script>)/, '')
  html = html.replace(/onsubmit="[^"]*"/gi, '')

  html = html.replace('</body>', `${script}\n</body>`)
  return html
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeReplacement(str: string): string {
  return str.replace(/\$/g, '$$$$')
}
