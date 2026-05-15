<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Authoritative docs for this project

When you need current API details, consult these BEFORE pattern-matching against your training data:

| Topic | Source |
|---|---|
| tldraw v3 | `https://tldraw.dev/llms.txt` (fetch first; the v3 API drift is real) |
| Gemini API / models | Skill: `gemini-api-dev` or `gemini-interactions-api` |
| Vercel AI SDK (`ai`, `@ai-sdk/google`) | Skill: `vercel:ai-sdk` |
| Next.js 16 | Skill: `vercel:nextjs`, plus local docs at `node_modules/next/dist/docs/` |

## Orchestrator model

The Gemini model for the orchestrator is **`gemini-3-flash-preview`**. Do not downgrade to `gemini-2.5-flash` or pick a different snapshot. If a call fails with "model not found", consult the gemini-api-dev skill and ask before swapping.
