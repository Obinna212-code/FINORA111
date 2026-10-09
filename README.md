# FINORA — by Kalu Obinna

FINORA personal finance app with Netlify Functions for Mono Sandbox bank connection.

## Netlify environment variables

Set these in Netlify (never commit the values to GitHub):

- `MONO_SECRET_KEY` — Mono Sandbox secret key
- `MONO_PUBLIC_KEY` — Mono Sandbox public key
- `MONO_WEBHOOK_SECRET` — Mono Sandbox webhook secret

For the secret key and webhook secret, mark them as secret values. Give the Functions scope and set a Production value.

## Mono webhook

`https://finorafinanceapp.netlify.app/.netlify/functions/mono-webhook`

## Deployment

Connect this repository to the `finorafinapp` Netlify project. Netlify will deploy the site and the functions in `netlify/functions/`.
