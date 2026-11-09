(() => {
  const config = window.HOMESCOPE_AUTH;
  if (!config) {
    window.homeScopeAuth = { ready: Promise.resolve({ admin: true }), fetch: window.fetch.bind(window) };
    return;
  }

  const callback = location.origin + '/';
  const tokenKey = 'homescope.access';
  const loginKey = 'homescope.login';
  const signIn = document.querySelector('#signIn');
  const signOut = document.querySelector('#signOut');
  const status = document.querySelector('#accountStatus');
  let accessToken = sessionStorage.getItem(tokenKey) || '';

  function base64url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function random() {
    return base64url(crypto.getRandomValues(new Uint8Array(32)));
  }

  function endpoint(path, params) {
    const url = new URL(path, config.origin);
    url.search = new URLSearchParams(params);
    return url;
  }

  function showAccount(account, message) {
    signIn.hidden = Boolean(account);
    signOut.hidden = !account;
    status.textContent = message || (account ? 'Signed in as ' + account.email : 'Sign in with Google to save locations and get updated listings in other cities.');
  }

  function clearToken() {
    accessToken = '';
    sessionStorage.removeItem(tokenKey);
  }

  signIn.onclick = async () => {
    try {
      const verifier = random();
      const state = random();
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      sessionStorage.setItem(loginKey, JSON.stringify({ verifier, state }));
      location.assign(endpoint('/oauth2/authorize', {
        response_type: 'code', client_id: config.clientId, redirect_uri: callback,
        scope: 'openid email', identity_provider: 'Google', state,
        code_challenge: base64url(new Uint8Array(hash)), code_challenge_method: 'S256',
      }));
    } catch {
      showAccount(null, 'Could not start Google sign-in. Try again.');
    }
  };

  signOut.onclick = () => {
    clearToken();
    sessionStorage.removeItem(loginKey);
    location.assign(endpoint('/logout', { client_id: config.clientId, logout_uri: callback }));
  };

  async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers);
    if (accessToken) headers.set('Authorization', 'Bearer ' + accessToken);
    const response = await fetch(path, { ...options, headers });
    if (response.status === 401 && accessToken) {
      clearToken();
      showAccount(null, 'Your session expired. Sign in again to continue.');
    }
    return response;
  }

  async function initialize() {
    const params = new URLSearchParams(location.search);
    if (params.has('code') || params.has('error')) {
      history.replaceState(null, '', location.pathname + location.hash);
      clearToken();
      const pending = sessionStorage.getItem(loginKey);
      sessionStorage.removeItem(loginKey);
      try {
        const login = JSON.parse(pending);
        if (!login || params.get('state') !== login.state || !params.get('code')) {
          throw new Error('Invalid sign-in response');
        }
        const response = await fetch(endpoint('/oauth2/token', {}), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code', client_id: config.clientId,
            redirect_uri: callback, code: params.get('code'), code_verifier: login.verifier,
          }),
        });
        if (!response.ok) throw new Error('Token exchange failed');
        const tokens = await response.json();
        if (!tokens.access_token) throw new Error('Missing access token');
        accessToken = tokens.access_token;
        sessionStorage.setItem(tokenKey, accessToken);
      } catch {
        showAccount(null, 'Google sign-in could not be completed. Please try again.');
        return null;
      }
    }
    if (!accessToken) {
      showAccount(null);
      return null;
    }
    try {
      const response = await apiFetch('/api/account');
      if (!response.ok) throw new Error('Account unavailable');
      const account = await response.json();
      showAccount(account);
      return account;
    } catch {
      clearToken();
      showAccount(null, 'Could not load your account. Please sign in again.');
      return null;
    }
  }

  window.homeScopeAuth = { ready: initialize(), fetch: apiFetch };
})();

