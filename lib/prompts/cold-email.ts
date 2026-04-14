/**
 * Cold email generation prompt.
 * Inputs: niche, offer, tone, goal, company
 * Output: { subject, body }
 */

export const COLD_EMAIL_PROMPT = `Write a short cold email for a business owner.

Rules:
- Keep it under 90 words
- Sound natural, casual, and human
- Do not sound corporate or spammy
- Do not use hypey marketing words
- Do not use em dashes
- Start with a short opener
- Mention the company or niche naturally
- End with a low-pressure question
- Make it feel like a real person wrote it

Inputs:
Niche: {{niche}}
Offer: {{offer}}
Tone: {{tone}}
Goal: {{goal}}
Company: {{company}}

Return JSON:
{
  "subject": "...",
  "body": "..."
}`
