/** Persistent voice-streaming service scaffold. No provider connection is attempted without credentials. */
const port = Number(process.env.PORT ?? 4100);
if (!process.env.TELEPHONY_PROVIDER) {
  console.log(`[voice-worker] scaffold ready on port ${port}; TELEPHONY_PROVIDER is unset, so no calls or WebSocket sessions will be started.`);
}
// Integrate the selected provider's bidirectional audio protocol here. Keep this process separate
// from Vercel serverless functions; verify signatures and enforce consent before opening a session.
