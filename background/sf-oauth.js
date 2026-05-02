// ==================================================
// CYFOR Nucleus Enhancer — Salesforce OAuth 2.0 (PKCE)
// Handles token acquisition, refresh, and revocation.
// Exported as self.SfOAuth for use by background.js.
// ==================================================

(function () {

var TOKENS_KEY  = 'sfOAuthTokens';
var CONFIG_KEY  = 'sfOAuthConfig';
var USER_KEY    = 'sfOAuthUser';
var EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function base64urlEncode(uint8Array) {
    var chunkSize = 0x8000;
    var binary = '';
    for (var i = 0; i < uint8Array.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length)));
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function generateCodeVerifier() {
    var array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64urlEncode(array);
}

async function generateCodeChallenge(verifier) {
    var encoder = new TextEncoder();
    var data = encoder.encode(verifier);
    var digest = await crypto.subtle.digest('SHA-256', data);
    return base64urlEncode(new Uint8Array(digest));
}

// ── Token storage ─────────────────────────────────────────────────────────────

async function storeTokens(tokens) {
    var payload = {};
    payload[TOKENS_KEY] = tokens;
    await chrome.storage.local.set(payload);
}

async function getTokens() {
    var result = await chrome.storage.local.get(TOKENS_KEY);
    return result[TOKENS_KEY] || null;
}

// ── Core OAuth flow ───────────────────────────────────────────────────────────

async function launchOAuthFlow() {
    var result = await chrome.storage.local.get(CONFIG_KEY);
    var config = result[CONFIG_KEY] || {};

    if (!config.clientId || !config.instanceUrl) {
        throw new Error('NOT_CONFIGURED');
    }

    var clientId    = config.clientId.trim();
    var instanceUrl = config.instanceUrl.replace(/\/$/, '');
    var redirectUrl = chrome.identity.getRedirectURL('sf-oauth');

    var codeVerifier  = await generateCodeVerifier();
    var codeChallenge = await generateCodeChallenge(codeVerifier);

    var authUrl = new URL(instanceUrl + '/services/oauth2/authorize');
    authUrl.searchParams.set('response_type',          'code');
    authUrl.searchParams.set('client_id',              clientId);
    authUrl.searchParams.set('redirect_uri',           redirectUrl);
    authUrl.searchParams.set('scope',                  'api refresh_token');
    authUrl.searchParams.set('code_challenge',         codeChallenge);
    authUrl.searchParams.set('code_challenge_method',  'S256');
    authUrl.searchParams.set('prompt',                 'login');

    var responseUrl = await chrome.identity.launchWebAuthFlow({
        url:         authUrl.toString(),
        interactive: true
    });

    var parsed = new URL(responseUrl);
    var error  = parsed.searchParams.get('error');
    if (error) {
        throw new Error('SF_AUTH_ERROR: ' + error + ' — ' + (parsed.searchParams.get('error_description') || ''));
    }

    var code = parsed.searchParams.get('code');
    if (!code) throw new Error('No authorization code in callback URL');

    var tokens = await exchangeCodeForTokens(instanceUrl, clientId, code, codeVerifier, redirectUrl);
    await storeTokens(tokens);

    var user = await fetchSalesforceUserInfo(tokens.instanceUrl || instanceUrl, tokens.accessToken);
    var userPayload = {};
    userPayload[USER_KEY] = user;
    await chrome.storage.local.set(userPayload);

    return { ok: true, user: user };
}

async function exchangeCodeForTokens(instanceUrl, clientId, code, codeVerifier, redirectUri) {
    var body = new URLSearchParams({
        grant_type:    'authorization_code',
        code:          code,
        client_id:     clientId,
        redirect_uri:  redirectUri,
        code_verifier: codeVerifier
    });

    var response = await fetch(instanceUrl + '/services/oauth2/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString()
    });

    if (!response.ok) {
        var err = await response.json().catch(function () { return {}; });
        throw new Error('Token exchange failed: ' + (err.error_description || response.status));
    }

    var data = await response.json();
    return {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        tokenType:    data.token_type || 'Bearer',
        expiresAt:    Date.now() + (data.expires_in ? data.expires_in * 1000 : 7200 * 1000),
        instanceUrl:  data.instance_url || instanceUrl
    };
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshAccessToken() {
    var results = await chrome.storage.local.get([CONFIG_KEY, TOKENS_KEY]);
    var config  = results[CONFIG_KEY] || {};
    var tokens  = results[TOKENS_KEY] || {};

    if (!tokens.refreshToken) throw new Error('NO_REFRESH_TOKEN');
    if (!config.clientId)     throw new Error('NOT_CONFIGURED');

    var instanceUrl = (tokens.instanceUrl || config.instanceUrl || '').replace(/\/$/, '');

    var body = new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id:     config.clientId.trim()
    });

    var response = await fetch(instanceUrl + '/services/oauth2/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString()
    });

    if (!response.ok) {
        if (response.status === 400 || response.status === 401) {
            await chrome.storage.local.remove([TOKENS_KEY, USER_KEY, 'sfRemoteTemplates', 'sfTemplatesSyncedAt']);
            throw new Error('REFRESH_TOKEN_EXPIRED');
        }
        var err = await response.json().catch(function () { return {}; });
        throw new Error('Token refresh failed: ' + (err.error_description || response.status));
    }

    var data = await response.json();
    var updated = Object.assign({}, tokens, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || tokens.refreshToken,
        expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 7200 * 1000)
    });

    await storeTokens(updated);
    return updated.accessToken;
}

async function getValidAccessToken() {
    var tokens = await getTokens();
    if (!tokens || !tokens.accessToken) throw new Error('NOT_AUTHENTICATED');

    if (tokens.expiresAt && Date.now() > (tokens.expiresAt - EXPIRY_BUFFER_MS)) {
        return refreshAccessToken();
    }
    return tokens.accessToken;
}

// ── User info ─────────────────────────────────────────────────────────────────

async function fetchSalesforceUserInfo(instanceUrl, accessToken) {
    var response = await fetch(instanceUrl + '/services/oauth2/userinfo', {
        headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if (!response.ok) throw new Error('userinfo failed: ' + response.status);

    var data = await response.json();
    return {
        id:          data.user_id || data.sub || '',
        fullName:    data.name || '',
        email:       data.email || '',
        username:    data.preferred_username || '',
        orgId:       data.organization_id || '',
        instanceUrl: instanceUrl,
        photoUrl:    (data.photos && data.photos.thumbnail) || data.picture || ''
    };
}

// ── Disconnect ────────────────────────────────────────────────────────────────

async function disconnectOAuth() {
    var results = await chrome.storage.local.get([TOKENS_KEY, CONFIG_KEY]);
    var tokens  = results[TOKENS_KEY];
    var config  = results[CONFIG_KEY] || {};

    await chrome.storage.local.remove([TOKENS_KEY, USER_KEY, 'sfRemoteTemplates', 'sfTemplatesSyncedAt']);

    // Silently revoke token at Salesforce
    if (tokens && tokens.accessToken && config.instanceUrl) {
        try {
            await fetch(config.instanceUrl.replace(/\/$/, '') + '/services/oauth2/revoke', {
                method:  'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body:    new URLSearchParams({ token: tokens.accessToken })
            });
        } catch (e) { /* silent */ }
    }
}

// ── Export ────────────────────────────────────────────────────────────────────

self.SfOAuth = {
    launchOAuthFlow:          launchOAuthFlow,
    refreshAccessToken:       refreshAccessToken,
    getValidAccessToken:      getValidAccessToken,
    fetchSalesforceUserInfo:  fetchSalesforceUserInfo,
    disconnectOAuth:          disconnectOAuth
};

}());
