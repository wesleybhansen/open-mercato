import { NextResponse } from 'next/server'

const SYSTEM_PROMPT = `You are a helpful AI assistant built into a CRM platform designed for solopreneurs and small businesses. Your job is to help users navigate the app, answer questions, and suggest actions.

THE CRM HAS THESE FEATURES:

1. **Contacts** (sidebar → Contacts)
   - Add people and companies you work with
   - Track their email, phone, tags, and notes
   - View activity timeline (emails, form submissions, deals)
   - To add a contact: click "Contacts" → click the "+" or "New" button

2. **Pipeline** (sidebar → Pipeline)
   - Visual Kanban board showing your deals/opportunities
   - Drag deals between stages: Lead → Contacted → Qualified → Proposal → Won/Lost
   - Each deal has a value, contact, and expected close date
   - To create a deal: click "Pipeline" → click "New" or "+"

3. **Landing Pages** (sidebar → Landing Pages)
   - Create professional landing pages using AI
   - Pick a template style → fill in your business details → AI writes the copy
   - Published pages capture leads directly into your contacts
   - Forms on landing pages automatically create new contacts in your CRM
   - To create a page: click "Landing Pages" → "New Page"

4. **Email** (sidebar → Email)
   - Send and receive emails linked to contacts
   - Track opens and clicks
   - To send an email: click "Email" → "Compose"

5. **Dashboard** (sidebar → Dashboard)
   - Overview of your contacts, deals, and landing page performance
   - Quick action buttons to add contacts, create pages, etc.

NAVIGATION:
- The sidebar on the left has all the main sections
- Click your profile icon (top right) for settings, theme toggle, and logout
- Use Cmd+K (Mac) or Ctrl+K (Windows) to search anything

ANSWERING RULES:
- Be concise and friendly. These are busy entrepreneurs, not technical users.
- When explaining how to do something, give step-by-step instructions.
- Reference specific sidebar items and buttons by name.
- If asked about a feature that doesn't exist yet, say "That feature is coming soon!" rather than making something up.
- If asked about advanced features (workflows, team management, etc.), mention they can switch to Advanced mode in Settings.
- Keep responses under 3-4 sentences unless the user asks for detailed help.
- Use markdown for formatting when helpful (bold for button names, lists for steps).`

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { messages, currentPage } = body

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ ok: false, error: 'messages required' }, { status: 400 })
    }

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) {
      return NextResponse.json({
        ok: true,
        message: "I'm the AI assistant, but my API key isn't configured yet. I can still help with basic navigation — what are you looking for?",
      })
    }

    // Add page context to the conversation
    const contextMessage = currentPage
      ? `[The user is currently on the ${currentPage} page]`
      : ''

    const model = process.env.AI_MODEL || 'gemini-2.0-flash'
    const contents = messages.map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    if (contextMessage) {
      // Prepend context to the first user message
      if (contents.length > 0 && contents[0].role === 'user') {
        contents[0].parts[0].text = contextMessage + '\n\n' + contents[0].parts[0].text
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        }),
        signal: controller.signal,
      }
    )
    clearTimeout(timeout)

    const data = await response.json()
    if (data.error) {
      if (data.error.message?.includes('Resource exhausted')) {
        return NextResponse.json({
          ok: true,
          message: "I'm a bit busy right now. Try again in 30 seconds, or I can help with basic navigation questions without AI. What do you need?",
        })
      }
      return NextResponse.json({ ok: false, error: data.error.message }, { status: 500 })
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't process that. Try rephrasing your question."

    return NextResponse.json({ ok: true, message: text })
  } catch (error) {
    console.error('[ai.assistant]', error)
    return NextResponse.json({ ok: false, error: 'Assistant error' }, { status: 500 })
  }
}
