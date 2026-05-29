// ==================================================
// CYFOR Nucleus Enhancer — Salesforce OAuth 2.0 (PKCE)
// All Consumer Key / Secret calls go through the OAuth
// proxy (Cloudflare Worker).  This file never touches
// those credentials directly.
// ==================================================

(function () {

var TOKENS_KEY       = 'sfOAuthTokens';
var CONFIG_KEY       = 'sfOAuthConfig';
var USER_KEY         = 'sfOAuthUser';
var EXPIRY_BUFFER_MS = 5 * 60 * 1000;

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
    var data    = encoder.encode(verifier);
    var digest  = await crypto.subtle.digest('SHA-256', data);
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

// ── Proxy URL helper ──────────────────────────────────────────────────────────

async function getProxyUrl() {
    var result = await chrome.storage.local.get(CONFIG_KEY);
    var config = result[CONFIG_KEY] || {};
    var url = (config.oauthProxyUrl || '').replace(/\/$/, '');
    if (!url) throw new Error('NOT_CONFIGURED');
    return url;
}

// ── Core OAuth flow ───────────────────────────────────────────────────────────

async function launchOAuthFlow() {
    var proxyUrl    = await getProxyUrl();
    var redirectUrl = chrome.identity.getRedirectURL('sf-oauth');

    var codeVerifier  = await generateCodeVerifier();
    var codeChallenge = await generateCodeChallenge(codeVerifier);

    // Ask proxy to construct the Salesforce auth URL (proxy injects Consumer Key)
    var urlRes = await fetch(proxyUrl + '/auth-url', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ codeChallenge: codeChallenge, redirectUri: redirectUrl })
    });
    if (!urlRes.ok) {
        var urlErr = await urlRes.json().catch(function () { return {}; });
        throw new Error(urlErr.error || 'Proxy error building auth URL');
    }
    var urlData = await urlRes.json();
    if (!urlData.url) throw new Error('Proxy returned no auth URL');

    console.log('[CYFOR] Auth URL:', urlData.url);

    var responseUrl = await chrome.identity.launchWebAuthFlow({
        url:         urlData.url,
        interactive: true
    });

    var parsed = new URL(responseUrl);
    var error  = parsed.searchParams.get('error');
    if (error) {
        throw new Error('SF_AUTH_ERROR: ' + error + ' — ' + (parsed.searchParams.get('error_description') || ''));
    }

    var code = parsed.searchParams.get('code');
    if (!code) throw new Error('No authorization code in callback URL');

    var tokens = await exchangeCodeForTokens(proxyUrl, code, codeVerifier, redirectUrl);
    await storeTokens(tokens);

    var user = await fetchSalesforceUserInfo(tokens.instanceUrl, tokens.accessToken);

    if (self.SfTeam) {
        var teamInfo = await self.SfTeam.fetchUserTeamInfo(
            tokens.instanceUrl,
            tokens.accessToken,
            user.id
        );
        user = Object.assign({}, user, teamInfo);
    }

    var userPayload = {};
    userPayload[USER_KEY] = user;
    await chrome.storage.local.set(userPayload);

    return { ok: true, user: user };
}

async function exchangeCodeForTokens(proxyUrl, code, codeVerifier, redirectUri) {
    var response = await fetch(proxyUrl + '/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: code, codeVerifier: codeVerifier, redirectUri: redirectUri })
    });

    if (!response.ok) {
        var err = await response.json().catch(function () { return {}; });
        throw new Error('Token exchange failed: ' + (err.error || response.status));
    }

    var data = await response.json();
    return {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        tokenType:    data.token_type || 'Bearer',
        expiresAt:    Date.now() + (data.expires_in ? data.expires_in * 1000 : 7200 * 1000),
        instanceUrl:  data.instance_url || ''
    };
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshAccessToken() {
    var results = await chrome.storage.local.get([CONFIG_KEY, TOKENS_KEY]);
    var config  = results[CONFIG_KEY] || {};
    var tokens  = results[TOKENS_KEY] || {};

    if (!tokens.refreshToken) throw new Error('NO_REFRESH_TOKEN');

    var proxyUrl = (config.oauthProxyUrl || '').replace(/\/$/, '');
    if (!proxyUrl) throw new Error('NOT_CONFIGURED');

    var response = await fetch(proxyUrl + '/refresh', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refreshToken: tokens.refreshToken })
    });

    if (!response.ok) {
        if (response.status === 400 || response.status === 401) {
            await chrome.storage.local.remove([TOKENS_KEY, USER_KEY, 'sfRemoteTemplates', 'sfTemplatesSyncedAt']);
            throw new Error('REFRESH_TOKEN_EXPIRED');
        }
        var err = await response.json().catch(function () { return {}; });
        throw new Error('Token refresh failed: ' + (err.error || response.status));
    }

    var data    = await response.json();
    var updated = Object.assign({}, tokens, {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token || tokens.refreshToken,
        expiresAt:    Date.now() + (data.expires_in ? data.expires_in * 1000 : 7200 * 1000)
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

    // Best-effort: revoke token via proxy (keeps Consumer Key off the extension)
    var proxyUrl = (config.oauthProxyUrl || '').replace(/\/$/, '');
    if (tokens && tokens.accessToken && proxyUrl) {
        try {
            await fetch(proxyUrl + '/revoke', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ token: tokens.accessToken, instanceUrl: tokens.instanceUrl || '' })
            });
        } catch (e) { /* silent */ }
    }
}

// ── Export ────────────────────────────────────────────────────────────────────

self.SfOAuth = {
    launchOAuthFlow:         launchOAuthFlow,
    refreshAccessToken:      refreshAccessToken,
    getValidAccessToken:     getValidAccessToken,
    fetchSalesforceUserInfo: fetchSalesforceUserInfo,
    disconnectOAuth:         disconnectOAuth
};

}());
