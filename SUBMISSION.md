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
A voice-driven canvas that turns your meeting into a structured document — live. Then keeps shaping itself by voice or chat.
```

### Long Description

```
Conversation Canvas is a real-time, voice-driven canvas that turns meetings into structured documents while you talk. Speak naturally; the canvas catches what matters — proposals, decisions, commitments, blockers, open questions — and draws them as cards connected by the relationships you spoke aloud. By the end of the call you have a navigable graph of what was decided, not a wall of transcript nobody will re-read.

Every meeting tool today falls into one of three buckets: recorders give you hours of audio you'll never replay; transcripts give you walls of text; AI summaries give you paragraphs of prose that lose the structure of the actual conversation. Conversation Canvas gives you a typed, navigable graph — drawn live, editable by voice or chat, and waiting where you left it next week.

The product runs two AI surfaces over the same 28-action vocabulary. The voice orchestrator listens passively to the meeting and emits cards autonomously. The chat agent is an interactive multi-step reasoner — you can type "delete the question if it's been answered, otherwise add a deadline" and it will read the canvas, decide what to do, and act in sequence. Both share a long-term memory that persists across sessions: re-open a canvas tomorrow and the system still remembers what you discussed.

Beyond the five meeting card types, the canvas understands everything you'd draw on a whiteboard: sticky notes, geometric shapes (rectangle, ellipse, triangle, diamond, star, heart, check-box, and 12 more), free-form arrows, priority matrices, budget allocators, alignment, deletion, recolor — anything you'd do with the mouse, you can do by asking, in voice or text.

Built end-to-end in 5 days for Milan AI Week 2026. Stack: Speechmatics for real-time speech-to-text; Gemini 3 Flash via Vercel AI SDK for the orchestrator and chat agent; Gemini 3.1 Flash Lite for async memory compression; tldraw v3 for the canvas; Next.js 16 + custom WS server for live sync; Clerk for production auth; Neon Postgres for persistence (action history, chat turns, summarized memory); deployed on a Vultr VM at https://canvas.ai-application.xyz with Let's Encrypt TLS.
```

### Technology Tags

Paste these (comma-separated, or pick whichever the form accepts):

```
Gemini, Speechmatics, Next.js, tldraw, Vercel AI SDK, Clerk, Neon Postgres, TypeScript, React, WebSocket, Real-time, Voice AI
```

### Category Tags

```
Productivity, AI Agents, Voice AI, Collaboration, Knowledge Management
```

---

## Cover Image and Presentation

### Cover Image

File: `public/cover.jpg` (1920×1080, 88 KB)

Direct URL after push:
```
https://github.com/aravindsriraj/conversation-canvas/raw/main/public/cover.jpg
```

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

If you want to try the product fast, **the live URL works end-to-end**: sign in with Google or email (production Clerk keys, no dev banner), create a canvas, hit the "Listen" mic in the toolbar, and start talking. Cards should appear within ~3-5 seconds of each substantive utterance. You can also click "Ask AI" in the toolbar to type instructions directly.

A reference script (for trying voice deterministically): see the README's "How it works" section, or speak any of these in sequence:

1. "I think we should target enterprise customers in Q3."
2. "Or SMB — three times higher conversion."
3. "OK, agreed. Let's go SMB."
4. "Alice will own it by next Friday."
5. "Add a yellow sticky for the post-Q3 review."
6. "Rank these by impact and effort."
7. "Make the blocker red and align the cards to the left."

By the end the canvas should have: 2 proposal cards with a `counters` arrow, 1 decision (locked, with `decides` arrows back to both proposals), 1 commitment (Alice, by next Friday), 1 yellow sticky, 1 priority matrix, and all cards aligned to the left.
