// Next.js 16 renamed `middleware.ts` to `proxy.ts`. Clerk's middleware runs on
// every matched request, attaches auth context to `headers()` so server
// components / API routes can read it via `auth()` from '@clerk/nextjs/server'.
//
// The matcher is the standard Clerk recommendation, lifted verbatim: skip Next
// internals and static assets, but always include API routes (where `auth()`
// must work for our /api/canvases endpoints).
import { clerkMiddleware } from '@clerk/nextjs/server'

export default clerkMiddleware()

export const config = {
	matcher: [
		'/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
		'/(api|trpc)(.*)',
	],
}
