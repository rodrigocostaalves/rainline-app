/* RainLine — camada de API e sincronização
   Regra de ouro: o app nunca depende da internet para funcionar. Tudo é salvo
   no aparelho primeiro; a nuvem é atualizada quando dá. */
(function (global) {
  'use strict';

  var ONLINE = { ok: null };   // null = ainda não sabemos

  function req(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof ArrayBuffer)) {
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (r) {
      ONLINE.ok = true;
      if (r.status === 401) { var e = new Error('auth'); e.code = 401; throw e; }
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var er = new Error(d.error || 'erro'); er.code = r.status; er.data = d; throw er; }
        return d;
      });
    }).catch(function (e) {
      if (e.code === undefined) ONLINE.ok = false;   // falha de rede
      throw e;
    });
  }

  var Api = {
    online: function () { return ONLINE.ok; },

    health: function () {
      return req('/api/health').then(function () { return true; })
        .catch(function () { return false; });
    },

    login: function (username, password) {
      return req('/api/login', { method: 'POST', body: { username: username, password: password } });
    },
    logout: function () { return req('/api/logout', { method: 'POST' }); },
    me: function () { return req('/api/me'); },
    changePassword: function (current, next) {
      return req('/api/password', { method: 'POST', body: { current: current, next: next } });
    },

    users: function () { return req('/api/users'); },
    createUser: function (u) { return req('/api/users', { method: 'POST', body: u }); },

    jobs: function (since) { return req('/api/jobs?since=' + (since || 0)); },
    putJob: function (jobId, data, updatedAt) {
      return req('/api/jobs/' + encodeURIComponent(jobId), {
        method: 'PUT', body: { data: data, updated_at: updatedAt || 0 }
      });
    },
    deleteJob: function (jobId) {
      return req('/api/jobs/' + encodeURIComponent(jobId), { method: 'DELETE' });
    },

    // manda a foto como binário puro; devolve a chave no R2
    uploadPhoto: function (jobId, dataUrl, level, feet) {
      var bin = dataUrlToBlob(dataUrl);
      if (!bin) return Promise.reject(new Error('imagem inválida'));
      return fetch('/api/photos?job=' + encodeURIComponent(jobId) +
                   '&level=' + (level || 1) + '&feet=' + Math.round(feet || 0), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'image/jpeg' }, body: bin
      }).then(function (r) {
        if (!r.ok) throw new Error('upload');
        return r.json();
      });
    },

    photoUrl: function (key) { return '/api/photos/' + key; }
  };

  function dataUrlToBlob(u) {
    if (!u || u.indexOf('base64,') < 0) return null;
    var b64 = u.split('base64,')[1];
    var bytes = atob(b64);
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: 'image/jpeg' });
  }

  global.Api = Api;
})(window);
