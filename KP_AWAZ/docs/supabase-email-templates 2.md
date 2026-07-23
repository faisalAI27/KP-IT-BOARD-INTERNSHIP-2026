# Supabase email templates for KP AWAZ

These settings are configured manually in the hosted Supabase project. Keep real
SMTP credentials, service-role keys, recovery codes, and contributor email
addresses out of this repository.

## Confirm signup template

Open **Supabase → Authentication → Emails → Templates → Confirm signup**.

The message must visibly contain the six-digit token placeholder:

```text
{{ .Token }}
```

KP AWAZ uses that token for new-account email verification. Do not replace it
with `TokenHash` in the user-facing message.

## Reset password template

Open **Supabase → Authentication → Emails → Templates → Reset password**.

The message must visibly contain:

```text
{{ .Token }}
```

KP AWAZ verifies this six-digit value with Supabase using recovery verification
and then allows the verified recovery session to update the password. The code
and the new password are never sent to FastAPI.

## URL configuration

In **Authentication → URL Configuration**, keep the application Site URL and
redirect allow list aligned with each environment. Add only origins that are
actually used, for example:

- `http://localhost:4173/reset-password.html`
- `http://127.0.0.1:4173/reset-password.html`
- `http://<temporary-lan-host>:4173/reset-password.html` during supervised LAN testing
- `https://<production-host>/reset-password.html` for production

The frontend resolves the configured reset path against its current origin, so
it does not depend on a fixed LAN address. Production must use HTTPS.

## Email provider

Keep the hosted project’s email provider or custom SMTP configuration valid and
monitored. Use placeholders in documentation and deployment examples. Never put
the SMTP password, Supabase secret key, or administrator key in frontend source,
Git-tracked environment examples, or generated builds.
