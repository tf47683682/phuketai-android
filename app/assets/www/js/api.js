/* Transport + PhuketAI API client.
   All HTTP goes through the native bridge (Java HttpURLConnection) so the
   WebView never hits CORS. In a plain browser it falls back to fetch(). */
(function (global) {
  'use strict';

  var ORIGIN = 'https://ai.pukitcore.com';
  var API = ORIGIN + '/api/v1';
  var V1 = ORIGIN + '/v1';

  // ---------- base64 helpers ----------
  function dec(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    var out = '';
    for (var j = 0; j < bytes.length; j++) out += String.fromCharCode(bytes[j]);
    return decodeURIComponent(escape(out));
  }

  // ---------- transport ----------
  var seq = 0;
  var pending = {};
  var streams = {};

  function nativeHttp(method, url, headers, body, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + (++seq);
      var timer = setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          try { global.Native.abort(id); } catch (e) {}
          reject(mkErr(0, 'TIMEOUT', '请求超时，请检查网络'));
        }
      }, timeoutMs || 45000);
      pending[id] = function (status, text, hdrs) {
        clearTimeout(timer);
        delete pending[id];
        if (status === 0) {
          var msg = '网络连接失败';
          try { var h = JSON.parse(hdrs || '{}'); if (h.error) msg = h.error; } catch (e) {}
          reject(mkErr(0, 'NETWORK', msg));
          return;
        }
        resolve({ status: status, text: text, headers: hdrs });
      };
      try {
        global.Native.http(id, method, url, JSON.stringify(headers || {}), body || null);
      } catch (e) {
        clearTimeout(timer);
        delete pending[id];
        reject(mkErr(0, 'BRIDGE', String(e)));
      }
    });
  }

  function fetchHttp(method, url, headers, body) {
    var opt = { method: method, headers: headers || {} };
    if (body) opt.body = body;
    return fetch(url, opt).then(function (r) {
      return r.text().then(function (t) {
        return { status: r.status, text: t, headers: '{}' };
      });
    });
  }

  function request(method, url, headers, body, timeoutMs) {
    if (global.Native && global.Native.http) return nativeHttp(method, url, headers, body, timeoutMs);
    return fetchHttp(method, url, headers, body);
  }

  var MSG_MAP = [
    ['invalid email or password', '邮箱或密码错误'],
    ['invalid credentials', '邮箱或密码错误'],
    ['email not verified', '邮箱尚未验证，请先完成邮箱验证'],
    ['email already', '该邮箱已注册'],
    ['user not found', '账号不存在'],
    ['account is disabled', '账号已被禁用'],
    ['account has been banned', '账号已被封禁'],
    ['invalid verification code', '验证码不正确'],
    ['verification code expired', '验证码已过期'],
    ['invalid or expired', '验证码无效或已过期'],
    ['too many requests', '请求过于频繁，请稍后再试'],
    ['rate limit', '请求过于频繁，请稍后再试'],
    ['insufficient balance', '余额不足，请先充值'],
    ['insufficient quota', '额度不足'],
    ['quota exceeded', '额度已用尽'],
    ['invalid token', '令牌无效或已停用'],
    ['token is disabled', '令牌已停用'],
    ['token expired', '令牌已过期'],
    ['not found', '资源不存在'],
    ['internal server error', '服务异常，请稍后再试']
  ];
  function localize(msg) {
    var raw = String(msg || '').trim();
    var low = raw.toLowerCase();
    for (var i = 0; i < MSG_MAP.length; i++) {
      if (low.indexOf(MSG_MAP[i][0]) >= 0) return MSG_MAP[i][1];
    }
    return raw;
  }

  function mkErr(status, code, message) {
    var e = new Error(message || '请求失败');
    e.status = status;
    e.code = code;
    e.message = message || '请求失败';
    return e;
  }

  // ---------- auth state ----------
  var AUTH = {
    token: function () { return U.store.get('token', ''); },
    refresh: function () { return U.store.get('refresh', ''); },
    user: function () { return U.store.get('user', null); },
    set: function (data) {
      if (!data) return;
      if (data.access_token) U.store.set('token', data.access_token);
      if (data.refresh_token) U.store.set('refresh', data.refresh_token);
      var ttl = Number(data.expires_in || 0);
      U.store.set('expires_at', ttl ? Date.now() + ttl * 1000 : 0);
      if (data.user) U.store.set('user', data.user);
    },
    setUser: function (u) { if (u) U.store.set('user', u); },
    clear: function () {
      U.store.del('token');
      U.store.del('refresh');
      U.store.del('user');
      U.store.del('expires_at');
    },
    isLogged: function () { return !!AUTH.token(); }
  };

  var refreshing = null;
  function refreshToken() {
    if (refreshing) return refreshing;
    var rt = AUTH.refresh();
    if (!rt) return Promise.reject(mkErr(401, 'NO_REFRESH', '登录已过期'));
    refreshing = request('POST', API + '/auth/refresh', { 'Content-Type': 'application/json' },
      JSON.stringify({ refresh_token: rt }))
      .then(function (res) {
        var j = parse(res);
        if (res.status >= 400 || !j || j.code !== 0) throw mkErr(401, 'REFRESH_FAILED', '登录已过期，请重新登录');
        AUTH.set(j.data || {});
        return j.data;
      })
      .then(function (d) { refreshing = null; return d; }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }

  function parse(res) {
    try { return JSON.parse(res.text); } catch (e) { return null; }
  }

  // ---------- JSON API ----------
  function api(path, opts) {
    opts = opts || {};
    var method = opts.method || 'GET';
    var url = API + path;
    if (opts.query) {
      var qs = [];
      Object.keys(opts.query).forEach(function (k) {
        var v = opts.query[k];
        if (v === undefined || v === null || v === '') return;
        qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      });
      if (qs.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs.join('&');
    }
    var headers = { 'Accept': 'application/json' };
    var body = null;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    if (opts.auth !== false) {
      var t = AUTH.token();
      if (t) headers['Authorization'] = 'Bearer ' + t;
    }
    if (opts.headers) Object.assign(headers, opts.headers);

    function attempt(isRetry) {
      return request(method, url, headers, body).then(function (res) {
        var j = parse(res);
        if (res.status === 401 && !isRetry && opts.auth !== false && AUTH.refresh()) {
          return refreshToken().then(function () {
            var h2 = Object.assign({}, headers, { 'Authorization': 'Bearer ' + AUTH.token() });
            return request(method, url, h2, body).then(function (r2) {
              return handle(r2, parse(r2));
            });
          }, function () {
            AUTH.clear();
            throw mkErr(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
          });
        }
        return handle(res, j);
      });
    }
    return attempt(false);
  }

  function handle(res, j) {
    if (!j) {
      if (res.status >= 400) throw mkErr(res.status, 'HTTP_' + res.status, '服务暂不可用 (' + res.status + ')');
      return {};
    }
    if (j.code === 0 || j.code === 'SUCCESS' || j.code === 200) return j.data;
    var msg = j.message || j.error || j.msg || (typeof j.code === 'string' ? j.code : '请求失败');
    throw mkErr(res.status >= 400 ? res.status : 400, j.code, localize(msg));
  }

  // ---------- public ----------
  var cache = {};
  function cached(key, ttl, loader) {
    var hit = cache[key];
    var now = Date.now();
    if (hit && now - hit.at < ttl) return Promise.resolve(hit.value);
    return loader().then(function (v) { cache[key] = { at: now, value: v }; return v; });
  }
  function clearCache() { cache = {}; }

  var Api = {
    ORIGIN: ORIGIN, API: API, V1: V1, AUTH: AUTH, base: api,
    settings: function () { return cached('settings', 5 * 60e3, function () { return api('/settings/public', { auth: false }); }); },
    plaza: function () { return cached('plaza', 10 * 60e3, function () { return api('/model-plaza', { auth: false }); }); },
    announcements: function () { return cached('ann', 60e3, function () { return api('/announcements/public', { auth: false }); }); },
    locale: function () { return api('/locale/default', { auth: false }).catch(function () { return { locale: 'zh' }; }); },

    login: function (email, password, extra) {
      var body = Object.assign({ email: email, password: password }, extra || {});
      return api('/auth/login', { method: 'POST', body: body, auth: false }).then(function (d) {
        AUTH.set(d);
        return d;
      });
    },
    login2fa: function (payload) {
      return api('/auth/login/2fa', { method: 'POST', body: payload, auth: false }).then(function (d) { AUTH.set(d); return d; });
    },
    register: function (payload) {
      return api('/auth/register', { method: 'POST', body: payload, auth: false }).then(function (d) {
        AUTH.set(d);
        return d;
      });
    },
    sendCode: function (payload) {
      return api('/auth/send-verify-code', { method: 'POST', body: payload, auth: false });
    },
    forgot: function (payload) {
      return api('/auth/forgot-password', { method: 'POST', body: payload, auth: false });
    },
    reset: function (payload) {
      return api('/auth/reset-password', { method: 'POST', body: payload, auth: false });
    },
    me: function () {
      return api('/auth/me').then(function (d) {
        var u = d && d.user ? d.user : d;
        AUTH.setUser(u);
        return u;
      });
    },
    logout: function () {
      return api('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () { AUTH.clear(); });
    },

    keys: function (page, size, filters) {
      return api('/keys', { query: Object.assign({ page: page || 1, page_size: size || 50 }, filters || {}) });
    },
    keyCreate: function (payload) { return api('/keys', { method: 'POST', body: payload }); },
    keyUpdate: function (id, payload) { return api('/keys/' + id, { method: 'PUT', body: payload }); },
    keyDelete: function (id) { return api('/keys/' + id, { method: 'DELETE' }); },
    groups: function () { return api('/groups/available'); },

    usageStats: function (query) { return api('/usage/stats', { query: query }); },
    usageDashboard: function () { return api('/usage/dashboard/stats'); },
    usageTrend: function (query) { return api('/usage/dashboard/trend', { query: query }); },
    usageModels: function (query) { return api('/usage/dashboard/models', { query: query }); },
    usageLogs: function (query) { return api('/usage', { query: query }); },
    usageErrors: function (query) { return api('/usage/errors', { query: query }); },

    profileUpdate: function (payload) { return api('/user/profile', { method: 'PUT', body: payload }); },
    changePassword: function (oldP, newP) {
      return api('/user/password', { method: 'PUT', body: { old_password: oldP, new_password: newP } });
    },
    aff: function () { return api('/user/aff'); },
    affTransfer: function () { return api('/user/aff/transfer', { method: 'POST' }); },

    redeemHistory: function () { return api('/redeem/history'); },
    redeem: function (code) { return api('/redeem', { method: 'POST', body: { code: code } }); },

    paymentConfig: function () { return api('/payment/config'); },
    paymentPlans: function () { return api('/payment/plans'); },
    paymentInfo: function () { return api('/payment/checkout-info'); },
    paymentLimits: function () { return api('/payment/limits'); },
    createOrder: function (payload) { return api('/payment/orders', { method: 'POST', body: payload }); },
    myOrders: function (query) { return api('/payment/orders/my', { query: query }); },
    verifyOrder: function (outTradeNo) { return api('/payment/orders/verify', { method: 'POST', body: { out_trade_no: outTradeNo } }); },

    subscriptions: function () { return api('/subscriptions/active'); },
    // ---- raw OpenAI-compatible calls (used by chat fallbacks & images) ----
    v1Post: function (path, key, payload, timeoutMs) {
      return request('POST', V1 + path, {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + key
      }, JSON.stringify(payload), timeoutMs || 120000).then(function (res) {
        var j = parse(res);
        if (res.status >= 400) throw mkErr(res.status, 'HTTP_' + res.status, readError(j, res.text));
        if (!j) throw mkErr(res.status, 'BAD_JSON', '接口返回无法解析：' + String(res.text || '').slice(0, 200));
        if (j.error && !j.choices && !j.data) throw mkErr(res.status, 'API_ERROR', readError(j, res.text));
        return j;
      });
    },
    chatOnce: function (key, payload) {
      var body = Object.assign({}, payload);
      body.stream = false;
      return Api.v1Post('/chat/completions', key, body, 150000);
    },
    generateImage: function (key, payload) {
      return Api.v1Post('/images/generations', key, payload, 180000);
    },
    modelsWithKey: function (key) {
      return request('GET', V1 + '/models', { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' }, null)
        .then(function (res) {
          var j = parse(res);
          if (!j || res.status >= 400) throw mkErr(res.status, 'MODELS', (j && j.error && j.error.message) || '无法获取模型列表');
          return j.data || j;
        });
    }
  };

  // ---------- streaming (chat completions) ----------
  // Native bridge pushes base64 lines. Falls back to fetch streaming in browsers.
  function chatStream(payload, key, handlers) {
    var id = 's' + (++seq);
    var headers = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Authorization': 'Bearer ' + key
    };
    var buf = '';
    streams[id] = {
      onEvent: handlers.onEvent,
      onDone: handlers.onDone,
      onError: handlers.onError
    };

    if (!(global.Native && global.Native.stream)) {
      // browser fallback
      var ctrl = new AbortController();
      fetch(V1 + '/chat/completions', {
        method: 'POST', headers: headers, body: JSON.stringify(payload), signal: ctrl.signal
      }).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            handlers.onError && handlers.onError(t || ('HTTP ' + r.status), r.status);
          });
        }
        var reader = r.body.getReader();
        var dec2 = new TextDecoder();
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) { handlers.onDone && handlers.onDone(); return; }
            var chunk = dec2.decode(res.value, { stream: true });
            handleSse(chunk, handlers);
            return pump();
          });
        }
        return pump();
      }).catch(function (e) { if (e.name !== 'AbortError') handlers.onError && handlers.onError(e.message); });
      return { abort: function () { ctrl.abort(); } };
    }

    global.Native.stream(id, 'POST', V1 + '/chat/completions', JSON.stringify(headers), JSON.stringify(payload));
    return {
      abort: function () {
        try { global.Native.abort(id); } catch (e) {}
        delete streams[id];
      }
    };
  }

  function handleSse(chunk, h) {
    var lines = chunk.split(/\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.indexOf('data:') !== 0) continue;
      var data = line.slice(5).trim();
      if (data === '[DONE]') { h.onDone && h.onDone(); continue; }
      try { h.onEvent && h.onEvent(JSON.parse(data)); } catch (e) {}
    }
  }

  global.__nativeHttp = function (id, status, b64, headers) {
    var cb = pending[id];
    if (!cb) return;
    var text = '';
    try { text = b64 ? dec(b64) : ''; } catch (e) {}
    cb(status, text, headers);
  };

  global.__nativeChunk = function (id, b64) {
    var s = streams[id];
    if (!s) return;
    var line;
    try { line = dec(b64); } catch (e) { return; }
    handleSse(line + '\n', s);
  };

  global.__nativeEnd = function (id, err, status) {
    var s = streams[id];
    if (!s) return;
    delete streams[id];
    if (err) {
      var msg = err;
      try {
        var j = JSON.parse(err);
        if (j && (j.message || j.error)) msg = (j.error && j.error.message) || j.message;
      } catch (e) {}
      s.onError && s.onError(typeof msg === 'string' ? localize(msg) : '请求失败', status);
    } else {
      s.onDone && s.onDone();
    }
  };

  Api.chatStream = chatStream;
  function readError(j, raw) {
    var msg = '';
    if (j) {
      if (j.error) msg = typeof j.error === 'string' ? j.error : (j.error.message || j.error.msg || j.error.code || '');
      else msg = j.message || j.msg || '';
    }
    if (!msg) msg = String(raw || '').trim().slice(0, 300);
    return localize(msg) || ('请求失败 (' + (raw || '').slice(0, 80) + ')');
  }

  global.Api = Api;
  global.Api.dec = dec;
})(window);
