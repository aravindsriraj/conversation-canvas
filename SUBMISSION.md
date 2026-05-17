# lablab.ai Submission — paste-ready fields

Everything below is structured to map 1:1 to the lablab.ai submission form
(Basic Information, Cover Image and Presentation, App Hosting & Code
Repository). Copy each section into the matching field.

---

## Basic Information

### Project Title

```
Conversation Canvas
```

### Short Description

```
A voice-first thinking canvas. Talk through a decision, plan, or problem; what you say becomes typed cards you can refine by voice or chat.
```

### Long Description

```
Conversation Canvas is a real-time, voice-first thinking canvas. Talk through anything you're chewing on — a decision, a plan, a problem you're working out — and the canvas catches what matters as you speak. Proposals, decisions, commitments, blockers, and open questions appear as typed cards, connected by the relationships you spoke aloud. By the end you have a navigable artifact of how you reasoned through the problem, not an hour of audio you'll never replay.

Most voice tools fall into three buckets: voice memos give you audio nobody re-listens to; transcripts give you walls of text nobody reads twice; chat-with-an-AI gives you a scrolling log that loses the structure of the actual reasoning. Conversation Canvas gives you a typed, navigable graph — drawn live, editable by voice or chat, and waiting where you left it next week.

The product runs two AI surfaces over the same 28-action vocabulary. The voice orchestrator listens passively and emits cards autonomously every ~3 seconds. The chat agent is an interactive multi-step reasoner — you can type "delete the question if it's been answered, otherwise add a deadline" and it will read the canvas, plan, and act in sequence (up to four reasoning steps per turn). Both share a long-term memory that persists across sessions: re-open a canvas tomorrow and the system still remembers what you talked through.

Beyond the five thinking-card types, the canvas understands everything you'd draw on a whiteboard: sticky notes, geometric shapes (rectangle, ellipse, triangle, diamond, star, heart, check-box, and 12 more), free-form arrows, priority matrices, budget allocators, alignment, deletion, recolor — anything you'd do with the mouse, you can do by asking, in voice or text.

Built end-to-end in 5 days for Milan AI Week 2026. Stack: Speechmatics for real-time speech-to-text; Gemini 3 Flash via Vercel AI SDK for the orchestrator and chat agent (the latter built on the SDK's ToolLoopAgent primitive); Gemini 3.1 Flash Lite for async memory compression; tldraw v3 for the canvas; Next.js 16 + custom WS server for live sync; Clerk for production auth; Neon Postgres for persistence (action history, chat turns, summarized memory); deployed on a Vultr VM at https://canvas.ai-application.xyz with Let's Encrypt TLS.
```

### Technology Tags

Paste these (comma-separated, or pick whichever the form accepts):

```
Gemini, Speechmatics, Next.js, tldraw, Vercel AI SDK, Clerk, Neon Postgres, TypeScript, React, WebSocket, Real-time, Voice AI
```

### Category Tags

```
Productivity, AI Agents, Voice AI, Thinking Tools, Knowledge Management
```

---

## Cover Image and Presentation

### Cover Image

File: `public/lablab-cover.jpg` (1920×1080, 16:9, 93 KB) — branded
social-card cover, same composition as the GitHub README banner but
sized for lablab's 16:9 cover-image slot.

Direct URL after push:
```
https://github.com/aravindsriraj/conversation-canvas/raw/main/public/lablab-cover.jpg
```

(The GitHub README banner at `public/banner.jpg` is the same artwork
at 2:1 — use whichever the upload widget prefers.)

### Video Presentation

File: `public/hero.mp4` (90 seconds, 1920×1080, 30fps, h264, 6.5 MB)

Direct URL after push:
```
https://github.com/aravindsriraj/conversation-canvas/raw/main/public/hero.mp4
```

Or upload to YouTube/Vimeo as the form requires and paste that URL.

### Slide Presentation

File: `public/pitch-deck.pptx` (10 slides, Scriptorium aesthetic)

Direct URL after push:
```
https://github.com/aravindsriraj/conversation-canvas/raw/main/public/pitch-deck.pptx
```

Or upload to Google Slides / SlideShare as the form requires.

---

## App Hosting & Code Repository

### Public GitHub Repository

```
https://github.com/aravindsriraj/conversation-canvas
```

### Demo Application Platform

```
Vultr (VM, Bangalore region) · nginx + Let's Encrypt TLS · pm2-managed Node process
```

### Application URL

```
https://canvas.ai-application.xyz
```

---

## Notes for the judge / reader

If you want to try the product fast, **the live URL works end-to-end**: sign in with Google or email (production Clerk keys, no dev banner), create a canvas, hit the "Listen" mic in the toolbar, and start talking out loud about something you're chewing on. Cards should appear within ~3-5 seconds of each substantive utterance. You can also click "Ask AI" in the toolbar to type instructions directly.

A reference script (for trying voice deterministically) — think out loud as one person, speaking these in sequence:

1. "Okay, planning Q3. First proposal — focus on the Lisbon SMB market."
2. "Counter-argument: pursue Berlin enterprise instead. Higher contract value."
3. "Locking it in — the decision is Berlin enterprise this quarter, contingent on SOC 2 by July 15."
4. "I'm committing to landing one signed Berlin pilot by end of August."
5. "Blocker — we need to hire a senior backend engineer first."
6. "Add a yellow sticky for the post-Q3 review."
7. "Rank these by impact and effort."

By the end the canvas should have: 2 proposal cards with a `counters` arrow, 1 decision (locked, with `decides` arrows back to both proposals), 1 commitment, 1 blocker, 1 yellow sticky, and 1 priority matrix.
