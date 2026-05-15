<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Framework rule (COMPULSORY — from user)

Before writing code that touches a library, framework, SDK, or external API:
1. **Ask the user** what doc sources exist for it — `llms.txt`, a Claude skill, an SDK example app.
2. **Consult those sources first.** Never pattern-match from training data when authoritative docs exist.
3. **Update the table below** when you discover a new source so future agents inherit it.

This rule applies always, no exceptions.

---

# Authoritative docs for this project

When you need current API details, consult these BEFORE pattern-matching against your training data:

| Topic | Source |
|---|---|
| tldraw v3 | `https://tldraw.dev/llms.txt` (fetch first; the v3 API drift is real) |
| Gemini API / models | Skill: `gemini-api-dev` or `gemini-interactions-api` |
| Vercel AI SDK (`ai`, `@ai-sdk/google`) | Skill: `vercel:ai-sdk` |
| Next.js 16 | Skill: `vercel:nextjs`, plus local docs at `node_modules/next/dist/docs/` |
| Speechmatics realtime | `https://docs.speechmatics.com/llms.txt` + the official `nextjs-real-time-transcription` example at `github.com/speechmatics/speechmatics-js-sdk/tree/main/examples/nextjs-real-time-transcription`. **Use `@speechmatics/browser-audio-input` PCMRecorder (AudioWorklet) — NEVER `createScriptProcessor`.** |

## Orchestrator model

The Gemini model for the orchestrator is **`gemini-3-flash-preview`**. Do not downgrade to `gemini-2.5-flash` or pick a different snapshot. If a call fails with "model not found", consult the gemini-api-dev skill and ask before swapping.
