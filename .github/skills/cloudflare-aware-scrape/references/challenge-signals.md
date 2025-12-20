# Cloudflare Challenge Signals

Use these to decide whether you are seeing a challenge page instead of real content.

## Strong signals
- Page title contains: "Just a moment...", "Checking your browser", "Verify you are human"
- HTML includes `/cdn-cgi/` or `challenges.cloudflare.com`
- Meta robots: `noindex,nofollow`
- Body includes phrases like "needs to review the security of your connection"

## Weak signals
- Minimal DOM with only a spinner or verification text
- Very small HTML size compared to expected content
- Redirect loops to `__cf_chl_*` query params
