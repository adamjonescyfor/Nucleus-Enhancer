// CYFOR OAuth Proxy — Cloudflare Worker
//
// Holds Consumer Key and Secret as Cloudflare secrets.
// The Chrome extension calls this proxy; it never sees those credentials.
//
// Deploy secrets (run once after deploying):
//   wrangler secret put SF_CLIENT_ID       ← your Consumer Key
//   wrangler secret put SF_CLIENT_SECRET   ← your Consumer Secret
//   wrangler secret put SF_INSTANCE_URL    ← e.g. https://cyfor.my.salesforce.com
//
// Hardening layers (all configured in wrangler.toml [vars] / [[ratelimits]]):
//   - ALLOWED_ORIGIN            CORS lock to the extension's chrome-extension:// origin
//   - ALLOWED_REDIRECT_PREFIX   server-side check that redirect_uri is *our* extension's
//                               chromiumapp.org callback (works against non-browser callers too)
//   - MIN_CLIENT_VERSION        optional floor on the extension's reported version ("" = off)
//   - RATE_LIMITER              optional native per-IP rate-limit binding (fails open if absent)
// None of these is a complete access control on its own; the real guarantees are that the
// Consumer Secret never leaves Cloudflare and /token & /refresh require a valid Salesforce
// authorization code / refresh token that an attacker cannot forge.

const MAX_FIELD = 8192;

export default {
    async fetch(request, env) {
        // ── CORS: reflect only the allow-listed extension origin ──
        const origin  = request.headers.get('Origin') || '';
        const allowed = env.ALLOWED_ORIGIN || '';
        const allowOrigin = allowed ? (origin === allowed ? allowed : '') : '*';

        const corsHeaders = {
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Client-Version',
            'Vary': 'Origin',
        };
        if (allowOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowOrigin;

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        // ── Optional client-version gate (operational control; spoofable) ──
        if (!clientVersionAllowed(request, env)) {
            return badReq('Client version not supported — please update the extension.', corsHeaders, 426);
        }

        // ── Optional per-IP rate limit (fails open if the binding is absent) ──
        if (!(await rateLimitOk(request, env))) {
            return Response.json({ error: 'Rate limit exceeded — try again shortly.' },
                { status: 429, headers: corsHeaders });
        }

        const url = new URL(request.url);

        try {
            if (url.pathname === '/auth-url')  return handleAuthUrl(request, env, corsHeaders);
            if (url.pathname === '/token')     return handleToken(request, env, corsHeaders);
            if (url.pathname === '/refresh')   return handleRefresh(request, env, corsHeaders);
            if (url.pathname === '/revoke')    return handleRevoke(request, env, corsHeaders);
        } catch (err) {
            return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
        }

        return new Response('Not found', { status: 404 });
    }
};

// ── Validation helpers ──────────────────────────────────────────────────────

function isStr(v, max) {
    return typeof v === 'string' && v.length > 0 && v.length <= (max || MAX_FIELD);
}

function badReq(msg, corsHeaders, status) {
    return Response.json({ error: msg }, { status: status || 400, headers: corsHeaders });
}

async function readJson(request) {
    try { return await request.json(); } catch (_) { return null; }
}

// redirect_uri must be our extension's chromiumapp.org callback (when configured).
function redirectAllowed(redirectUri, env) {
    const prefix = (env.ALLOWED_REDIRECT_PREFIX || '').trim();
    if (!prefix) return true;
    return typeof redirectUri === 'string' && redirectUri.startsWith(prefix);
}

function clientVersionAllowed(request, env) {
    const min = (env.MIN_CLIENT_VERSION || '').trim();
    if (!min) return true; // gate disabled
    return versionGte((request.headers.get('X-Client-Version') || '').trim(), min);
}

function versionGte(v, min) {
    const a = String(v).split('.').map((n) => parseInt(n, 10) || 0);
    const b = String(min).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        const x = a[i] || 0, y = b[i] || 0;
        if (x > y) return true;
        if (x < y) return false;
    }
    return true;
}

async function rateLimitOk(request, env) {
    if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== 'function') return true;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    try {
        const { success } = await env.RATE_LIMITER.limit({ key: ip });
        return success !== false;
    } catch (_) {
        return true; // never block legit users if the limiter itself errors
    }
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleAuthUrl(request, env, corsHeaders) {
    const body = await readJson(request);
    if (!body) return badReq('Invalid JSON body', corsHeaders);
    const { codeChallenge, redirectUri, state } = body;

    if (!isStr(codeChallenge, 256) || !isStr(redirectUri, 2048)) {
        return badReq('Missing or invalid codeChallenge / redirectUri', corsHeaders);
    }
    if (!redirectAllowed(redirectUri, env)) {
        return badReq('redirectUri not allowed', corsHeaders, 403);
    }

    const authUrl = new URL('/services/oauth2/authorize', env.SF_INSTANCE_URL);
    authUrl.searchParams.set('response_type',         'code');
    authUrl.searchParams.set('client_id',             env.SF_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri',          redirectUri);
    authUrl.searchParams.set('scope',                 'api refresh_token');
    authUrl.searchParams.set('code_challenge',        codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('prompt',                'login');
    // CSRF state: Salesforce echoes this back in the callback, where the extension
    // verifies it matches what it sent. Optional, so older clients still work.
    if (isStr(state, 256)) authUrl.searchParams.set('state', state);

    return Response.json({ url: authUrl.toString() }, { headers: corsHeaders });
}

async function handleToken(request, env, corsHeaders) {
    const body = await readJson(request);
    if (!body) return badReq('Invalid JSON body', corsHeaders);
    const { code, codeVerifier, redirectUri } = body;

    if (!isStr(code, 4096) || !isStr(codeVerifier, 256) || !isStr(redirectUri, 2048)) {
        return badReq('Missing or invalid code / codeVerifier / redirectUri', corsHeaders);
    }
    if (!redirectAllowed(redirectUri, env)) {
        return badReq('redirectUri not allowed', corsHeaders, 403);
    }

    const params = new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     env.SF_CLIENT_ID,
        client_secret: env.SF_CLIENT_SECRET,
        code,
        code_verifier: codeVerifier,
        redirect_uri:  redirectUri,
    });

    const sfRes = await fetch(`${env.SF_INSTANCE_URL}/services/oauth2/token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    params.toString(),
    });

    const data = await sfRes.json();
    if (!sfRes.ok) {
        return Response.json({ error: data.error_description || data.error || 'Token exchange failed' },
            { status: 400, headers: corsHeaders });
    }

    return Response.json(data, { headers: corsHeaders });
}

async function handleRefresh(request, env, corsHeaders) {
    const body = await readJson(request);
    if (!body) return badReq('Invalid JSON body', corsHeaders);
    const { refreshToken } = body;

    if (!isStr(refreshToken, 8192)) {
        return badReq('Missing or invalid refreshToken', corsHeaders);
    }

    const params = new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     env.SF_CLIENT_ID,
        client_secret: env.SF_CLIENT_SECRET,
        refresh_token: refreshToken,
    });

    const sfRes = await fetch(`${env.SF_INSTANCE_URL}/services/oauth2/token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    params.toString(),
    });

    const data = await sfRes.json();
    if (!sfRes.ok) {
        return Response.json({ error: data.error_description || data.error || 'Refresh failed' },
            { status: 400, headers: corsHeaders });
    }

    return Response.json({
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_in:    data.expires_in,
        instance_url:  data.instance_url,
    }, { headers: corsHeaders });
}

async function handleRevoke(request, env, corsHeaders) {
    const body = await readJson(request);
    if (!body) return badReq('Invalid JSON body', corsHeaders);
    const { token, instanceUrl } = body;

    if (!isStr(token, 8192)) {
        return badReq('Missing or invalid token', corsHeaders);
    }
    if (instanceUrl && !/^https:\/\/[a-z0-9.-]+\.(salesforce\.com|force\.com)\/?/i.test(instanceUrl)) {
        return badReq('Invalid instanceUrl', corsHeaders);
    }

    const base = (instanceUrl || env.SF_INSTANCE_URL).replace(/\/$/, '');
    try {
        await fetch(`${base}/services/oauth2/revoke`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({ token }),
        });
    } catch (_) { /* best-effort */ }

    return Response.json({ ok: true }, { headers: corsHeaders });
}
