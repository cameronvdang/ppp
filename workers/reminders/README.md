# PPP email reminders (M3)

Opt-in, hardened: stores only `{email, sendTimes[]}`. Every message is generic
— "You have a reminder in PPP" — with **no health terms, ever** (enforced by
a test over templates). Send times are fixed user-chosen clock times, never
cycle-timed, so timing correlates with nothing. One-click unsubscribe deletes
the row. Cloudflare Worker cron + Resend.
