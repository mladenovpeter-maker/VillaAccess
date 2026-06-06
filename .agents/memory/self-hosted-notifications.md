---
name: Self-hosted notifications (email/SMTP)
description: Why guest email and any outbound notifications use self-hosted SMTP, not Replit integrations.
---

Outbound notifications (e.g. guest reservation email with PIN + QR) must use self-hosted
SMTP via nodemailer, configured through `SMTP_*` env vars in the user's `.env.docker`.

**Why:** The app runs on the user's own LAN Docker server (~/VillaAccess), NOT on Replit.
Replit integrations (managed email/AI proxies, connectors) only work inside Replit's
runtime and will silently fail on the user's box. So do not reach for Replit email
integrations for this project.

**How to apply:** Gate any send behind an `isEmailConfigured()`-style check (presence of
SMTP_HOST + SMTP_FROM). Expose a `*-status` endpoint so the UI can disable the action when
unconfigured. Render times with an explicit timezone (DISPLAY_TIMEZONE, default Europe/Sofia)
since the server clock is UTC. HTML-escape any guest-supplied text in templates.
