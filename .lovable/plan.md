## What Meta is asking for

The "Set endpoint URI" step wants a public **HTTPS URL** that Meta will POST to whenever your Flow needs data (screen loads, form submits, health checks). Meta encrypts every request with a public key you upload ("Sign public key"), and your endpoint must decrypt it, respond, and re-encrypt the reply. So we need to:

1. Build the endpoint in this app.
2. Generate an RSA keypair — upload the public key to Meta, store the private key as a secret here.
3. Paste the endpoint URL into that "https://example.com" field and Submit.

## Plan

### 1. Public endpoint route
Create `src/routes/api/public/whatsapp-flow.ts` (the `/api/public/*` prefix bypasses auth so Meta can reach it). It will:
- Accept `POST` with `{ encrypted_flow_data, encrypted_aes_key, initial_vector }`.
- Decrypt the AES key with our RSA private key (OAEP/SHA-256), then AES-GCM-decrypt the payload.
- Handle the three Meta actions: `ping` (health check → `{ data: { status: "active" } }`), `INIT` / `data_exchange` / `BACK` (return the next screen's data), and `error_notification` (log and ack).
- Re-encrypt the response with the same AES key + flipped IV, return as base64 text with `Content-Type: text/plain`.
- Also handle `GET` returning 200 so Meta's reachability check passes.

### 2. Keys & secrets
- Generate a 2048-bit RSA keypair locally (one-time script, printed to console).
- Store `WHATSAPP_FLOW_PRIVATE_KEY` (PEM) and optional `WHATSAPP_FLOW_PASSPHRASE` via the secrets tool.
- You paste the **public key** into Meta's "Sign public key" step.

### 3. Business logic hooks
For the sign-in flow specifically, the endpoint's `data_exchange` handler will:
- Receive the email/password (or OTP) the user submitted in the Flow.
- Call Supabase auth server-side to verify.
- Return either the next screen payload or an error message to display in WhatsApp.

Scope for this pass = wire up the endpoint + crypto + a stub sign-in handler that returns success/failure. Real session bridging into the web app (deep link, magic token) is a follow-up once Meta's side is green.

### 4. What you do in the Meta UI after this ships
1. Copy the published URL: `https://project--7df2497f-b533-4c73-9625-6a8b8820f55c.lovable.app/api/public/whatsapp-flow` — paste into the endpoint field, Submit.
2. Go to "Sign public key", paste the public key I'll print.
3. "Add phone number" / "Connect Meta app" — pick your WABA phone + app.
4. Click "Health check" — should turn green.

## Technical details
- Uses Node `crypto` (available in the Worker runtime with nodejs_compat).
- Response IV = bitwise NOT of request IV (Meta's spec).
- Version negotiation: return `{ version: "3.0" }` inside encrypted payload.
- No DB migration required for the endpoint itself; sign-in handler reuses existing `profiles` / auth.

## Out of scope
- Building the actual Flow JSON screens (you're doing that in Meta's Flow Builder).
- Deep-linking a WhatsApp-authenticated user into a web session (needs a separate signed-token exchange — plan separately).
- Sending the Flow message from your backend to a user's WhatsApp (needs WABA Cloud API credentials).
