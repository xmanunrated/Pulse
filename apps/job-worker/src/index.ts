/** Queue worker scaffold. Set REDIS_URL only after choosing a hosted Redis provider. */
if (!process.env.REDIS_URL) {
  console.log('[job-worker] scaffold ready; REDIS_URL is unset, so no queue consumer was started.');
} else {
  console.log('[job-worker] Redis configured. Implement bounded retries, idempotency and consent re-check before dispatch.');
}
