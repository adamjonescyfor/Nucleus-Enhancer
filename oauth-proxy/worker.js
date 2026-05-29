// CYFOR OAuth Proxy — Cloudflare Worker
//
// Holds Consumer Key and Secret as Cloudflare secrets.
// The Chrome extension calls this proxy; it never sees those credentials.
//
// Deploy secrets (run once after deploying):
//   wrangler secret put SF_CLIENT_ID       ← your Consumer Key
//   wrangler secret put SF_CLIENT_SECRET   ← your Consumer Secret
//   wrangler secret put SF_INSTANCE_URL    ← e.g. https://cyfor.my.salesforce.com

export default {
    async fetch(request, env) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
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

async function handleAuthUrl(request, env, corsHeaders) {
    const { codeChallenge, redirectUri } = await request.json();
    if (!codeChallenge || !redirectUri) {
        return Response.json({ error: 'Missing codeChallenge or redirectUri' }, { status: 400, headers: corsHeaders });
    }

    const authUrl = new URL('/services/oauth2/authorize', env.SF_INSTANCE_URL);
    authUrl.searchParams.set('response_type',         'code');
    authUrl.searchParams.set('client_id',             env.SF_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri',          redirectUri);
    authUrl.searchParams.set('scope',                 'api refresh_token');
    authUrl.searchParams.set('code_challenge',        codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('prompt',                'login');

    return Response.json({ url: authUrl.toString() }, { headers: corsHeaders });
}

async function handleToken(request, env, corsHeaders) {
    const { code, codeVerifier, redirectUri } = await request.json();
    if (!code || !codeVerifier || !redirectUri) {
        return Response.json({ error: 'Missing code, codeVerifier, or redirectUri' }, { status: 400, headers: corsHeaders });
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
    const { refreshToken } = await request.json();
    if (!refreshToken) {
        return Response.json({ error: 'Missing refreshToken' }, { status: 400, headers: corsHeaders });
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
    const { token, instanceUrl } = await request.json();
    if (!token) {
        return Response.json({ error: 'Missing token' }, { status: 400, headers: corsHeaders });
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
