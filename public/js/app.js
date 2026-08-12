/* RainLine — v0.1 */
(function () {
  'use strict';

  var K = { set: 'rainline.settings', jobs: 'rainline.jobs', sess: 'rainline.session' };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- storage ---------- */
  function load(k, fb) { try { return JSON.parse(localStorage.getItem(k)) || fb; } catch (e) { return fb; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Sem espaço para salvar neste aparelho.'); } }

  var settings = Object.assign({}, Calc.DEFAULTS, load(K.set, {}));
  var jobs = load(K.jobs, []);
  var job = null;      // orçamento em edição
  var map = null, drawLayer = null;

  var money = function (n) {
    return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var ft = function (n) { return Math.round(Number(n) || 0) + ' ft'; };

  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('is-on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('is-on'); }, 2600);
  }

  /* ---------- router ---------- */
  function go(name) {
    $$('.screen').forEach(function (s) { s.classList.remove('is-active'); });
    var el = $('#screen-' + name);
    if (!el) return;
    el.classList.add('is-active');
    window.scrollTo(0, 0);
    if (name === 'home') renderHome();
    if (name === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 60);
    if (name === 'crop') setTimeout(function () { computeCropFit(); clampCrop(); drawCrop(); }, 60);
    if (name === 'parts') renderParts();
    if (name === 'materials') renderMaterials();
    if (name === 'quote') renderQuote();
    if (name === 'clients') renderClients();
    if (name === 'history') renderHistory();
    if (name === 'settings') { fillSettings(); renderCloudCard(); }
  }
  // pai de cada tela, para o botão voltar do aparelho andar dentro do app
  var PARENT = {
    job: 'home', map: 'job', parts: 'map', photo: 'parts',
    materials: 'parts', quote: 'materials',
    clients: 'home', history: 'home', settings: 'home'
  };

  function currentScreen() {
    var el = document.querySelector('.screen.is-active');
    return el ? el.id.replace('screen-', '') : 'home';
  }

  function armBack() { history.pushState({ rl: 1 }, ''); }

  window.addEventListener('popstate', function () {
    var cur = currentScreen();
    if (cur === 'login') { armBack(); return; }
    if (PARENT[cur]) { go(PARENT[cur]); armBack(); return; }
    // está no painel: confirma antes de sair mesmo
    var pend = jobs.filter(function (j) { return j.pending; }).length;
    var msg = pend
      ? 'Sair do RainLine? Há ' + pend + ' orçamento(s) ainda não enviados para a nuvem.'
      : 'Sair do RainLine?';
    if (confirm(msg)) history.back();
    else armBack();
  });

  // avisa se fechar a aba com orçamento em edição
  window.addEventListener('beforeunload', function (e) {
    if (job && !job.savedAt && (job.runs.length || (job.manual || []).length)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go],[data-back],[data-action]');
    if (!b) return;
    if (b.dataset.go) go(b.dataset.go === 'job' ? (newJob(), 'job') : b.dataset.go);
    if (b.dataset.back) go(b.dataset.back);
    if (b.dataset.action === 'logout') {
      save(K.sess, null);
      cloud.user = null;
      Api.logout().catch(function () {});
      go('login');
    }
  });

  /* ---------- login ---------- */
  $('#form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var u = $('#login-user').value.trim(), p = $('#login-pass').value;
    var hint = $('#login-hint');
    hint.textContent = 'Entrando…';

    Api.login(u, p).then(function (r) {
      cloud.on = true; cloud.user = r.user;
      save(K.sess, { user: r.user.username, at: Date.now(), cloud: true });
      $('#login-pass').value = '';
      hint.textContent = '';
      go('home');
      syncAll(true);
    }).catch(function (err) {
      if (err.code === 401) {
        hint.textContent = 'Usuário ou senha não conferem.';
        return;
      }
      // servidor fora do ar: permite trabalhar offline com a senha local
      if (u === settings.user && p === settings.pass) {
        cloud.on = false; cloud.user = null;
        save(K.sess, { user: u, at: Date.now(), cloud: false });
        $('#login-pass').value = '';
        hint.textContent = '';
        go('home');
        toast('Sem servidor agora — trabalhando offline neste aparelho.');
      } else {
        hint.textContent = 'Sem conexão e a senha local não confere.';
      }
    });
  });

  /* ---------- nuvem: login, sincronização e fotos ----------
     O app funciona offline. Tudo é salvo no aparelho primeiro e sobe depois. */
  var cloud = { on: null, user: null, lastSync: load('rainline.lastsync', 0) };

  function setSync(state, text) {
    var dot = $('#sync-dot'), t = $('#sync-text');
    if (!dot) return;
    dot.className = 'sync-dot ' + state;
    t.textContent = text;
  }

  function pendingCount() {
    return jobs.filter(function (j) { return j.pending; }).length;
  }

  function syncStatusText() {
    var n = pendingCount();
    if (cloud.on === false) return n ? n + ' orçamento(s) aguardando internet' : 'Modo offline — salvo no aparelho';
    if (n) return n + ' orçamento(s) para enviar';
    return cloud.user ? 'Tudo sincronizado · ' + cloud.user.username : 'Conectado';
  }

  function refreshSyncBar() {
    var n = pendingCount();
    setSync(cloud.on === false ? 'off' : (n ? 'pending' : 'on'), syncStatusText());
  }

  // sobe as fotos que ainda estão em base64 e troca pela chave do R2
  function uploadPhotos(job) {
    var pend = (job.manual || []).filter(function (e) { return e.img && !e.key; });
    if (!pend.length || cloud.on === false) return Promise.resolve();
    return pend.reduce(function (chain, e) {
      return chain.then(function () {
        return Api.uploadPhoto(job.id, e.img, e.level, e.feet).then(function (r) {
          e.key = r.key;
          delete e.img;             // libera a memória do aparelho
        }).catch(function () {});
      });
    }, Promise.resolve());
  }

  function pushJob(job) {
    if (cloud.on === false) return Promise.resolve(false);
    return uploadPhotos(job).then(function () {
      return Api.putJob(job.id, job, job.savedAt || 0);
    }).then(function (r) {
      job.pending = false;
      job.syncedAt = r.updated_at;
      save(K.jobs, jobs);
      return true;
    }).catch(function (err) {
      if (err.code === 401) { cloud.user = null; }
      else if (err.code === undefined) cloud.on = false;
      return false;
    });
  }

  function syncAll(quiet) {
    if (cloud.on === false) { refreshSyncBar(); return Promise.resolve(); }
    if (!quiet) setSync('pending', 'Sincronizando…');

    var out = jobs.filter(function (j) { return j.pending; });
    return out.reduce(function (chain, j) {
      return chain.then(function () { return pushJob(j); });
    }, Promise.resolve())
      .then(function () { return Api.jobs(0); })
      .then(function (r) {
        (r.jobs || []).forEach(function (row) {
          var i = jobs.findIndex(function (j) { return j.id === row.id; });
          if (row.deleted) { if (i >= 0) jobs.splice(i, 1); return; }
          var incoming = row.data;
          if (!incoming) return;
          incoming.id = row.id;
          incoming.syncedAt = row.updated_at;
          if (i < 0) jobs.push(incoming);
          else if (!jobs[i].pending && (row.updated_at > (jobs[i].syncedAt || 0))) jobs[i] = incoming;
        });
        jobs.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
        cloud.lastSync = r.now;
        save('rainline.lastsync', r.now);
        save(K.jobs, jobs);
        refreshSyncBar();
        renderHome();
      })
      .catch(function (err) {
        if (err.code === undefined) cloud.on = false;
        refreshSyncBar();
      });
  }

  function bootCloud() {
    return Api.me().then(function (r) {
      cloud.on = true; cloud.user = r.user;
      save(K.sess, { user: r.user.username, at: Date.now(), cloud: true });
      refreshSyncBar();
      return syncAll(true);
    }).catch(function (err) {
      cloud.on = (err.code === 401) ? true : false;   // 401 = servidor vivo, sessão expirada
      cloud.user = null;
      refreshSyncBar();
    });
  }

  $('#btn-sync').addEventListener('click', function () {
    cloud.on = null;
    Api.health().then(function (ok) {
      cloud.on = ok;
      if (!ok) { refreshSyncBar(); toast('Sem conexão com o servidor agora.'); return; }
      if (!cloud.user) { toast('Sessão expirada — entre de novo.'); go('login'); return; }
      syncAll().then(function () { toast('Sincronizado.'); });
    });
  });

  window.addEventListener('online', function () { cloud.on = null; bootCloud(); });
  window.addEventListener('offline', function () { cloud.on = false; refreshSyncBar(); });

  /* ---------- dashboard ---------- */
  function renderHome() {
    $('#home-user').textContent = (load(K.sess, {}) || {}).user || 'Vendedor';
    var now = new Date(), n = 0, v = 0;
    jobs.forEach(function (j) {
      var d = new Date(j.savedAt);
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
        n++;
        if (j.status === 'accepted') v += j.total || 0;
      }
    });
    $('#stat-month').textContent = n;
    $('#stat-value').textContent = '$' + Math.round(v).toLocaleString('en-US');
  }

  /* ---------- novo orçamento ---------- */
  function newJob() {
    job = {
      id: 'Q' + Date.now().toString(36).toUpperCase(),
      client: {}, runs: [], manual: [], overrides: {}, status: 'draft', marginMode: 'pct',
      size: 5, stories: 1, color: '', discount: 0, taxPct: 0, savedAt: null
    };
    $('#form-job').reset();
  }

  $('#form-job').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!job) newJob();
    job.client = {
      name: $('#job-name').value.trim(),
      phone: $('#job-phone').value.trim(),
      email: $('#job-email').value.trim(),
      address: $('#job-address').value.trim(),
      city: $('#job-city').value.trim(),
      state: $('#job-state').value.trim().toUpperCase(),
      zip: $('#job-zip').value.trim(),
      notes: $('#job-notes').value.trim()
    };
    $('#map-title').textContent = job.client.name || 'Medir calhas';
    if (job.savedAt) {                    // edição de um orçamento já salvo
      saveJob(true);
      go('quote');
      toast('Dados do cliente atualizados.');
      return;
    }
    go('map');
    initMap();
    if (!map) return;
    setMapMode('draw');
    geocode();
  });

  function fullAddress() {
    var c = job.client;
    return [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');
  }

  function landAt(lat, lng, zoom, msg) {
    map.setView([lat, lng], zoom || 20);
    job.center = { lat: lat, lng: lng };
    toast(msg);
  }

  // tenta vários serviços em ordem; o Census é o melhor para endereço dos EUA
  function geocode() {
    if (!map) { toast('O mapa não carregou. Verifique a internet e recarregue.'); return; }
    var c = job.client;
    var q = fullAddress();

    // 1) usuário colou "lat, lng" direto no campo de endereço
    var m = (c.address || '').match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
    if (m) { landAt(+m[1], +m[2], 21, 'Coordenadas aplicadas.'); return; }

    if (!q) { toast('Sem endereço — use o GPS ou arraste o mapa.'); return; }
    toast('Procurando o imóvel…');

    tryCensus(c)
      .catch(function () { return tryNominatimStructured(c); })
      .catch(function () { return tryNominatimFree(q); })
      .catch(function () { return tryPhoton(q); })
      .catch(function () { return tryZip(c); })
      .then(function (r) { landAt(r.lat, r.lng, r.zoom || 20, r.msg); })
      .catch(function () {
        toast('Não achei este endereço. Use o GPS (⌖) ou arraste o mapa até a casa.');
      });
  }

  function jget(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw 0;
      return r.json();
    });
  }

  // US Census — gratuito, sem chave, precisão de telhado
  function tryCensus(c) {
    var line = [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');
    var u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
            '?address=' + encodeURIComponent(line) +
            '&benchmark=Public_AR_Current&format=json';
    return jget(u).then(function (d) {
      var m = d && d.result && d.result.addressMatches;
      if (!m || !m.length) throw 0;
      return { lat: m[0].coordinates.y, lng: m[0].coordinates.x, zoom: 21, msg: 'Imóvel encontrado. Confira antes de medir.' };
    });
  }

  function tryNominatimStructured(c) {
    var u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us' +
            '&street=' + encodeURIComponent(c.address || '') +
            '&city=' + encodeURIComponent(c.city || '') +
            '&state=' + encodeURIComponent(c.state || '') +
            '&postalcode=' + encodeURIComponent(c.zip || '');
    return jget(u).then(function (d) {
      if (!d || !d[0]) throw 0;
      return { lat: +d[0].lat, lng: +d[0].lon, zoom: 20, msg: 'Imóvel encontrado. Confira antes de medir.' };
    });
  }

  function tryNominatimFree(q) {
    var u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q + ', USA');
    return jget(u).then(function (d) {
      if (!d || !d[0]) throw 0;
      return { lat: +d[0].lat, lng: +d[0].lon, zoom: 20, msg: 'Imóvel encontrado. Confira antes de medir.' };
    });
  }

  function tryPhoton(q) {
    var u = 'https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(q);
    return jget(u).then(function (d) {
      var f = d && d.features && d.features[0];
      if (!f) throw 0;
      return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], zoom: 20, msg: 'Imóvel encontrado. Confira antes de medir.' };
    });
  }

  // último recurso: centraliza no CEP ou na cidade
  function tryZip(c) {
    var q = c.zip ? (c.zip + ', USA') : [c.city, c.state, 'USA'].filter(Boolean).join(', ');
    if (!c.zip && !c.city) return Promise.reject();
    var u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
    return jget(u).then(function (d) {
      if (!d || !d[0]) throw 0;
      return { lat: +d[0].lat, lng: +d[0].lon, zoom: 16, msg: 'Achei só a região. Arraste o mapa até a casa.' };
    });
  }

  // GPS — o vendedor já está na frente do imóvel
  function useGps() {
    if (!map) { toast('O mapa não carregou. Verifique a internet e recarregue.'); return; }
    if (!navigator.geolocation) { toast('Este aparelho não tem GPS disponível.'); return; }
    toast('Pegando sua posição…');
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        landAt(pos.coords.latitude, pos.coords.longitude, 21, 'Posição do GPS. Ajuste o mapa sobre o telhado.');
      },
      function (err) {
        toast(err.code === 1 ? 'Permissão de localização negada.' : 'GPS não respondeu. Arraste o mapa.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  /* ---------- mapa e desenho ---------- */
  var mapMode = 'draw';   // 'draw' = toque cria ponto · 'edit' = toque seleciona
  var selected = null;    // índice da linha selecionada

  /* ---------- camadas de imagem ---------- */
  // camada que fala com servidores ArcGIS que não são Web Mercator (condados),
  // pedindo a imagem já reprojetada trecho a trecho
  var ArcGISExport = null;
  function defineArcGISExport() {
    if (ArcGISExport || typeof L === 'undefined') return;
    ArcGISExport = L.TileLayer.extend({
    getTileUrl: function (c) {
      var R = 20037508.342789244;
      var res = (2 * R) / (256 * Math.pow(2, c.z));
      var minx = -R + c.x * 256 * res;
      var maxx = minx + 256 * res;
      var maxy = R - c.y * 256 * res;
      var miny = maxy - 256 * res;
      return this.options.base + '/export?bbox=' + [minx, miny, maxx, maxy].join(',') +
             '&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&transparent=false&f=image';
      }
    });
  }

  var LAYERS = [
    { id: 'esri', name: 'Esri', type: 'xyz', max: 19,
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      credit: 'Imagery © Esri, Maxar, Earthstar Geographics' },
    { id: 'clarity', name: 'Esri Clarity', type: 'xyz', max: 20,
      url: 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      credit: 'Imagery © Esri Clarity' },
    { id: 'ocfl', name: 'Orange County', type: 'arcgis', max: 21,
      base: 'https://ocgis4.ocfl.net/arcgis/rest/services/Public_Aerial_Base/MapServer',
      credit: 'Aerial © Orange County, FL' },
    { id: 'usgs', name: 'USGS', type: 'xyz', max: 16,
      url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
      credit: 'Imagery © USGS' }
  ];
  var layerIdx = 0, baseLayer = null, loupeBase = null;

  function makeLayer(def) {
    var o = { maxNativeZoom: def.max, maxZoom: 22, attribution: def.credit };
    if (def.type === 'arcgis') {
      defineArcGISExport();
      o.base = def.base;
      return new ArcGISExport('', o);
    }
    return L.tileLayer(def.url, o);
  }

  function applyLayer(i) {
    if (!map) return;
    layerIdx = (i + LAYERS.length) % LAYERS.length;
    var def = LAYERS[layerIdx];
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = makeLayer(def).addTo(map);
    baseLayer.bringToBack();
    if (loupeMap) {
      if (loupeBase) loupeMap.removeLayer(loupeBase);
      loupeBase = makeLayer(def).addTo(loupeMap);
      loupeBase.bringToBack();
    }
    $('#btn-layer').textContent = 'Imagem: ' + def.name;
    try { localStorage.setItem('rainline.layer', def.id); } catch (e) {}
  }

  function initMap() {
    if (map) return;
    if (typeof L === 'undefined') { toast('Mapa não carregou. Verifique a internet e recarregue.'); return; }
    defineArcGISExport();
    map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 22 })
      .setView([28.5384, -81.3789], 18); // Orlando
    L.control.zoom({ position: 'topright' }).addTo(map);
    drawLayer = L.layerGroup().addTo(map);
    initLoupe();
    var rail = document.getElementById('map-dock');
    L.DomEvent.disableClickPropagation(rail);
    L.DomEvent.disableScrollPropagation(rail);
    ['touchstart', 'touchmove', 'pointerdown', 'pointermove', 'mousedown'].forEach(function (ev) {
      rail.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
    });

    var saved = 0;
    try {
      var id = localStorage.getItem('rainline.layer');
      LAYERS.forEach(function (l, i) { if (l.id === id) saved = i; });
    } catch (e) {}
    applyLayer(saved);

    map.on('click', function (e) {
      if (!job) return;
      if (pickMode) { pickHouseAt(e.latlng); return; }
      if (mapMode === 'edit') { select(null); return; }
      if (!job.runs.length) job.runs.push({ points: [] });
      var i = (selected != null && job.runs[selected]) ? selected : job.runs.length - 1;
      job.runs[i].points.push({ lat: e.latlng.lat, lng: e.latlng.lng });
      renderDraw();
    });
  }

  function setMapMode(m) {
    mapMode = m;
    $$('[data-mapmode]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.mapmode === m); });
    $('#tools-draw').hidden = m !== 'draw';
    $('#tools-sel').hidden = m !== 'edit';
    if (m === 'draw') select(null, true);
    else toast('Toque numa linha para selecionar.');
    renderDraw();
  }

  function levelColor(lv) {
    return String(lv) === '2' ? '#4FC3F7' : String(lv) === '3' ? '#C77DFF' : '#FFC91B';
  }

  var SIDES = ['toda', 'frente', 'direita', 'fundo', 'esquerda'];
  function sideName(s2) {
    return { toda: 'casa inteira', frente: 'frente', direita: 'lado direito',
             fundo: 'fundo', esquerda: 'lado esquerdo' }[s2] || 'frente';
  }

  function levelName(lv) {
    return String(lv) === '2' ? '2º andar' : String(lv) === '3' ? '3º' : 'térreo';
  }

  function select(i, quiet) {
    selected = i;
    var has = i != null && job && job.runs[i];
    $('#sel-label').textContent = has
      ? 'Linha ' + (i + 1) + ' · ' + levelName(job.runs[i].level)
      : 'Toque numa linha';
    $$('#lv-group .lv-btn').forEach(function (b) {
      b.classList.toggle('is-on', has && String(job.runs[i].level || 1) === b.dataset.level);
    });
    $('#lv-group').style.opacity = has ? '1' : '.45';
    $('#btn-continue').disabled = !has;
    $('#btn-del-line').disabled = !has;
    if (!quiet) renderDraw();
  }

  function renderDraw() {
    if (!drawLayer) return;
    drawLayer.clearLayers();
    var edit = mapMode === 'edit';

    job.runs.forEach(function (run, ri) {
      var pts = run.points.map(function (p) { return [p.lat, p.lng]; });
      var isSel = selected === ri;

      if (pts.length > 1) {
        L.polyline(pts, { color: '#0E1317', weight: 11, opacity: .35, interactive: false }).addTo(drawLayer);
        var line = L.polyline(pts, {
          color: isSel ? '#2BE0C0' : levelColor(run.level),
          weight: isSel ? 7 : 5, opacity: .97, interactive: edit
        }).addTo(drawLayer);
        if (edit) line.on('click', function (ev) { L.DomEvent.stop(ev); select(ri); });

        for (var i = 1; i < pts.length; i++) {
          var a = run.points[i - 1], b = run.points[i];
          var len = Calc.haversineFt(a, b) * settings.calibration;
          if (len < 5) continue;   // trecho curto: etiqueta só atrapalha
          L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], {
            interactive: false,
            icon: L.divIcon({ className: 'seg-label', html: Math.round(len) + ' ft', iconSize: [48, 18], iconAnchor: [24, 9] })
          }).addTo(drawLayer);
        }
      }

      run.points.forEach(function (p, pi) {
        var mk = L.marker([p.lat, p.lng], {
          draggable: true,
          icon: L.divIcon({ className: 'vertex' + (edit ? ' vertex-edit' : ''), iconSize: [17, 17], iconAnchor: [8.5, 8.5] })
        }).addTo(drawLayer);
        mk.on('dragstart', function () { showLoupe(mk.getLatLng(), ri, pi); });
        mk.on('drag', function (ev) {
          job.runs[ri].points[pi] = { lat: ev.latlng.lat, lng: ev.latlng.lng };
          moveLoupe(ev.latlng, ri, pi);
          updateTape();
        });
        mk.on('dragend', function () { hideLoupe(); renderDraw(); });
        mk.on('click', function (ev) {
          L.DomEvent.stop(ev);
          if (!edit) return;
          job.runs[ri].points.splice(pi, 1);
          if (job.runs[ri].points.length === 0) { job.runs.splice(ri, 1); selected = null; }
          renderDraw(); select(selected, true);
          toast('Ponto removido.');
        });
      });
    });
    updateTape();
  }

  function updateTape() {
    var m = Calc.measure(job ? job.runs : [], settings.calibration, job ? job.manual : []);
    var el = $('#read-feet'), v = String(Math.round(m.feet));
    if (el.textContent !== v) {
      el.textContent = v;
      var main = el.parentNode;
      main.classList.remove('pulse');
      void main.offsetWidth;
      main.classList.add('pulse');
    }
    $('#read-runs').textContent = m.runs;
    $('#read-corners').textContent = m.corners;
    refreshPartsBadge();
  }

  /* ---------- detectar o telhado ---------- */
  function detectRoof() {
    if (!map) return;
    var c = map.getCenter();
    toast('Procurando o contorno do telhado…');
    var q = '[out:json][timeout:20];way(around:28,' + c.lat.toFixed(6) + ',' + c.lng.toFixed(6) + ')["building"];out geom;';
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var ways = (d.elements || []).filter(function (w) { return w.geometry && w.geometry.length > 3; });
        if (!ways.length) { toast('Nenhum contorno encontrado aqui. Desenhe na mão.'); return; }
        // o mais próximo do centro da tela
        ways.sort(function (a, b) { return distToCenter(a, c) - distToCenter(b, c); });
        var g = ways[0].geometry.map(function (n) { return { lat: n.lat, lng: n.lon }; });
        job.runs.push({ points: g });
        selected = job.runs.length - 1;
        renderDraw();
        setMapMode('edit');
        toast('Contorno encontrado. Apague os lados sem calha e ajuste os cantos.');
      })
      .catch(function () { toast('Não consegui consultar agora. Desenhe na mão.'); });
  }

  function distToCenter(w, c) {
    var lat = 0, lng = 0;
    w.geometry.forEach(function (n) { lat += n.lat; lng += n.lon; });
    lat /= w.geometry.length; lng /= w.geometry.length;
    return Calc.haversineFt({ lat: lat, lng: lng }, { lat: c.lat, lng: c.lng });
  }

  /* ---------- lupa de precisão ---------- */
  var loupeMap = null, loupeLayer = null;

  function initLoupe() {
    if (loupeMap) return;
    loupeMap = L.map('loupe-map', {
      zoomControl: false, attributionControl: false, maxZoom: 22,
      dragging: false, touchZoom: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false, inertia: false
    }).setView(map.getCenter(), 21);
    loupeLayer = L.layerGroup().addTo(loupeMap);
  }

  function showLoupe(latlng, ri, pi) {
    if (!loupeMap) return;
    $('#loupe').classList.add('is-on');
    loupeMap.invalidateSize();
    loupeMap.setView(latlng, Math.min(map.getZoom() + 2, 22), { animate: false });
    paintLoupe(latlng, ri, pi);
  }

  function moveLoupe(latlng, ri, pi) {
    if (!loupeMap) return;
    loupeMap.setView(latlng, loupeMap.getZoom(), { animate: false });
    paintLoupe(latlng, ri, pi);
  }

  function hideLoupe() {
    $('#loupe').classList.remove('is-on');
    if (loupeLayer) loupeLayer.clearLayers();
  }

  // desenha dentro da lupa só a linha que está sendo mexida
  function paintLoupe(latlng, ri, pi) {
    loupeLayer.clearLayers();
    var run = job.runs[ri];
    if (!run) return;
    var pts = run.points.map(function (p) { return [p.lat, p.lng]; });
    if (pts.length > 1) {
      L.polyline(pts, { color: '#0E1317', weight: 9, opacity: .4, interactive: false }).addTo(loupeLayer);
      L.polyline(pts, { color: '#2BE0C0', weight: 4, opacity: .95, interactive: false }).addTo(loupeLayer);
    }
    run.points.forEach(function (p, i) {
      if (i === pi) return;   // o ponto arrastado já fica sob a mira
      L.marker([p.lat, p.lng], {
        interactive: false,
        icon: L.divIcon({ className: 'vertex', iconSize: [11, 11], iconAnchor: [5.5, 5.5] })
      }).addTo(loupeLayer);
    });
    // comprimento dos trechos vizinhos ao ponto arrastado
    var parts = [];
    if (pi > 0) parts.push(Math.round(Calc.haversineFt(run.points[pi - 1], run.points[pi]) * settings.calibration));
    if (pi < run.points.length - 1) parts.push(Math.round(Calc.haversineFt(run.points[pi], run.points[pi + 1]) * settings.calibration));
    $('#loupe-tag').textContent = parts.join(' ft · ') + (parts.length ? ' ft' : '');
  }

  /* ---------- detectar telhado na imagem de satélite ----------
     Mesma matemática da foto: recorta o que está na tela, acha as bordas e as
     retas, e devolve como candidatas. Você toca só nas águas que levam calha —
     porque calha vai onde a água escorre, não em todo lado do telhado. */
  var mapCands = [];
  var candLayer = null;

  function mapViewCanvas() {
    var def = LAYERS[layerIdx];
    if (def.type !== 'xyz') def = LAYERS[0];
    var z = map.getZoom();
    var nz = Math.min(Math.round(z), def.max);
    var WS = 256 * Math.pow(2, nz);
    var b = map.getBounds();
    var x0 = lngToPx(b.getWest(), WS), x1 = lngToPx(b.getEast(), WS);
    var y0 = latToPx(b.getNorth(), WS), y1 = latToPx(b.getSouth(), WS);
    var tx0 = Math.floor(x0 / 256), tx1 = Math.floor(x1 / 256);
    var ty0 = Math.floor(y0 / 256), ty1 = Math.floor(y1 / 256);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 36) return Promise.resolve(null);

    var W = (tx1 - tx0 + 1) * 256, H = (ty1 - ty0 + 1) * 256;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    var jobs2 = [];
    for (var tx = tx0; tx <= tx1; tx++) {
      for (var ty = ty0; ty <= ty1; ty++) {
        (function (tx, ty) {
          var url = def.url.replace('{z}', nz).replace('{x}', tx).replace('{y}', ty);
          jobs2.push(loadTile(url).then(function (im) {
            if (im) g.drawImage(im, (tx - tx0) * 256, (ty - ty0) * 256, 256, 256);
          }));
        })(tx, ty);
      }
    }
    return Promise.all(jobs2).then(function () {
      return {
        canvas: cv,
        toPixel: function (lat, lng) {
          return { x: lngToPx(lng, WS) - tx0 * 256, y: latToPx(lat, WS) - ty0 * 256 };
        },
        toLatLng: function (px, py) {
          var wx = tx0 * 256 + px, wy = ty0 * 256 + py;
          var lng = wx / WS * 360 - 180;
          var n = Math.PI - 2 * Math.PI * wy / WS;
          var lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
          return { lat: lat, lng: lng };
        }
      };
    });
  }

  /* ---------- recorte ampliado do satélite ----------
     Você delimita a casa com dois toques; o app monta um recorte em alta
     resolução e abre uma tela de trabalho grande, com zoom de dois dedos.
     Cada toque continua virando latitude/longitude por baixo — a metragem
     permanece geográfica, exata, sem depender de régua. */
  var pickMode = false, rectA = null, rectLayer = null;
  var mapCands = [], candLayer = null;

  function drawCands() {}
  function clearCands() {
    mapCands = [];
    if (candLayer) candLayer.clearLayers();
    if (rectLayer && map) { map.removeLayer(rectLayer); rectLayer = null; }
    pickMode = false; rectA = null;
  }

  function startPickHouse() {
    if (!map) return;
    pickMode = true; rectA = null;
    if (rectLayer) { map.removeLayer(rectLayer); rectLayer = null; }
    setMapMode('draw');
    toast('Toque num canto do terreno e depois no canto oposto, cercando a casa.');
  }

  function pickHouseAt(latlng) {
    if (!rectA) {
      rectA = latlng;
      if (rectLayer) map.removeLayer(rectLayer);
      rectLayer = L.circleMarker(latlng, { radius: 7, color: '#2BE0C0', weight: 3 }).addTo(map);
      toast('Agora o canto oposto.');
      return;
    }
    var bb = L.latLngBounds(rectA, latlng);
    if (rectLayer) map.removeLayer(rectLayer);
    rectLayer = null;
    pickMode = false; rectA = null;
    openCrop(bb);
  }

  /* ---------- tela de recorte: desenhar sobre o satélite ampliado ---------- */
  var cp = {
    img: null, w: 0, h: 0,
    view: { z: 1, ox: 0, oy: 0 },
    fit: { x: 0, y: 0, s: 1 },
    toLatLng: null, toPixel: null,
    ortho: true, boost: false, drag: null
  };

  function cropCanvas() { return document.getElementById('crop-canvas'); }

  function openCrop(bounds) {
    toast('Preparando o recorte…');
    cropTiles(bounds).then(function (v) {
      if (!v) { toast('Aproxime o mapa e tente de novo.'); return; }
      cp.img = v.canvas; cp.w = v.canvas.width; cp.h = v.canvas.height;
      cp.toLatLng = v.toLatLng; cp.toPixel = v.toPixel;
      cp.view = { z: 1, ox: 0, oy: 0 };
      go('crop');
      setTimeout(function () { computeCropFit(); drawCrop(); }, 80);
      toast('Toque nos cantos do beiral. Cada trecho mostra a medida.');
    }).catch(function () { toast('Não consegui montar o recorte.'); });
  }

  // monta o recorte no maior zoom possível, com folga em volta
  function cropTiles(b) {
    var def = LAYERS[layerIdx];
    if (def.type !== 'xyz') def = LAYERS[0];
    var padLat = (b.getNorth() - b.getSouth()) * 0.12;
    var padLng = (b.getEast() - b.getWest()) * 0.12;
    var N = b.getNorth() + padLat, S = b.getSouth() - padLat;
    var Wl = b.getWest() - padLng, E = b.getEast() + padLng;

    var z = 22, WS, w, h;
    for (; z > 15; z--) {
      WS = 256 * Math.pow(2, z);
      w = lngToPx(E, WS) - lngToPx(Wl, WS);
      h = latToPx(S, WS) - latToPx(N, WS);
      if (w <= 2200 && h <= 2200) break;
    }
    WS = 256 * Math.pow(2, z);
    var x0 = lngToPx(Wl, WS), y0 = latToPx(N, WS);
    var tx0 = Math.floor(x0 / 256), tx1 = Math.floor(lngToPx(E, WS) / 256);
    var ty0 = Math.floor(y0 / 256), ty1 = Math.floor(latToPx(S, WS) / 256);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64) return Promise.resolve(null);

    var nz = Math.min(z, def.max);
    var scale = Math.pow(2, z - nz);
    var CW = (tx1 - tx0 + 1) * 256, CH = (ty1 - ty0 + 1) * 256;
    var cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    var g = cv.getContext('2d');
    g.fillStyle = '#22303A'; g.fillRect(0, 0, CW, CH);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';

    var jobs2 = [];
    for (var tx = tx0; tx <= tx1; tx++) {
      for (var ty = ty0; ty <= ty1; ty++) {
        (function (tx, ty) {
          var sx = Math.floor(tx / scale), sy = Math.floor(ty / scale);
          var url = def.url.replace('{z}', nz).replace('{x}', sx).replace('{y}', sy);
          jobs2.push(loadTile(url).then(function (im) {
            if (!im) return;
            var dx = (tx - tx0) * 256, dy = (ty - ty0) * 256;
            if (scale === 1) { g.drawImage(im, dx, dy, 256, 256); return; }
            var sub = 256 / scale;
            g.drawImage(im, (tx % scale) * sub, (ty % scale) * sub, sub, sub, dx, dy, 256, 256);
          }));
        })(tx, ty);
      }
    }
    return Promise.all(jobs2).then(function () {
      var ox = tx0 * 256, oy = ty0 * 256;
      return {
        canvas: cv,
        toLatLng: function (px, py) {
          var wx = ox + px, wy = oy + py;
          var lng = wx / WS * 360 - 180;
          var n = Math.PI - 2 * Math.PI * wy / WS;
          return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: lng };
        },
        toPixel: function (lat, lng) {
          return { x: lngToPx(lng, WS) - ox, y: latToPx(lat, WS) - oy };
        }
      };
    });
  }

  function computeCropFit() {
    var st = document.getElementById('crop-stage');
    if (!st || !cp.img) return cp.fit;
    var W = st.clientWidth, H = st.clientHeight;
    var base = Math.min(W / cp.w, H / cp.h);
    cp.fit = {
      x: (W - cp.w * base) / 2 + cp.view.ox,
      y: (H - cp.h * base) / 2 + cp.view.oy,
      s: base * cp.view.z, base: base
    };
    return cp.fit;
  }

  function clampCrop() {
    var st = document.getElementById('crop-stage');
    if (!st || !cp.img) return;
    var W = st.clientWidth, H = st.clientHeight, lim = 60;
    var base = Math.min(W / cp.w, H / cp.h);
    var iw = cp.w * base * cp.view.z, ih = cp.h * base * cp.view.z;
    var cx = (W - cp.w * base) / 2, cy = (H - cp.h * base) / 2;
    var maxOx = lim - cx, minOx = W - iw - lim - cx;
    var maxOy = lim - cy, minOy = H - ih - lim - cy;
    cp.view.ox = (minOx > maxOx) ? (minOx + maxOx) / 2 : Math.max(minOx, Math.min(maxOx, cp.view.ox));
    cp.view.oy = (minOy > maxOy) ? (minOy + maxOy) / 2 : Math.max(minOy, Math.min(maxOy, cp.view.oy));
  }

  // trava o ponto em 90° em relação ao trecho anterior
  function orthoSnap(run, p) {
    if (!cp.ortho || run.points.length < 1) return p;
    var prev = cp.toPixel(run.points[run.points.length - 1].lat, run.points[run.points.length - 1].lng);
    var vx = p.x - prev.x, vy = p.y - prev.y;
    if (Math.hypot(vx, vy) < 4) return p;

    if (run.points.length === 1) {                 // primeiro trecho: horizontal ou vertical
      return Math.abs(vx) > Math.abs(vy)
        ? { x: p.x, y: prev.y } : { x: prev.x, y: p.y };
    }
    var a = cp.toPixel(run.points[run.points.length - 2].lat, run.points[run.points.length - 2].lng);
    var ux = prev.x - a.x, uy = prev.y - a.y;
    var L = Math.hypot(ux, uy);
    if (L < 1) return p;
    ux /= L; uy /= L;
    var along = vx * ux + vy * uy;                  // componente na mesma direção
    var perpX = -uy, perpY = ux;
    var perp = vx * perpX + vy * perpY;             // componente perpendicular
    // fica com a projeção dominante: continua reto ou vira exatamente 90°
    return Math.abs(along) >= Math.abs(perp)
      ? { x: prev.x + ux * along, y: prev.y + uy * along }
      : { x: prev.x + perpX * perp, y: prev.y + perpY * perp };
  }

  function drawCrop() {
    var c = cropCanvas();
    if (!c || !cp.img) return;
    var st = document.getElementById('crop-stage');
    var W = st.clientWidth, H = st.clientHeight;
    var dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    var f = computeCropFit();
    g.filter = cp.boost ? 'contrast(1.32) saturate(1.15) brightness(1.06)' : 'none';
    g.imageSmoothingEnabled = cp.view.z < 3;
    g.drawImage(cp.img, f.x, f.y, cp.w * f.s, cp.h * f.s);
    g.filter = 'none';

    function P(ll) {
      var q = cp.toPixel(ll.lat, ll.lng);
      return [f.x + q.x * f.s, f.y + q.y * f.s];
    }

    g.lineCap = 'round'; g.lineJoin = 'round';
    job.runs.forEach(function (run) {
      var pts = run.points;
      if (pts.length > 1) {
        g.strokeStyle = 'rgba(14,19,23,.5)'; g.lineWidth = 10;
        g.beginPath(); pts.forEach(function (p, i) { var a = P(p); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); g.stroke();
        g.strokeStyle = levelColor(run.level); g.lineWidth = 5;
        g.beginPath(); pts.forEach(function (p, i) { var a = P(p); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); g.stroke();

        g.font = '600 14px "IBM Plex Mono", monospace';
        for (var i = 1; i < pts.length; i++) {
          var len = Calc.haversineFt(pts[i - 1], pts[i]) * settings.calibration;
          if (len < 4) continue;
          var A = P(pts[i - 1]), B = P(pts[i]);
          var mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
          var txt = Math.round(len) + ' ft';
          var w = g.measureText(txt).width + 12;
          g.fillStyle = 'rgba(14,19,23,.9)'; g.fillRect(mx - w / 2, my - 11, w, 22);
          g.fillStyle = levelColor(run.level); g.fillText(txt, mx - w / 2 + 6, my + 5);
        }
      }
      pts.forEach(function (p) {
        var a = P(p);
        g.fillStyle = levelColor(run.level); g.beginPath(); g.arc(a[0], a[1], 7, 0, 6.284); g.fill();
        g.strokeStyle = '#0E1317'; g.lineWidth = 2.5; g.stroke();
      });
    });

    var m = Calc.measure(job.runs, settings.calibration, job.manual);
    $('#crop-ft').textContent = Math.round(m.feet);
    $('#crop-total').textContent = Math.round(m.feet);
    $('#crop-zoom').textContent = cp.view.z.toFixed(1) + '×';
    $('#crop-info').textContent = m.runs + ' linha(s) · ' + m.corners + ' cantos';
    updateTape();
  }

  /* --- gestos e botões da tela de recorte --- */
  (function () {
    var cv = cropCanvas();
    if (!cv) return;
    var pts = {}, moved = false, panFrom = null, pendingDrag = null;
    var startD = 0, startZ = 1, startMid = null, startOx = 0, startOy = 0;

    function toImg(cx, cy) {
      var r = cv.getBoundingClientRect(), f = computeCropFit();
      return { x: (cx - r.left - f.x) / f.s, y: (cy - r.top - f.y) / f.s };
    }

    function hit(p) {
      var f = computeCropFit(), tol = 18 / f.s, best = null, bd = tol;
      job.runs.forEach(function (run, ri) {
        run.points.forEach(function (ll, pi) {
          var q = cp.toPixel(ll.lat, ll.lng);
          var d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < bd) { bd = d; best = { ri: ri, pi: pi }; }
        });
      });
      return best;
    }

    function ids() { return Object.keys(pts); }

    cv.addEventListener('pointerdown', function (e) {
      if (!cp.img) return;
      cv.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = ids().length;
      if (n === 1) {
        moved = false;
        pendingDrag = hit(toImg(e.clientX, e.clientY));
        cp.drag = null;
        panFrom = { x: e.clientX, y: e.clientY, ox: cp.view.ox, oy: cp.view.oy };
      } else if (n === 2) {
        cp.drag = null; pendingDrag = null; moved = true;
        var k = ids();
        startD = Math.hypot(pts[k[0]].x - pts[k[1]].x, pts[k[0]].y - pts[k[1]].y);
        startZ = cp.view.z; startOx = cp.view.ox; startOy = cp.view.oy;
        var r = cv.getBoundingClientRect();
        startMid = { x: (pts[k[0]].x + pts[k[1]].x) / 2 - r.left,
                     y: (pts[k[0]].y + pts[k[1]].y) / 2 - r.top };
      }
    });

    cv.addEventListener('pointermove', function (e) {
      if (!cp.img || !pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var k = ids();
      if (k.length >= 2) {
        var d = Math.hypot(pts[k[0]].x - pts[k[1]].x, pts[k[0]].y - pts[k[1]].y);
        if (startD > 0) {
          var z = Math.max(1, Math.min(14, startZ * (d / startD)));
          var fr = z / startZ;
          cp.view.z = z;
          cp.view.ox = startMid.x - (startMid.x - startOx) * fr;
          cp.view.oy = startMid.y - (startMid.y - startOy) * fr;
          clampCrop(); drawCrop();
        }
        return;
      }
      var dx = e.clientX - panFrom.x, dy = e.clientY - panFrom.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        if (!moved && pendingDrag) cp.drag = pendingDrag;
        moved = true;
      }
      if (cp.drag) {
        var p = toImg(e.clientX, e.clientY);
        var ll = cp.toLatLng(p.x, p.y);
        job.runs[cp.drag.ri].points[cp.drag.pi] = { lat: ll.lat, lng: ll.lng };
        showCropLoupe(p);
        drawCrop();
      } else if (moved) {
        cp.view.ox = panFrom.ox + dx; cp.view.oy = panFrom.oy + dy;
        clampCrop(); drawCrop();
      }
    });

    function end(e) {
      if (!pts[e.pointerId]) return;
      var wasMoved = moved;
      delete pts[e.pointerId];
      if (ids().length === 0) {
        cp.drag = null; pendingDrag = null;
        hideCropLoupe();
        if (!wasMoved && cp.img) addCropPoint(e.clientX, e.clientY);
        renderDraw();
      }
      if (ids().length === 1) {
        var k = ids()[0];
        panFrom = { x: pts[k].x, y: pts[k].y, ox: cp.view.ox, oy: cp.view.oy };
        moved = true;
      }
    }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    function addCropPoint(cx, cy) {
      var p = toImg(cx, cy);
      if (p.x < 0 || p.y < 0 || p.x > cp.w || p.y > cp.h) return;
      if (!job.runs.length) job.runs.push({ points: [], level: 1 });
      var run = job.runs[job.runs.length - 1];
      p = orthoSnap(run, p);
      var ll = cp.toLatLng(p.x, p.y);
      run.points.push({ lat: ll.lat, lng: ll.lng });
      drawCrop();
    }

    cv.addEventListener('wheel', function (e) {
      if (!cp.img) return;
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var z = Math.max(1, Math.min(14, cp.view.z * (e.deltaY < 0 ? 1.15 : 0.87)));
      var fr = z / cp.view.z;
      cp.view.z = z;
      cp.view.ox = mx - (mx - cp.view.ox) * fr;
      cp.view.oy = my - (my - cp.view.oy) * fr;
      clampCrop(); drawCrop();
    }, { passive: false });
  })();

  function showCropLoupe(p) {
    var el = document.getElementById('crop-loupe');
    if (!el || !cp.img) return;
    el.classList.add('is-on');
    var g = el.getContext('2d'), S = 336, Z = 3;
    var scale = cp.fit.s * Z * 2, half = S / (2 * scale);
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#22303A'; g.fillRect(0, 0, S, S);
    g.drawImage(cp.img, p.x - half, p.y - half, half * 2, half * 2, 0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(S / 2 - 26, S / 2); g.lineTo(S / 2 + 26, S / 2);
    g.moveTo(S / 2, S / 2 - 26); g.lineTo(S / 2, S / 2 + 26);
    g.stroke();
  }
  function hideCropLoupe() {
    var el = document.getElementById('crop-loupe');
    if (el) el.classList.remove('is-on');
  }

  function cropZoom(mult) {
    if (!cp.img) return;
    var st = document.getElementById('crop-stage');
    var mx = st.clientWidth / 2, my = st.clientHeight / 2;
    var z = Math.max(1, Math.min(14, cp.view.z * mult));
    var f = z / cp.view.z;
    cp.view.z = z;
    cp.view.ox = mx - (mx - cp.view.ox) * f;
    cp.view.oy = my - (my - cp.view.oy) * f;
    clampCrop(); drawCrop();
  }

  $('#crop-zin').addEventListener('click', function () { cropZoom(1.6); });
  $('#crop-zout').addEventListener('click', function () { cropZoom(1 / 1.6); });
  $('#crop-zfit').addEventListener('click', function () {
    cp.view = { z: 1, ox: 0, oy: 0 }; drawCrop();
  });
  $('#crop-ortho').addEventListener('click', function () {
    cp.ortho = !cp.ortho;
    $('#crop-ortho').classList.toggle('is-on', cp.ortho);
    toast(cp.ortho ? 'Ângulo travado em 90°.' : 'Ângulo livre.');
  });
  $('#crop-boost').addEventListener('click', function () {
    cp.boost = !cp.boost;
    $('#crop-boost').classList.toggle('is-on', cp.boost);
    drawCrop();
  });
  $('#crop-close').addEventListener('click', function () {
    var run = job.runs[job.runs.length - 1];
    if (!run || run.points.length < 3) { toast('Marque pelo menos 3 cantos antes de fechar.'); return; }
    var a = run.points[0], b = run.points[run.points.length - 1];
    if (Calc.haversineFt(a, b) < 2) { toast('Esta volta já está fechada.'); return; }
    run.points.push({ lat: a.lat, lng: a.lng });
    job.runs.push({ points: [], level: 1 });
    drawCrop(); renderDraw();
    toast('Volta fechada.');
  });
  $('#crop-undo').addEventListener('click', function () {
    if (!job.runs.length) return;
    var i = job.runs.length - 1;
    job.runs[i].points.pop();
    if (!job.runs[i].points.length && job.runs.length > 1) job.runs.pop();
    drawCrop(); renderDraw();
  });
  $('#crop-newline').addEventListener('click', function () {
    var last = job.runs[job.runs.length - 1];
    if (last && !last.points.length) { toast('A linha atual está vazia.'); return; }
    job.runs.push({ points: [], level: 1 });
    toast('Linha nova.');
  });
  $('#crop-clear').addEventListener('click', function () {
    job.runs = []; drawCrop(); renderDraw();
  });
  $('#crop-done').addEventListener('click', function () {
    go('map');
    setTimeout(function () { if (map) { map.invalidateSize(); renderDraw(); } }, 80);
  });

  if (window.ResizeObserver) {
    var cropRo = new ResizeObserver(function () {
      if (cp.img && document.getElementById('screen-crop').classList.contains('is-active')) {
        computeCropFit(); clampCrop(); drawCrop();
      }
    });
    cropRo.observe(document.getElementById('crop-stage'));
  }

  /* ---------- botões do mapa ---------- */
  $$('[data-mapmode]').forEach(function (b) {
    b.addEventListener('click', function () { setMapMode(b.dataset.mapmode); });
  });
  $('#btn-detect').addEventListener('click', startPickHouse);
  $('#btn-detect-osm').addEventListener('click', detectRoof);
  $('#btn-undo').addEventListener('click', function () {
    if (!job || !job.runs.length) return;
    var i = (selected != null && job.runs[selected]) ? selected : job.runs.length - 1;
    job.runs[i].points.pop();
    if (!job.runs[i].points.length && job.runs.length > 1) { job.runs.splice(i, 1); selected = null; }
    renderDraw();
  });
  $('#btn-newline').addEventListener('click', function () {
    if (!job) return;
    var last = job.runs[job.runs.length - 1];
    if (last && !last.points.length) { toast('A linha atual ainda está vazia.'); return; }
    var lv = job.runs.length ? (job.runs[job.runs.length - 1].level || 1) : 1;
    job.runs.push({ points: [], level: lv });
    selected = job.runs.length - 1;
    setMapMode('draw');
    toast('Linha nova. Toque no primeiro canto do beiral.');
  });
  $('#btn-clear').addEventListener('click', function () {
    if (!job) return;
    job.runs = []; selected = null; clearCands(); renderDraw();
  });
  $('#btn-continue').addEventListener('click', function () {
    if (selected == null) { toast('Selecione uma linha primeiro.'); return; }
    setMapMode('draw');
    toast('Os próximos toques entram nesta linha.');
  });
  $('#btn-del-line').addEventListener('click', function () {
    if (selected == null) return;
    job.runs.splice(selected, 1);
    selected = null;
    renderDraw(); select(null, true);
    toast('Linha apagada.');
  });
  $$('#lv-group .lv-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (selected == null) { toast('Selecione uma linha primeiro.'); return; }
      job.runs[selected].level = +b.dataset.level;
      renderDraw(); select(selected, true);
      toast('Linha marcada como ' + levelName(b.dataset.level) + '.');
    });
  });

  $('#btn-3d').addEventListener('click', function () {
    if (!map) return;
    var c = map.getCenter();
    window.open('https://www.bing.com/maps?cp=' + c.lat.toFixed(6) + '~' + c.lng.toFixed(6) +
                '&lvl=19&style=b', '_blank');
  });
  $('#btn-sv').addEventListener('click', function () {
    if (!map) return;
    var c = map.getCenter();
    window.open('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' +
                c.lat.toFixed(6) + ',' + c.lng.toFixed(6), '_blank');
  });

  $('#btn-layer').addEventListener('click', function () {
    applyLayer(layerIdx + 1);
    toast('Imagem: ' + LAYERS[layerIdx].name + '. Se ficar em branco, toque de novo.');
  });

  $('#btn-enhance').addEventListener('click', function () {
    var on = document.body.classList.toggle('tiles-boost');
    $('#btn-enhance').classList.toggle('is-on', on);
    toast(on ? 'Contraste reforçado.' : 'Imagem original.');
  });

  $('#btn-relocate').addEventListener('click', useGps);
  $('#btn-find').addEventListener('click', geocode);
  $('#btn-to-materials').addEventListener('click', function () {
    var m = Calc.measure(job.runs, settings.calibration, job.manual);
    if (m.feet < 1) { toast('Desenhe pelo menos uma linha sobre o beiral.'); return; }
    job.overrides = {};
    go('materials');
  });

  /* ---------- exemplo pronto (para testar) ---------- */
  $('#btn-demo').addEventListener('click', function () {
    newJob();
    job.client = {
      name: 'John & Mary Carter', phone: '(407) 555-0142', email: 'carter@example.com',
      address: '842 Oakfield Ln', city: 'Winter Garden', state: 'FL', zip: '34787', notes: 'Exemplo de demonstração'
    };
    job.stories = 1; job.color = 'White';
    // frente em L + fundo reto — aprox. 156 ft
    job.runs = [
      { points: [
        { lat: 28.565300, lng: -81.586200 },
        { lat: 28.565300, lng: -81.586037 },
        { lat: 28.565251, lng: -81.586037 },
        { lat: 28.565251, lng: -81.585962 }
      ] },
      { points: [
        { lat: 28.565190, lng: -81.586200 },
        { lat: 28.565190, lng: -81.586006 }
      ] }
    ];
    job.center = { lat: 28.565245, lng: -81.586090 };
    $('#map-title').textContent = job.client.name;
    go('map');
    initMap();
    if (!map) return;
    map.setView([job.center.lat, job.center.lng], 21);
    setMapMode('draw');
    renderDraw();
    toast('Exemplo carregado. Arraste os pontos amarelos para ver a medida mudar.');
  });

  /* ---------- medições (resumo por andar) ---------- */
  function partsCount() {
    return (job ? job.runs.filter(function (r) { return r.points.length > 1; }).length : 0) +
           (job && job.manual ? job.manual.length : 0);
  }

  function refreshPartsBadge() {
    var el = $('#parts-count');
    if (el) el.textContent = partsCount();
  }

  function renderParts() {
    var m = Calc.measure(job.runs, settings.calibration, job.manual);
    $('#parts-total').textContent = Math.round(m.feet);

    var lv = m.byLevel || {};
    $('#parts-levels').innerHTML = ['1', '2', '3'].filter(function (k) { return lv[k]; })
      .map(function (k) {
        return '<div class="total-line"><span>' + levelName(k) + '</span><b>' + Math.round(lv[k]) + ' ft</b></div>';
      }).join('') || '<p class="hint" style="margin:0">Nada medido ainda.</p>';

    // satélite
    var sat = '';
    job.runs.forEach(function (r, i) {
      if (r.points.length < 2) return;
      var f = Calc.measure([r], settings.calibration).feet;
      sat += '<div class="part-row"><div class="part-main"><b>Linha ' + (i + 1) + '</b>' +
        '<small>' + r.points.length + ' pontos no satélite</small>' + lvMini('r', i, r.level) + '</div>' +
        '<span class="part-ft">' + Math.round(f) + ' ft</span>' +
        '<button class="mini-x" data-del-run="' + i + '">✕</button></div>';
    });
    $('#parts-sat').innerHTML = sat || '<p class="hint" style="margin:0">Nenhuma linha no satélite ainda.</p>';

    // fotos
    var ph2 = '';
    (job.manual || []).forEach(function (e, i) {
      ph2 += '<div class="part-row">' +
        (e.thumb || e.key
          ? '<img class="thumb" src="' + (e.thumb || Api.photoUrl(e.key)) + '" alt="" data-open-photo="' + i + '">'
          : '') +
        '<div class="part-main"><b>' + (e.note || 'Foto') + '</b>' +
        '<small>' + (e.corners || 0) + ' cantos · toque na foto para editar</small>' +
        lvMini('m', i, e.level) + '</div>' +
        '<span class="part-ft">' + Math.round(e.feet) + ' ft</span>' +
        '<button class="mini-x" data-del-man="' + i + '">✕</button></div>';
    });
    $('#parts-photo').innerHTML = ph2 || '<p class="hint" style="margin:0">Nenhuma foto medida ainda.</p>';

    var done = {};
    (job.manual || []).forEach(function (e) {
      if (!e.side) return;
      done[e.side] = true;
      if (e.side === 'toda') SIDES.forEach(function (k) { done[k] = true; });
    });
    $('#sides-check').innerHTML = SIDES.map(function (k) {
      return '<span class="side-chip ' + (done[k] ? 'ok' : '') + '">' +
        (done[k] ? '✓ ' : '') + sideName(k) + '</span>';
    }).join('');
    refreshPartsBadge();
  }

  function lvMini(kind, i, cur) {
    return '<div class="lv-mini">' + ['1', '2', '3'].map(function (k) {
      return '<button data-lv="' + kind + ':' + i + ':' + k + '" class="' +
        (String(cur || 1) === k ? 'is-on' : '') + '">' + levelName(k) + '</button>';
    }).join('') + '</div>';
  }

  $('#screen-parts').addEventListener('click', function (e) {
    var t = e.target;
    if (t.dataset.delRun != null) {
      job.runs.splice(+t.dataset.delRun, 1); selected = null;
      renderDraw(); renderParts(); return;
    }
    if (t.dataset.delMan != null) {
      job.manual.splice(+t.dataset.delMan, 1); renderParts(); updateTape(); return;
    }
    if (t.dataset.lv) {
      var p = t.dataset.lv.split(':');
      if (p[0] === 'r') job.runs[+p[1]].level = +p[2];
      else job.manual[+p[1]].level = +p[2];
      renderDraw(); renderParts(); return;
    }
    if (t.dataset.openPhoto != null) { openPhoto(+t.dataset.openPhoto); }
  });

  $('#btn-parts').addEventListener('click', function () { go('parts'); });
  $('#btn-back-map').addEventListener('click', function () { go('map'); });
  $('#btn-add-photo').addEventListener('click', function () { openPhoto(null); });
  $('#btn-parts-next').addEventListener('click', function () {
    var m = Calc.measure(job.runs, settings.calibration, job.manual);
    if (m.feet < 1) { toast('Meça alguma coisa antes.'); return; }
    job.overrides = {};
    go('materials');
  });

  /* ---------- medir na foto (fachada / Street View) ----------
     Foto não tem escala. O usuário traça uma referência de tamanho conhecido
     (porta de garagem, porta comum) e o app converte pixel em pé por
     proporção. Vale para linhas no mesmo plano da fachada. */
  var ph = {
    img: null, w: 0, h: 0,          // imagem e tamanho natural
    fit: { x: 0, y: 0, s: 1 },      // como ela está desenhada na tela
    step: 'ref',
    ref: [],                        // 2 pontos da referência
    runs: [[]],                     // beirais, em pixels da imagem
    dsRuns: [[]],                   // descidas (downspouts) — contadas, não somadas em ft
    scale: 0,                       // pés por pixel
    level: 1,
    view: { z: 1, ox: 0, oy: 0 },   // zoom e deslocamento da foto na tela
    drag: null,                     // ponto sendo arrastado
    edge: null,                     // mapa de bordas (Sobel) da imagem
    edgeCanvas: null,               // desenho das bordas para sobrepor
    snap: true,                     // encaixar o ponto na borda mais forte
    onlyH: true,                    // só linhas quase horizontais
    side: 'frente',                 // qual lado da casa esta foto mostra
    unit: 'ft',                     // unidade da referência digitada
    showEdges: false
  };

  /* --- detecção de bordas: Sobel numa cópia reduzida da foto ---
     Não é reconhecimento de objeto. É matemática de contraste: onde a cor muda
     bruscamente, há uma aresta. Serve para o ponto grudar na linha do telhado
     em vez de ficar 3 px torto. */
  function buildEdges(img) { ph.edge = computeEdges(img, 900); ph.edgeCanvas = ph.edge.overlay; }

  function computeEdges(img, MAX) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var sc = Math.min(1, MAX / iw);
    var w = Math.max(1, Math.round(iw * sc));
    var h = Math.max(1, Math.round(ih * sc));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    var src;
    try { src = g.getImageData(0, 0, w, h).data; } catch (e) { return null; }

    var gray = new Float32Array(w * h);
    for (var i = 0, j = 0; i < src.length; i += 4, j++) {
      gray[j] = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114);
    }

    /* Desfoque gaussiano antes do gradiente.
       É o que separa "textura" de "estrutura": grama, folhagem e as fileiras de
       telha são detalhe fino e somem no borrão; a linha do beiral, que é longa,
       sobrevive. Sem esta etapa o detector via mato com a mesma força que calha. */
    var K = [1, 4, 6, 4, 1], KS = 16;
    var tmp = new Float32Array(w * h), blur = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var acc = 0;
        for (var k = -2; k <= 2; k++) {
          var xx = Math.min(w - 1, Math.max(0, x + k));
          acc += gray[y * w + xx] * K[k + 2];
        }
        tmp[y * w + x] = acc / KS;
      }
    }
    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        var acc2 = 0;
        for (var k2 = -2; k2 <= 2; k2++) {
          var yy = Math.min(h - 1, Math.max(0, y2 + k2));
          acc2 += tmp[yy * w + x2] * K[k2 + 2];
        }
        blur[y2 * w + x2] = acc2 / KS;
      }
    }

    var raw = new Float32Array(w * h);
    var dir = new Uint8Array(w * h);        // 0=—  1=/  2=|  3=\
    var ang = new Float32Array(w * h);      // ângulo da borda, para filtrar depois
    var max = 1;
    for (var y3 = 1; y3 < h - 1; y3++) {
      for (var x3 = 1; x3 < w - 1; x3++) {
        var o = y3 * w + x3;
        var gx = -blur[o - w - 1] - 2 * blur[o - 1] - blur[o + w - 1]
                 + blur[o - w + 1] + 2 * blur[o + 1] + blur[o + w + 1];
        var gy = -blur[o - w - 1] - 2 * blur[o - w] - blur[o - w + 1]
                 + blur[o + w - 1] + 2 * blur[o + w] + blur[o + w + 1];
        var m = Math.sqrt(gx * gx + gy * gy);
        if (m > max) max = m;
        raw[o] = m;
        var a2 = Math.atan2(gy, gx);                       // direção do gradiente
        ang[o] = a2 + Math.PI / 2;                         // direção da borda
        var deg = (a2 * 180 / Math.PI + 180) % 180;
        dir[o] = (deg < 22.5 || deg >= 157.5) ? 0 : (deg < 67.5) ? 1 : (deg < 112.5) ? 2 : 3;
      }
    }

    /* Supressão de não-máximos: mantém só a crista da borda.
       Uma borda de 4 px de largura vira uma linha de 1 px, e aí a detecção
       consegue casar as retas em vez de se perder na espessura. */
    var mag = new Uint8ClampedArray(w * h);
    var kk = 255 / max;
    for (var y4 = 1; y4 < h - 1; y4++) {
      for (var x4 = 1; x4 < w - 1; x4++) {
        var o4 = y4 * w + x4, v = raw[o4], p1, p2;
        if (dir[o4] === 0) { p1 = raw[o4 - 1]; p2 = raw[o4 + 1]; }
        else if (dir[o4] === 1) { p1 = raw[o4 - w + 1]; p2 = raw[o4 + w - 1]; }
        else if (dir[o4] === 2) { p1 = raw[o4 - w]; p2 = raw[o4 + w]; }
        else { p1 = raw[o4 - w - 1]; p2 = raw[o4 + w + 1]; }
        mag[o4] = (v >= p1 && v >= p2) ? v * kk : 0;
      }
    }

    // limiar pelo histograma da própria imagem
    var hist = new Uint32Array(256);
    for (var hh = 0; hh < mag.length; hh++) hist[mag[hh]]++;
    var nonzero = mag.length - hist[0];
    var want = Math.round(nonzero * 0.14), cum = 0, cut = 60;
    for (var bb = 255; bb >= 5; bb--) {
      cum += hist[bb];
      if (cum >= want) { cut = bb; break; }
    }
    cut = Math.max(22, Math.min(120, cut));

    var edge = { w: w, h: h, mag: mag, ang: ang, cut: cut, sx: w / iw, sy: h / ih };

    // camada visual das bordas
    var TH = Math.max(18, cut - 10);
    var thick = new Uint8ClampedArray(w * h);
    for (var yy2 = 1; yy2 < h - 1; yy2++) {
      for (var xx2 = 1; xx2 < w - 1; xx2++) {
        var oo = yy2 * w + xx2, mx = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var vv = mag[oo + dy * w + dx];
            if (vv > mx) mx = vv;
          }
        }
        thick[oo] = mx;
      }
    }
    var oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    var og = oc.getContext('2d');
    var id = og.createImageData(w, h);
    for (var q = 0, r = 0; q < thick.length; q++, r += 4) {
      id.data[r] = 43; id.data[r + 1] = 255; id.data[r + 2] = 214;
      id.data[r + 3] = thick[q] > TH ? 255 : 0;
    }
    og.putImageData(id, 0, 0);
    edge.overlay = oc;
    return edge;
  }

  // puxa o ponto para a borda mais forte por perto
  function snapToEdge(p) {
    if (!ph.snap || !ph.edge) return p;
    var R = Math.max(3, Math.round(16 / ph.fit.s * ph.edge.sx));   // ~16 px de tela
    var cx = Math.round(p.x * ph.edge.sx), cy = Math.round(p.y * ph.edge.sy);
    var best = null, bv = ph.edge.cut;                              // limiar mínimo
    for (var y = cy - R; y <= cy + R; y++) {
      if (y < 1 || y >= ph.edge.h - 1) continue;
      for (var x = cx - R; x <= cx + R; x++) {
        if (x < 1 || x >= ph.edge.w - 1) continue;
        var v = ph.edge.mag[y * ph.edge.w + x];
        var dist = Math.hypot(x - cx, y - cy);
        if (dist > R) continue;
        var score = v - dist * 2.2;                                  // perto pesa mais
        if (v > bv && score > (best ? best.s : -1e9)) best = { x: x, y: y, s: score };
      }
    }
    if (!best) return p;
    return { x: best.x / ph.edge.sx, y: best.y / ph.edge.sy };
  }


  function photoCanvas() { return document.getElementById('photo-canvas'); }

  function openPhoto(idx) {
    ph.editing = (idx == null) ? null : idx;
    if (idx == null) {
      ph.img = null; ph.ref = []; ph.runs = [[]]; ph.dsRuns = [[]]; ph.scale = 0; ph.level = 1;
      try {
        var last = localStorage.getItem('rainline.ref');
        if (last) $('#ref-feet').value = last;
      } catch (e) {}
      $('#photo-empty').hidden = false;
      setPhotoStep('ref');
    } else {
      var e = job.manual[idx];
      ph.level = e.level || 1;
      ph.side = e.side || 'frente';
      $$('[data-side]').forEach(function (o) {
        o.classList.toggle('is-on', o.dataset.side === ph.side);
      });
      ph.pendingEntry = e;                        // as coordenadas só depois que a imagem carregar
      // o valor gravado está sempre em pés: força a unidade certa
      ph.unit = 'ft';
      $$('#unit-sw .u-btn').forEach(function (o) { o.classList.toggle('is-on', o.dataset.unit === 'ft'); });
      $('#ref-feet').value = e.refFeet || 16;
      refLabel((e.refFeet || 16) + ' ft');
      var srcImg = e.img || (e.key ? Api.photoUrl(e.key) : null);
      if (srcImg) {
        var im = new Image();
        im.onload = function () {
          ph.img = im; ph.w = im.naturalWidth; ph.h = im.naturalHeight;
          ph.view = { z: 1, ox: 0, oy: 0 };
          buildEdges(im);
          restoreEntryPoints(ph.pendingEntry);
          ph.pendingEntry = null;
          $('#photo-empty').hidden = true;
          setPhotoStep('measure'); recalcPhoto();
        };
        im.src = srcImg;
      } else {
        $('#photo-empty').hidden = false;
        toast('A foto original não coube na memória do aparelho. Anexe de novo para editar.');
      }
    }
    $$('[data-plevel]').forEach(function (o) {
      o.classList.toggle('is-on', +o.dataset.plevel === ph.level);
    });
    go('photo');
    setBarMin(true);
    setFull(false);
    setTimeout(function () { recalcPhoto(); }, 80);
  }

  $('#btn-photo').addEventListener('click', function () { openPhoto(null); });
  $('#btn-pick').addEventListener('click', function () { $('#photo-file').click(); });
  $('#btn-photo-pick2').addEventListener('click', function () { $('#photo-file').click(); });
  $('#btn-cam').addEventListener('click', function () { $('#photo-cam').click(); });
  $('#btn-photo-cam2').addEventListener('click', function () { $('#photo-cam').click(); });

  ['#photo-file', '#photo-cam'].forEach(function (sel) {
    $(sel).addEventListener('change', onPhotoFile);
  });

  function onPhotoFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var img = new Image();
    img.onload = function () {
      ph.img = img; ph.w = img.naturalWidth; ph.h = img.naturalHeight;
      ph.ref = []; ph.runs = [[]]; ph.dsRuns = [[]]; ph.scale = 0; ph.step = 'ref';
      ph.view = { z: 1, ox: 0, oy: 0 };
      candidates = [];
      buildEdges(img);
      setPhotoStep('ref');
      $('#photo-empty').hidden = true;
      drawPhoto();
      toast('Agora trace a referência: dois toques nas bordas da porta da garagem.');
    };
    img.onerror = function () { toast('Não consegui abrir essa imagem.'); };
    img.src = URL.createObjectURL(f);
    e.target.value = '';
  }

  // devolve os pontos guardados para a escala da imagem atual
  function restoreEntryPoints(e) {
    if (!e) { ph.ref = []; ph.runs = [[]]; ph.dsRuns = [[]]; return; }
    var fx = e.norm ? ph.w : 1, fy = e.norm ? ph.h : 1;
    function back(arr) {
      return (arr || []).map(function (r) {
        return r.map(function (q) { return { x: q.x * fx, y: q.y * fy }; });
      });
    }
    ph.ref = (e.ref || []).map(function (q) { return { x: q.x * fx, y: q.y * fy }; });
    ph.runs = back(e.lines);
    if (!ph.runs.length) ph.runs = [[]];
    ph.dsRuns = back(e.dsLines);
    if (!ph.dsRuns.length) ph.dsRuns = [[]];
  }

  function setPhotoStep(s) {
    ph.step = s;
    $$('[data-pstep]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.pstep === s); });
    if (s !== 'ref') { $('#ref-row').hidden = true; setBarMin(true); }
    if (s === 'down') toast('Trace uma linha por descida, de cima até o chão.');
  }

  $('#ref-open').addEventListener('click', function () {
    var r = $('#ref-row');
    r.hidden = !r.hidden;
    if (!r.hidden) setBarMin(false);
    setTimeout(function () { if (ph.img) { computeFit(); clampView(); drawPhoto(); } }, 60);
  });

  function refLabel(txt) { $('#ref-current').textContent = txt; }

  function setBarMin(min) {
    var bar = $('#photo-bar');
    if (!bar) return;
    bar.classList.toggle('is-min', !!min);
    $('#bar-label').textContent = min ? 'mostrar opções' : 'esconder opções';
    setTimeout(function () { if (ph.img) { clampView(); drawPhoto(); } }, 60);
  }

  $('#bar-toggle').addEventListener('click', function () {
    setBarMin(!$('#photo-bar').classList.contains('is-min'));
  });

  function setFull(on) {
    $('#screen-photo').classList.toggle('is-full', !!on);
    setTimeout(function () { if (ph.img) { clampView(); drawPhoto(); } }, 60);
  }
  $('#btn-full').addEventListener('click', function () { setFull(true); });
  $('#ph-exit-full').addEventListener('click', function () { setFull(false); });
  $('#ph-undo2').addEventListener('click', function () { $('#btn-photo-undo').click(); });
  $('#ph-newline2').addEventListener('click', function () { $('#btn-photo-newline').click(); });
  $$('[data-pstep]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.pstep === 'measure' && !ph.scale) { toast('Trace a referência primeiro.'); return; }
      setPhotoStep(b.dataset.pstep);
    });
  });

  $$('[data-ref]').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('[data-ref]').forEach(function (o) { o.classList.remove('is-on'); });
      b.classList.add('is-on');
      $('#ref-feet').value = b.dataset.ref;
      refLabel(b.textContent.trim());
      try { localStorage.setItem('rainline.ref', b.dataset.ref); } catch (e) {}
      recalcPhoto();
    });
  });
  $('#ref-feet').addEventListener('input', recalcPhoto);

  $$('#unit-sw .u-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('#unit-sw .u-btn').forEach(function (o) { o.classList.remove('is-on'); });
      b.classList.add('is-on');
      ph.unit = b.dataset.unit;
      refLabel($('#ref-feet').value + ' ' + ph.unit);
      recalcPhoto();
    });
  });

  $('#chip-ruler').addEventListener('click', function () {
    $$('[data-ref]').forEach(function (o) { o.classList.remove('is-on'); });
    $$('#unit-sw .u-btn').forEach(function (o) { o.classList.toggle('is-on', o.dataset.unit === 'm'); });
    ph.unit = 'm';
    refLabel('régua da imagem');
    $('#ref-feet').value = '';
    $('#ref-feet').focus();
    toast('Digite o número da régua e trace em cima dela, ponta a ponta.');
  });

  $$('[data-plevel]').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('[data-plevel]').forEach(function (o) { o.classList.remove('is-on'); });
      b.classList.add('is-on');
      ph.level = +b.dataset.plevel;
    });
  });

  $$('[data-side]').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('[data-side]').forEach(function (o) { o.classList.remove('is-on'); });
      b.classList.add('is-on');
      ph.side = b.dataset.side;
    });
  });

  /* --- gestos na foto: um dedo arrasta, dois dedos dão zoom,
         toque simples marca ponto, toque em cima de um ponto arrasta ele --- */
  (function () {
    var cv = photoCanvas();
    var pts = {};              // ponteiros ativos
    var moved = false, startD = 0, startZ = 1, startMid = null, startOx = 0, startOy = 0;
    var panFrom = null, pendingDrag = null;

    function toImg(cx, cy) {
      var r = cv.getBoundingClientRect();
      var f = computeFit();
      return {
        x: (cx - r.left - f.x) / f.s,
        y: (cy - r.top - f.y) / f.s
      };
    }

    // devolve o ponto sob o dedo, se houver
    function hit(p) {
      var tol = 16 / ph.fit.s;   // 16 px de tela, convertidos para pixel de imagem
      var best = null, bd = tol;
      ph.ref.forEach(function (q, i) {
        var d = pxLen(p, q);
        if (d < bd) { bd = d; best = { kind: 'ref', i: i }; }
      });
      ph.runs.forEach(function (r, ri) {
        r.forEach(function (q, pi) {
          var d = pxLen(p, q);
          if (d < bd) { bd = d; best = { kind: 'run', ri: ri, pi: pi }; }
        });
      });
      ph.dsRuns.forEach(function (r, ri) {
        r.forEach(function (q, pi) {
          var d = pxLen(p, q);
          if (d < bd) { bd = d; best = { kind: 'ds', ri: ri, pi: pi }; }
        });
      });
      return best;
    }

    function ids() { return Object.keys(pts); }

    cv.addEventListener('pointerdown', function (e) {
      if (!ph.img) return;
      cv.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = ids().length;
      if (n === 1) {
        moved = false;
        var p = toImg(e.clientX, e.clientY);
        pendingDrag = hit(p);       // candidato: só vira arrasto se o dedo andar
        ph.drag = null;
        panFrom = { x: e.clientX, y: e.clientY, ox: ph.view.ox, oy: ph.view.oy };
      } else if (n === 2) {
        ph.drag = null;
        moved = true;
        var k = ids();
        startD = Math.hypot(pts[k[0]].x - pts[k[1]].x, pts[k[0]].y - pts[k[1]].y);
        startZ = ph.view.z;
        startOx = ph.view.ox; startOy = ph.view.oy;
        var r = cv.getBoundingClientRect();
        startMid = {
          x: (pts[k[0]].x + pts[k[1]].x) / 2 - r.left,
          y: (pts[k[0]].y + pts[k[1]].y) / 2 - r.top
        };
      }
    });

    cv.addEventListener('pointermove', function (e) {
      if (!ph.img || !pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var k = ids();

      if (k.length >= 2) {                       // pinça
        var d = Math.hypot(pts[k[0]].x - pts[k[1]].x, pts[k[0]].y - pts[k[1]].y);
        if (startD > 0) {
          var z = Math.max(1, Math.min(16, startZ * (d / startD)));
          var f = z / startZ;
          ph.view.z = z;
          ph.view.ox = startMid.x - (startMid.x - startOx) * f;
          ph.view.oy = startMid.y - (startMid.y - startOy) * f;
          clampView();
          drawPhoto();
        }
        return;
      }

      var dx = e.clientX - panFrom.x, dy = e.clientY - panFrom.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        if (!moved && pendingDrag) ph.drag = pendingDrag;   // agora sim é arrasto
        moved = true;
      }

      if (ph.drag) {                             // arrastando um ponto
        var p = toImg(e.clientX, e.clientY);
        p.x = Math.max(0, Math.min(ph.w, p.x));
        p.y = Math.max(0, Math.min(ph.h, p.y));
        p = snapToEdge(p);
        if (ph.drag.kind === 'ref') ph.ref[ph.drag.i] = p;
        else if (ph.drag.kind === 'ds') ph.dsRuns[ph.drag.ri][ph.drag.pi] = p;
        else ph.runs[ph.drag.ri][ph.drag.pi] = p;
        showPhLoupe(p);
        recalcPhoto();
      } else if (moved) {                        // arrastando a foto
        ph.view.ox = panFrom.ox + dx;
        ph.view.oy = panFrom.oy + dy;
        clampView();
        drawPhoto();
      }
    });

    function end(e) {
      if (!pts[e.pointerId]) return;
      var wasMoved = moved;
      delete pts[e.pointerId];
      if (ids().length === 0) {
        ph.drag = null;
        pendingDrag = null;
        hidePhLoupe();
        // toque sem arrasto sempre cria ponto, mesmo perto de outro
        if (!wasMoved && ph.img) addPhotoPoint(e.clientX, e.clientY);
      }
      if (ids().length === 1) {                  // soltou um dedo da pinça
        var k = ids()[0];
        panFrom = { x: pts[k].x, y: pts[k].y, ox: ph.view.ox, oy: ph.view.oy };
        moved = true;
      }
    }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    function addPhotoPoint(cx, cy) {
      var p = toImg(cx, cy);
      if (p.x < 0 || p.y < 0 || p.x > ph.w || p.y > ph.h) return;
      if (ph.step === 'measure' && acceptCandidate(p)) return;
      p = snapToEdge(p);
      if (ph.step === 'ref') {
        if (ph.ref.length >= 2) ph.ref = [];
        ph.ref.push(p);
        if (ph.ref.length === 2) {
          recalcPhoto();
          setPhotoStep('measure');
          toast('Escala definida. Agora trace os beirais.');
        }
      } else if (ph.step === 'down') {
        ph.dsRuns[ph.dsRuns.length - 1].push(p);
      } else {
        ph.runs[ph.runs.length - 1].push(p);
      }
      recalcPhoto();
    }

    // roda do mouse, para quem testar no computador
    cv.addEventListener('wheel', function (e) {
      if (!ph.img) return;
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var z = Math.max(1, Math.min(16, ph.view.z * (e.deltaY < 0 ? 1.15 : 0.87)));
      var f = z / ph.view.z;
      ph.view.z = z;
      ph.view.ox = mx - (mx - ph.view.ox) * f;
      ph.view.oy = my - (my - ph.view.oy) * f;
      clampView(); drawPhoto();
    }, { passive: false });
  })();

  // impede que a foto seja arrastada para fora da tela
  function clampView() {
    var st = document.getElementById('photo-stage');
    if (!st || !ph.img) return;
    var W = st.clientWidth, H = st.clientHeight, lim = 60;
    var base = Math.min(W / ph.w, H / ph.h);
    var iw = ph.w * base * ph.view.z, ih = ph.h * base * ph.view.z;
    var cx = (W - ph.w * base) / 2, cy = (H - ph.h * base) / 2;

    var maxOx = lim - cx, minOx = W - iw - lim - cx;
    var maxOy = lim - cy, minOy = H - ih - lim - cy;
    ph.view.ox = (minOx > maxOx) ? (minOx + maxOx) / 2 : Math.max(minOx, Math.min(maxOx, ph.view.ox));
    ph.view.oy = (minOy > maxOy) ? (minOy + maxOy) / 2 : Math.max(minOy, Math.min(maxOy, ph.view.oy));
  }

  function zoomPhoto(mult) {
    if (!ph.img) return;
    var st = document.getElementById('photo-stage');
    var mx = st.clientWidth / 2, my = st.clientHeight / 2;
    var z = Math.max(1, Math.min(16, ph.view.z * mult));
    var f = z / ph.view.z;
    ph.view.z = z;
    ph.view.ox = mx - (mx - ph.view.ox) * f;
    ph.view.oy = my - (my - ph.view.oy) * f;
    clampView(); drawPhoto(); showZoom();
  }

  function resetPhotoView() {
    ph.view = { z: 1, ox: 0, oy: 0 };
    drawPhoto(); showZoom();
  }

  function showZoom() {
    var el = $('#photo-zoom');
    if (el) el.textContent = ph.view.z.toFixed(1) + '×';
  }

  function pxLen(a, b) { return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)); }

  function photoFeet() {
    if (!ph.scale) return { feet: 0, corners: 0, lines: 0 };
    var feet = 0, corners = 0, lines = 0;
    ph.runs.forEach(function (r) {
      if (r.length < 2) return;
      lines++;
      for (var i = 1; i < r.length; i++) feet += pxLen(r[i - 1], r[i]) * ph.scale;
      corners += r.length - 2;
    });
    return { feet: feet, corners: corners, lines: lines };
  }

  function refFeetValue() {
    var v = Number($('#ref-feet').value) || 0;
    return ph.unit === 'm' ? v * 3.280839895 : v;
  }

  function photoDs() {
    var n = 0, feet = 0;
    ph.dsRuns.forEach(function (r) {
      if (r.length < 2) return;
      n++;
      if (!ph.scale) return;
      for (var i = 1; i < r.length; i++) feet += pxLen(r[i - 1], r[i]) * ph.scale;
    });
    return { count: n, feet: feet };
  }

  function recalcPhoto() {
    var rf = refFeetValue();
    if (ph.ref.length === 2 && rf > 0) {
      var px = pxLen(ph.ref[0], ph.ref[1]);
      ph.scale = px > 0 ? rf / px : 0;
    }
    var t = photoFeet();
    showZoom();
    $('#photo-total').textContent = Math.round(t.feet);
    var ff = $('#ph-float-ft');
    if (ff) ff.textContent = Math.round(t.feet);
    var ds = photoDs();
    $('#photo-scale').textContent = ph.scale
      ? 'escala ok · ' + t.lines + ' linha(s)' + (ds.count ? ' · ' + ds.count + ' descida(s)' : '')
      : 'sem escala ainda';
    drawPhoto();
  }

  // calcula onde a foto está desenhada agora. Qualquer mudança de layout
  // (abrir opções, tela toda, girar o aparelho) muda isto — e o toque precisa
  // usar o valor de agora, não o de antes.
  function computeFit() {
    var st = document.getElementById('photo-stage');
    if (!st || !ph.img) return ph.fit;
    var W = st.clientWidth, H = st.clientHeight;
    var base = Math.min(W / ph.w, H / ph.h);
    ph.fit = {
      x: (W - ph.w * base) / 2 + ph.view.ox,
      y: (H - ph.h * base) / 2 + ph.view.oy,
      s: base * ph.view.z,
      base: base
    };
    return ph.fit;
  }

  function drawPhoto() {
    var c = photoCanvas();
    if (!c) return;
    var st = document.getElementById('photo-stage');
    var W = st.clientWidth, H = st.clientHeight;
    var dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!ph.img) return;

    var base = Math.min(W / ph.w, H / ph.h);
    var S = base * ph.view.z;
    var x = (W - ph.w * base) / 2 + ph.view.ox;
    var y = (H - ph.h * base) / 2 + ph.view.oy;
    ph.fit = { x: x, y: y, s: S, base: base };
    g.imageSmoothingEnabled = ph.view.z < 3;   // no zoom alto, pixel cru ajuda a mirar
    g.drawImage(ph.img, x, y, ph.w * S, ph.h * S);
    if (ph.showEdges && ph.edgeCanvas) {
      g.globalAlpha = 0.9;
      g.drawImage(ph.edgeCanvas, x, y, ph.w * S, ph.h * S);
      g.globalAlpha = 1;
    }

    function P(p) { return [x + p.x * S, y + p.y * S]; }

    // referência em ciano
    if (ph.ref.length) {
      g.strokeStyle = '#2BE0C0'; g.lineWidth = 3; g.beginPath();
      ph.ref.forEach(function (p, i) {
        var q = P(p);
        i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]);
      });
      g.stroke();
      ph.ref.forEach(function (p) {
        var q = P(p);
        g.fillStyle = '#2BE0C0'; g.beginPath(); g.arc(q[0], q[1], 7, 0, 6.284); g.fill();
        g.strokeStyle = '#0E1317'; g.lineWidth = 2; g.stroke();
      });
    }

    // candidatas da detecção automática: tracejado ciano
    if (candidates && candidates.length) {
      g.save();
      g.setLineDash([9, 6]);
      g.strokeStyle = 'rgba(43,224,192,.95)';
      g.lineWidth = 3;
      candidates.forEach(function (c) {
        var A = P(c.a), B = P(c.b);
        g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
      });
      g.restore();
    }

    // descidas em laranja: contadas, não entram na metragem de calha
    ph.dsRuns.forEach(function (r) {
      if (r.length > 1) {
        g.strokeStyle = 'rgba(14,19,23,.5)'; g.lineWidth = 9;
        g.beginPath(); r.forEach(function (q, i) { var a = P(q); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); g.stroke();
        g.strokeStyle = '#FF8A3D'; g.lineWidth = 5;
        g.beginPath(); r.forEach(function (q, i) { var a = P(q); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); g.stroke();
      }
      r.forEach(function (q) {
        var a = P(q);
        g.fillStyle = '#FF8A3D'; g.beginPath(); g.arc(a[0], a[1], 6, 0, 6.284); g.fill();
        g.strokeStyle = '#0E1317'; g.lineWidth = 2; g.stroke();
      });
    });

    // beirais em amarelo, com a medida de cada trecho
    ph.runs.forEach(function (r) {
      if (r.length > 1) {
        g.strokeStyle = '#FFC91B'; g.lineWidth = 4; g.beginPath();
        r.forEach(function (p, i) {
          var q = P(p);
          i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]);
        });
        g.stroke();
        if (ph.scale) {
          g.font = '600 13px "IBM Plex Mono", monospace';
          for (var i = 1; i < r.length; i++) {
            var a = P(r[i - 1]), b = P(r[i]);
            var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
            var txt = Math.round(pxLen(r[i - 1], r[i]) * ph.scale) + ' ft';
            var w = g.measureText(txt).width + 10;
            g.fillStyle = 'rgba(14,19,23,.88)';
            g.fillRect(mx - w / 2, my - 10, w, 20);
            g.fillStyle = '#FFC91B';
            g.fillText(txt, mx - w / 2 + 5, my + 5);
          }
        }
      }
      r.forEach(function (p) {
        var q = P(p);
        g.fillStyle = '#FFC91B'; g.beginPath(); g.arc(q[0], q[1], 6, 0, 6.284); g.fill();
        g.strokeStyle = '#0E1317'; g.lineWidth = 2; g.stroke();
      });
    });
  }

  $('#btn-zin').addEventListener('click', function () { zoomPhoto(1.6); });
  $('#btn-zout').addEventListener('click', function () { zoomPhoto(1 / 1.6); });
  $('#btn-zfit').addEventListener('click', resetPhotoView);
  $('#btn-snap').addEventListener('click', function () {
    ph.snap = !ph.snap;
    $('#btn-snap').classList.toggle('is-on', ph.snap);
    toast(ph.snap ? 'Encaixe na borda ligado.' : 'Encaixe desligado — ponto vai onde você tocar.');
  });
  $('#btn-edges').addEventListener('click', function () {
    ph.showEdges = !ph.showEdges;
    $('#btn-edges').classList.toggle('is-on', ph.showEdges);
    drawPhoto();
    if (ph.showEdges && !ph.edgeCanvas) toast('Bordas não disponíveis para esta imagem.');
  });

  /* --- lupa da foto: aparece ao arrastar um ponto --- */
  function showPhLoupe(p) {
    var el = document.getElementById('ph-loupe');
    if (!el || !ph.img) return;
    el.classList.add('is-on');
    var g = el.getContext('2d');
    var S = 336;                       // resolução interna (2x para ficar nítida)
    var Z = 3.2;                       // aumento sobre o zoom atual
    var scale = ph.fit.s * Z * 2;      // px de tela por px de imagem
    var half = S / (2 * scale);        // metade da janela, em px de imagem

    g.clearRect(0, 0, S, S);
    g.fillStyle = '#22303A'; g.fillRect(0, 0, S, S);
    g.imageSmoothingEnabled = scale < 3;
    g.drawImage(ph.img, p.x - half, p.y - half, half * 2, half * 2, 0, 0, S, S);

    function L(q) { return [(q.x - p.x) * scale + S / 2, (q.y - p.y) * scale + S / 2]; }

    // linhas já traçadas, para conferir o alinhamento
    g.lineCap = 'round';
    ph.runs.forEach(function (r) {
      if (r.length < 2) return;
      g.strokeStyle = '#FFC91B'; g.lineWidth = 5;
      g.beginPath();
      r.forEach(function (q, i) { var a = L(q); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); });
      g.stroke();
    });
    if (ph.ref.length === 2) {
      g.strokeStyle = '#2BE0C0'; g.lineWidth = 5;
      g.beginPath();
      ph.ref.forEach(function (q, i) { var a = L(q); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); });
      g.stroke();
    }

    // mira
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(S / 2 - 26, S / 2); g.lineTo(S / 2 + 26, S / 2);
    g.moveTo(S / 2, S / 2 - 26); g.lineTo(S / 2, S / 2 + 26);
    g.stroke();
  }

  function hidePhLoupe() {
    var el = document.getElementById('ph-loupe');
    if (el) el.classList.remove('is-on');
  }

  /* --- alinhar a linha traçada com as bordas reais do telhado ---
     Cada segmento é ajustado para a reta de maior "energia de borda" perto dele
     (pequenas variações de ângulo e deslocamento). Depois os cantos viram a
     interseção das retas vizinhas — que é como um canto de telhado se comporta. */
  function edgeEnergy(a, b) {
    if (!ph.edge) return 0;
    var N = 48, sum = 0, hit = 0;
    for (var i = 0; i <= N; i++) {
      var t = i / N;
      var x = Math.round((a.x + (b.x - a.x) * t) * ph.edge.sx);
      var y = Math.round((a.y + (b.y - a.y) * t) * ph.edge.sy);
      if (x < 0 || y < 0 || x >= ph.edge.w || y >= ph.edge.h) continue;
      sum += ph.edge.mag[y * ph.edge.w + x];
      hit++;
    }
    return hit ? sum / hit : 0;
  }

  function fitSegment(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy);
    if (!len) return null;
    var ang = Math.atan2(dy, dx);
    var nx = -dy / len, ny = dx / len;            // normal do segmento
    var step = 1 / (ph.edge ? ph.edge.sx : 1);    // 1 px do mapa de bordas
    var best = { s: edgeEnergy(a, b), a: a, b: b };

    for (var da = -4; da <= 4; da++) {
      var th = ang + da * Math.PI / 180;
      var ux = Math.cos(th), uy = Math.sin(th);
      var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      for (var off = -8; off <= 8; off++) {
        var ox = cx + nx * off * step, oy = cy + ny * off * step;
        var A = { x: ox - ux * len / 2, y: oy - uy * len / 2 };
        var B = { x: ox + ux * len / 2, y: oy + uy * len / 2 };
        var e = edgeEnergy(A, B);
        if (e > best.s) best = { s: e, a: A, b: B };
      }
    }
    return best;
  }

  function lineIntersect(p1, p2, p3, p4) {
    var d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
    if (Math.abs(d) < 1e-6) return null;          // paralelas
    var a = p1.x * p2.y - p1.y * p2.x, b = p3.x * p4.y - p3.y * p4.x;
    return {
      x: (a * (p3.x - p4.x) - (p1.x - p2.x) * b) / d,
      y: (a * (p3.y - p4.y) - (p1.y - p2.y) * b) / d
    };
  }

  function alignRun(run) {
    if (!ph.edge || run.length < 2) return run;
    var fits = [];
    for (var i = 1; i < run.length; i++) {
      var f = fitSegment(run[i - 1], run[i]);
      fits.push(f ? { a: f.a, b: f.b } : { a: run[i - 1], b: run[i] });
    }
    var out = [{ x: fits[0].a.x, y: fits[0].a.y }];
    for (var k = 1; k < fits.length; k++) {
      var ip = lineIntersect(fits[k - 1].a, fits[k - 1].b, fits[k].a, fits[k].b);
      var orig = run[k];
      // se a interseção fugir demais, mantém o ponto original
      if (!ip || Math.hypot(ip.x - orig.x, ip.y - orig.y) > 40 / (ph.fit.s || 1)) ip = orig;
      out.push({ x: ip.x, y: ip.y });
    }
    var last = fits[fits.length - 1];
    out.push({ x: last.b.x, y: last.b.y });
    return out;
  }

  $('#btn-onlyh').addEventListener('click', function () {
    ph.onlyH = !ph.onlyH;
    $('#btn-onlyh').classList.toggle('is-on', ph.onlyH);
    toast(ph.onlyH ? 'Buscando só linhas horizontais.' : 'Buscando linhas em qualquer direção.');
  });

  $('#btn-align').addEventListener('click', function () {
    if (!ph.img) return;
    if (!ph.edge) { toast('Sem mapa de bordas para esta imagem.'); return; }
    var n = 0;
    ph.runs = ph.runs.map(function (r) {
      if (r.length < 2) return r;
      n++;
      return alignRun(r);
    });
    if (ph.ref.length === 2) {
      var f = fitSegment(ph.ref[0], ph.ref[1]);
      if (f) ph.ref = [f.a, f.b];
    }
    recalcPhoto();
    toast(n ? 'Linhas encaixadas nas bordas. Confira antes de somar.' : 'Nada para alinhar ainda.');
  });

  /* ---------- detecção automática de linhas (transformada de Hough) ----------
     Sem IA e sem servidor: puro cálculo. Cada pixel de borda "vota" em todas as
     retas que passam por ele; as retas mais votadas são as linhas reais da foto.
     Depois recortamos os trechos onde a borda existe de fato. */
  var candidates = [];

  // Hough genérico: recebe o mapa de bordas e devolve trechos de reta
  function houghSegments(edge, opt) {
    if (!edge) return [];
    opt = opt || {};
    var RELAX = opt.relax || 1;
    var W = edge.w, H = edge.h, mag = edge.mag;
    var TH = Math.max(14, Math.round(edge.cut / RELAX));
    var NT = 180;                                   // 1 grau por passo
    var rhoMax = Math.ceil(Math.hypot(W, H));
    var NR = Math.ceil(2 * rhoMax / 2);             // 2 px por passo
    var acc = new Uint16Array(NT * NR);
    var cos = new Float32Array(NT), sin = new Float32Array(NT);
    for (var t = 0; t < NT; t++) {
      var a = t * Math.PI / NT;
      cos[t] = Math.cos(a); sin[t] = Math.sin(a);
    }

    var step = (W * H > 400000) ? 2 : 1;            // imagem grande: amostra
    for (var y = 1; y < H - 1; y += step) {
      for (var x = 1; x < W - 1; x += step) {
        if (mag[y * W + x] < TH) continue;
        for (var t2 = 0; t2 < NT; t2++) {
          var r = Math.round((x * cos[t2] + y * sin[t2] + rhoMax) / 2);
          if (r >= 0 && r < NR) acc[t2 * NR + r]++;
        }
      }
    }

    // picos: máximos locais acima de um mínimo
    var minVotes = Math.max(12, Math.round(Math.min(W, H) * 0.055 / step / RELAX));
    var peaks = [];
    for (var ti = 0; ti < NT; ti++) {
      for (var ri = 1; ri < NR - 1; ri++) {
        var v = acc[ti * NR + ri];
        if (v < minVotes) continue;
        var isPeak = true;
        for (var dt = -2; dt <= 2 && isPeak; dt++) {
          for (var dr = -3; dr <= 3; dr++) {
            var tt = (ti + dt + NT) % NT, rr = ri + dr;
            if (rr < 0 || rr >= NR) continue;
            if (acc[tt * NR + rr] > v) { isPeak = false; break; }
          }
        }
        if (isPeak) peaks.push({ t: ti, r: ri, v: v });
      }
    }
    peaks.sort(function (a, b) { return b.v - a.v; });
    peaks = peaks.slice(0, 60);

    // calha numa foto de fachada é quase horizontal; a perspectiva inclina um
    // pouco, mas nunca vira vertical. Isso corta mato, tronco e cerca.
    if (opt.onlyH) {
      peaks = peaks.filter(function (pk) {
        var lineDeg = ((pk.t * 180 / NT) + 90) % 180;      // direção da reta
        return lineDeg <= 32 || lineDeg >= 148;
      });
    }

    // de cada reta, extrai os trechos onde existe borda de verdade
    var segs = [];
    peaks.forEach(function (pk) {
      var ang = pk.t * Math.PI / NT;
      var c = Math.cos(ang), s = Math.sin(ang);
      var rho = pk.r * 2 - rhoMax;
      var dx = -s, dy = c;                          // direção ao longo da reta
      var x0 = c * rho, y0 = s * rho;
      var run = null, gap = 0, found = [];
      var L = Math.hypot(W, H);
      for (var u = -L; u <= L; u++) {
        var x = Math.round(x0 + dx * u), y = Math.round(y0 + dy * u);
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) { continue; }
        var on = mag[y * W + x] >= TH ||
                 mag[y * W + x + 1] >= TH || mag[y * W + x - 1] >= TH ||
                 mag[(y + 1) * W + x] >= TH || mag[(y - 1) * W + x] >= TH;
        if (on) {
          if (!run) run = { a: u, b: u };
          run.b = u; gap = 0;
        } else if (run) {
          if (++gap > 10) { found.push(run); run = null; }
        }
      }
      if (run) found.push(run);
      found.forEach(function (f) {
        var len = f.b - f.a;
        if (len < Math.min(W, H) * 0.07 / RELAX) return;   // trecho curto: descarta
        segs.push({
          a: { x: (x0 + dx * f.a) / edge.sx, y: (y0 + dy * f.a) / edge.sy },
          b: { x: (x0 + dx * f.b) / edge.sx, y: (y0 + dy * f.b) / edge.sy },
          len: len
        });
      });
    });

    segs.sort(function (a, b) { return b.len - a.len; });
    // remove quase-duplicatas
    var out = [];
    segs.forEach(function (s2) {
      var dup = out.some(function (o) {
        return (dist(o.a, s2.a) + dist(o.b, s2.b)) / 2 < 14 / (edge.sx || 1) ||
               (dist(o.a, s2.b) + dist(o.b, s2.a)) / 2 < 14 / (edge.sx || 1);
      });
      if (!dup) out.push(s2);
    });
    return out.slice(0, opt.max || 12);
  }


  function detectLines(relax) {
    return houghSegments(ph.edge, { relax: relax || 1, onlyH: ph.onlyH, max: 12 });
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  $('#btn-detect-lines').addEventListener('click', function () {
    if (!ph.img) { toast('Carregue uma imagem primeiro.'); return; }
    if (!ph.edge) { toast('Sem mapa de bordas para esta imagem.'); return; }
    if (ph.step === 'ref') {
      toast('Defina a referência antes — sem escala a linha não vira medida.');
      return;
    }
    toast('Procurando as linhas…');
    setTimeout(function () {
      candidates = detectLines(1);
      if (candidates.length < 3) candidates = detectLines(1.8);   // 2ª tentativa, mais permissiva
      if (candidates.length < 2) candidates = detectLines(3);     // 3ª, última
      recalcPhoto();
      toast(candidates.length
        ? candidates.length + ' linhas encontradas. Toque nas que são calha.'
        : 'Não achei linhas nítidas. Tente com Bordas ligado para conferir a foto.');
    }, 40);
  });

  // toque numa candidata converte ela em linha de medição
  function acceptCandidate(p) {
    if (!candidates.length) return false;
    var tol = 18 / ph.fit.s;
    var best = null, bd = tol;
    candidates.forEach(function (c, i) {
      var d = pointToSegment(p, c.a, c.b);
      if (d < bd) { bd = d; best = i; }
    });
    if (best === null) return false;
    var c = candidates[best];
    var last = ph.runs[ph.runs.length - 1];
    if (last.length) ph.runs.push([]);
    ph.runs[ph.runs.length - 1] = [{ x: c.a.x, y: c.a.y }, { x: c.b.x, y: c.b.y }];
    ph.runs.push([]);
    candidates.splice(best, 1);
    recalcPhoto();
    toast('Linha aceita.');
    return true;
  }

  function pointToSegment(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y;
    var L2 = vx * vx + vy * vy;
    if (!L2) return dist(p, a);
    var t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
    return dist(p, { x: a.x + vx * t, y: a.y + vy * t });
  }

  $('#btn-photo-undo').addEventListener('click', function () {
    if (ph.step === 'ref') { ph.ref.pop(); }
    else {
      var arr = (ph.step === 'down') ? ph.dsRuns : ph.runs;
      var last = arr[arr.length - 1];
      last.pop();
      if (!last.length && arr.length > 1) arr.pop();
    }
    recalcPhoto();
  });

  $('#btn-photo-clear-cand') && $('#btn-photo-clear-cand').addEventListener('click', function () {
    candidates = []; recalcPhoto();
  });

  $('#btn-photo-newline').addEventListener('click', function () {
    if (ph.step === 'ref') { toast('Termine a referência primeiro.'); return; }
    var arr = (ph.step === 'down') ? ph.dsRuns : ph.runs;
    if (!arr[arr.length - 1].length) { toast('A linha atual está vazia.'); return; }
    arr.push([]);
    toast(ph.step === 'down' ? 'Próxima descida.' : 'Linha nova na foto.');
  });

  function shrink(img, maxW, q) {
    var s = Math.min(1, maxW / img.naturalWidth);
    var c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    try { return c.toDataURL('image/jpeg', q); } catch (e) { return ''; }
  }

  $('#btn-photo-add').addEventListener('click', function () {
    var t = photoFeet();
    if (t.feet < 1) { toast('Trace pelo menos uma linha com escala definida.'); return; }
    job.manual = job.manual || [];
    // guarda tudo em coordenada relativa (0..1). A imagem é reduzida ao salvar,
    // então coordenada absoluta sairia do lugar ao reabrir.
    function norm(arr) {
      return arr.map(function (r) {
        return r.map(function (q) { return { x: q.x / ph.w, y: q.y / ph.h }; });
      });
    }
    var ds = photoDs();
    var entry = {
      feet: Math.round(t.feet),
      corners: t.corners,
      level: ph.level,
      side: ph.side,
      dsCount: ds.count,
      dsFeet: Math.round(ds.feet),
      note: 'Foto · ' + sideName(ph.side) + (ds.count ? ' · ' + ds.count + ' descida(s)' : ''),
      refFeet: refFeetValue(),                    // sempre gravado em pés
      norm: true,
      ref: ph.ref.map(function (q) { return { x: q.x / ph.w, y: q.y / ph.h }; }),
      lines: norm(ph.runs),
      dsLines: norm(ph.dsRuns),
      thumb: shrink(ph.img, 220, 0.6),
      img: shrink(ph.img, 1280, 0.72)
    };
    if (ph.editing != null) job.manual[ph.editing] = entry;
    else job.manual.push(entry);
    toast(Math.round(t.feet) + ' ft somados.');
    go('parts');
    renderParts();
  });

  window.addEventListener('resize', function () { if (ph.img) { clampView(); drawPhoto(); } });

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () {
      if (ph.img) { computeFit(); clampView(); drawPhoto(); }
    });
    ro.observe(document.getElementById('photo-stage'));
  }

  /* ---------- materiais ---------- */
  function currentList() {
    var m = Calc.measure(job.runs, settings.calibration, job.manual);
    var cfg = Object.assign({}, settings, { size: job.size, stories: job.stories });
    var list = Calc.materials(m, cfg);
    // descidas marcadas na foto mandam mais que a estimativa automática
    var dsMarked = (job.manual || []).reduce(function (a, e) { return a + (Number(e.dsCount) || 0); }, 0);
    var dsFeet = (job.manual || []).reduce(function (a, e) { return a + (Number(e.dsFeet) || 0); }, 0);
    if (dsMarked > 0 && job.overrides.dsCount == null) {
      list.forEach(function (i) {
        if (i.key === 'dsCount') { i.qty = dsMarked; i.note = 'marcadas na foto'; }
        if (i.key === 'dsFt' && dsFeet > 0) { i.qty = Math.round(dsFeet); i.note = 'medidas na foto'; }
        if (i.key === 'elbows') i.qty = dsMarked * 3;
        if (i.key === 'splash') i.qty = dsMarked;
      });
    }
    list.forEach(function (i) {
      if (job.overrides[i.key] != null) i.qty = job.overrides[i.key];
    });
    return { m: m, list: list, cfg: cfg };
  }

  function renderMaterials() {
    var d = currentList();
    $('#mat-feet').textContent = ft(d.m.feet);
    $('#mat-corners').textContent = d.m.corners + ' cantos';
    $('#mat-runs').textContent = d.m.runs + ' linhas';
    var lv = d.m.byLevel || {}, parts = [];
    ['1', '2', '3'].forEach(function (k) {
      if (lv[k]) parts.push(levelName(k) + ' ' + Math.round(lv[k]) + ' ft');
    });
    var el = $('#mat-levels');
    if (d.m.manualFeet) parts.push(Math.round(d.m.manualFeet) + ' ft medidos na foto');
    if (el) el.textContent = parts.length > 1 ? parts.join(' · ') : '';
    $('#mat-stories').value = job.stories;
    $('#mat-color').value = job.color || '';
    $$('#seg-size .seg-btn').forEach(function (b) { b.classList.toggle('is-on', +b.dataset.size === +job.size); });

    $('#mat-list').innerHTML = d.list.map(function (i) {
      return '<div class="mat-row"><div class="name">' + i.name + '<small>' + i.note + '</small></div>' +
        '<input type="number" inputmode="decimal" step="1" min="0" data-key="' + i.key + '" value="' + i.qty + '">' +
        '<span class="unit">' + i.unit + '</span></div>';
    }).join('');
  }

  $('#mat-list').addEventListener('change', function (e) {
    if (e.target.dataset.key) job.overrides[e.target.dataset.key] = Math.max(0, Number(e.target.value) || 0);
  });
  $('#seg-size').addEventListener('click', function (e) {
    if (!e.target.dataset.size) return;
    job.size = +e.target.dataset.size; job.overrides = {}; renderMaterials();
  });
  $('#mat-stories').addEventListener('change', function (e) { job.stories = +e.target.value; job.overrides = {}; renderMaterials(); });
  $('#mat-color').addEventListener('input', function (e) { job.color = e.target.value; });
  $('#btn-recalc').addEventListener('click', function () { job.overrides = {}; renderMaterials(); toast('Quantidades voltaram ao padrão.'); });
  $('#btn-to-quote').addEventListener('click', function () { go('quote'); });

  /* ---------- situação comercial e reabertura ---------- */
  var ST = {
    draft:    { label: 'Rascunho',   cls: 'st-draft' },
    sent:     { label: 'Em análise', cls: 'st-sent' },
    accepted: { label: 'Fechado',    cls: 'st-accepted' },
    lost:     { label: 'Recusado',   cls: 'st-lost' }
  };

  function setStatus(st) {
    job.status = st;
    $$('#margin-row .st-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      job.marginMode = b.dataset.margin;
      if (b.dataset.margin === 'pct' && !settings.marginPct) {
        toast('Defina o percentual da margem em Configurações.');
      }
      renderQuote();
      if (job.savedAt) saveJob(true);
    });
  });

  $$('#status-row .st-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.status === st);
    });
  }

  $$('#margin-row .st-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      job.marginMode = b.dataset.margin;
      if (b.dataset.margin === 'pct' && !settings.marginPct) {
        toast('Defina o percentual da margem em Configurações.');
      }
      renderQuote();
      if (job.savedAt) saveJob(true);
    });
  });

  $$('#status-row .st-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      setStatus(b.dataset.status);
      if (job.savedAt) {                       // já existe: grava a mudança na hora
        saveJob(true);
        toast('Marcado como ' + ST[job.status].label + '.');
      }
    });
  });

  $$('[data-qk]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.qk;
      if (k === 'client') { fillJobForm(); go('job'); }
      if (k === 'materials') go('materials');
      if (k === 'map') reviewMap();
    });
  });

  function fillJobForm() {
    var c = job.client || {};
    $('#job-name').value = c.name || '';
    $('#job-phone').value = c.phone || '';
    $('#job-email').value = c.email || '';
    $('#job-address').value = c.address || '';
    $('#job-city').value = c.city || '';
    $('#job-state').value = c.state || '';
    $('#job-zip').value = c.zip || '';
    $('#job-notes').value = c.notes || '';
    $('#btn-job-submit').textContent = job.savedAt ? 'Salvar dados do cliente' : 'Buscar imóvel';
  }

  // reabre o mapa já enquadrado nas linhas que existem
  function reviewMap() {
    go('map');
    initMap();
    updateTape();
    if (!map) return;
    setMapMode('draw');
    var pts = [];
    job.runs.forEach(function (r) { r.points.forEach(function (p) { pts.push([p.lat, p.lng]); }); });
    setTimeout(function () {
      map.invalidateSize();
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 21 });
      else if (job.center) map.setView([job.center.lat, job.center.lng], 20);
      renderDraw();
    }, 80);
  }

  $('#btn-delete-job').addEventListener('click', function () {
    if (!job.savedAt) { toast('Este orçamento ainda não foi salvo.'); return; }
    if (!confirm('Excluir o orçamento de ' + (job.client.name || 'sem nome') + '? Não dá para desfazer.')) return;
    var i = jobs.findIndex(function (j) { return j.id === job.id; });
    if (i >= 0) { jobs.splice(i, 1); save(K.jobs, jobs); }
    Api.deleteJob(job.id).catch(function () {});
    toast('Orçamento excluído.');
    go('home');
  });

  /* ---------- orçamento ---------- */
  function renderQuote() {
    var d = currentList();
    setStatus(job.status || 'draft');
    $('#btn-delete-job').style.display = job.savedAt ? '' : 'none';
    $('#quote-discount').value = job.discount || 0;
    $('#quote-tax').value = job.taxPct || 0;
    var cfg = Object.assign({}, d.cfg, {
      discount: job.discount, taxPct: job.taxPct, marginMode: job.marginMode || 'pct'
    });
    $$('#margin-row .st-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.margin === (job.marginMode || 'pct'));
    });
    var p = Calc.price(d.list, cfg);
    job._price = p; job._list = d.list; job._m = d.m;

    var c = job.client;
    $('#quote-box').innerHTML =
      '<div class="q-head"><h3>' + (c.name || 'Cliente') + '</h3>' +
      '<p>' + (fullAddress() || '—') + '</p>' +
      '<p>' + ft(d.m.feet) + ' · ' + job.size + '" gutter · ' + d.m.corners + ' cantos · ' + Calc.qty(d.list, 'dsCount') + ' downspouts</p></div>' +
      p.lines.map(function (l) {
        return '<div class="q-line"><span>' + l.name + '<br><span class="qty">' +
          (l.unit ? l.qty + ' ' + l.unit + ' × ' + money(l.unitPrice) : '') + '</span></span><span>' + money(l.total) + '</span></div>';
      }).join('') +
      (p.minApplied ? '<div class="q-line"><span>Mínimo de serviço aplicado</span><span>' + money(p.subtotal) + '</span></div>' : '') +
      '<div class="q-line"><span><b>Subtotal</b></span><span><b>' + money(p.subtotal) + '</b></span></div>' +
      (p.discount ? '<div class="q-line"><span>Desconto</span><span>-' + money(p.discount) + '</span></div>' : '') +
      (p.tax ? '<div class="q-line"><span>Imposto</span><span>' + money(p.tax) + '</span></div>' : '');

    $('#quote-total').textContent = money(p.total);

    // esta caixa é só para você. Não sai no PDF nem no compartilhamento.
    var mb = $('#margin-box');
    var pctTxt = (settings.marginPct || 0) + '%';
    if (p.margin > 0) {
      var restante = p.margin - (p.discount || 0);
      var pctReal = p.cost > 0 ? (restante / p.cost * 100) : 0;
      mb.innerHTML =
        '<div class="mb-row"><span>Custo + mão de obra</span><b>' + money(p.cost) + '</b></div>' +
        '<div class="mb-row"><span>Margem ' + pctTxt + '</span><b>' + money(p.margin) + '</b></div>' +
        (p.discount ? '<div class="mb-row"><span>Desconto dado</span><b>-' + money(p.discount) + '</b></div>' : '') +
        '<div class="mb-row"><span><b>Sobra para você</b></span>' +
        '<b class="mb-big ' + (restante <= 0 ? 'mb-warn' : '') + '">' + money(restante) +
        '</b></div>' +
        '<small>' + (restante <= 0
          ? 'O desconto comeu toda a margem — este trabalho sai no prejuízo.'
          : 'Equivale a ' + pctReal.toFixed(1) + '% sobre o custo. Só você vê isto.') + '</small>';
    } else {
      mb.innerHTML = '<div class="mb-row"><span>Custo + mão de obra</span><b>' + money(p.cost) + '</b></div>' +
        '<small>Sem margem aplicada: você está vendendo pelo custo.</small>';
    }
  }
  ['#quote-discount', '#quote-tax'].forEach(function (sel) {
    $(sel).addEventListener('input', function () {
      job.discount = Number(String($('#quote-discount').value).replace(',', '.')) || 0;
      job.taxPct = Number(String($('#quote-tax').value).replace(',', '.')) || 0;
      renderQuote();
    });
  });

  $('#btn-save').addEventListener('click', function () { saveJob(false); });

  function saveJob(quiet) {
    job.savedAt = Date.now();
    job.total = job._price.total;
    job.feet = job._m.feet;
    var i = jobs.findIndex(function (j) { return j.id === job.id; });
    var copy = JSON.parse(JSON.stringify(job));
    delete copy._price; delete copy._list; delete copy._m;
    copy.pending = true;
    if (i >= 0) jobs[i] = copy; else jobs.unshift(copy);
    try {
      localStorage.setItem(K.jobs, JSON.stringify(jobs));
      if (!quiet) toast('Orçamento ' + job.id + ' salvo.');
      pushJob(copy).then(function (ok) {
        refreshSyncBar();
        if (ok && !quiet) toast('Enviado para a nuvem.');
      });
    } catch (err) {
      (copy.manual || []).forEach(function (e) { delete e.img; });   // mantém só a miniatura
      try {
        localStorage.setItem(K.jobs, JSON.stringify(jobs));
        toast('Salvo. As fotos em tamanho grande não couberam na memória.');
      } catch (e2) {
        toast('Sem espaço no aparelho. Exporte e apague orçamentos antigos.');
      }
    }
  }

  /* ---------- imagens para o PDF ----------
     Monta um PNG do mapa com as linhas desenhadas e um PNG de cada foto
     com as marcações, para entrarem na proposta. */

  function lngToPx(lng, ws) { return (lng + 180) / 360 * ws; }
  function latToPx(lat, ws) {
    var r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * ws;
  }

  function loadTile(url) {
    return new Promise(function (res) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      var done = false;
      im.onload = function () { done = true; res(im); };
      im.onerror = function () { done = true; res(null); };
      setTimeout(function () { if (!done) res(null); }, 7000);
      im.src = url;
    });
  }

  function mapImage() {
    var pts = [];
    job.runs.forEach(function (r) { r.points.forEach(function (p) { pts.push(p); }); });
    if (pts.length < 2) return Promise.resolve(null);

    var minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    pts.forEach(function (p) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
    });
    var padLat = (maxLat - minLat) * 0.18 + 0.00004;
    var padLng = (maxLng - minLng) * 0.18 + 0.00004;
    minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;

    // maior zoom que ainda cabe em ~1500 px
    var z = 21;
    for (; z > 14; z--) {
      var ws = 256 * Math.pow(2, z);
      if ((lngToPx(maxLng, ws) - lngToPx(minLng, ws)) <= 1500 &&
          (latToPx(minLat, ws) - latToPx(maxLat, ws)) <= 1500) break;
    }
    var WS = 256 * Math.pow(2, z);
    var x0 = lngToPx(minLng, WS), x1 = lngToPx(maxLng, WS);
    var y0 = latToPx(maxLat, WS), y1 = latToPx(minLat, WS);
    var tx0 = Math.floor(x0 / 256), tx1 = Math.floor(x1 / 256);
    var ty0 = Math.floor(y0 / 256), ty1 = Math.floor(y1 / 256);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 49) return Promise.resolve(null);

    var def = LAYERS[layerIdx];
    if (def.type !== 'xyz') def = LAYERS[0];              // camadas de condado não servem aqui
    var nz = Math.min(z, def.max);
    var scale = Math.pow(2, z - nz);

    var W = (tx1 - tx0 + 1) * 256, H = (ty1 - ty0 + 1) * 256;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = '#2A3238'; g.fillRect(0, 0, W, H);

    var jobs = [];
    for (var tx = tx0; tx <= tx1; tx++) {
      for (var ty = ty0; ty <= ty1; ty++) {
        (function (tx, ty) {
          var sx = Math.floor(tx / scale), sy = Math.floor(ty / scale);
          var url = def.url.replace('{z}', nz).replace('{x}', sx).replace('{y}', sy);
          jobs.push(loadTile(url).then(function (im) {
            if (!im) return;
            var dx = (tx - tx0) * 256, dy = (ty - ty0) * 256;
            if (scale === 1) { g.drawImage(im, dx, dy, 256, 256); return; }
            var sub = 256 / scale;                        // recorte do ladrilho de baixo
            g.imageSmoothingEnabled = true;
            g.drawImage(im, (tx % scale) * sub, (ty % scale) * sub, sub, sub, dx, dy, 256, 256);
          }));
        })(tx, ty);
      }
    }

    return Promise.all(jobs).then(function () {
      var ox = tx0 * 256, oy = ty0 * 256;
      function P(p) { return [lngToPx(p.lng, WS) - ox, latToPx(p.lat, WS) - oy]; }

      g.lineCap = 'round'; g.lineJoin = 'round';
      job.runs.forEach(function (run) {
        if (run.points.length < 2) return;
        var col = levelColor(run.level);
        g.strokeStyle = 'rgba(14,19,23,.55)'; g.lineWidth = 11;
        g.beginPath();
        run.points.forEach(function (p, i) { var q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
        g.stroke();
        g.strokeStyle = col; g.lineWidth = 5;
        g.beginPath();
        run.points.forEach(function (p, i) { var q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
        g.stroke();

        g.font = '600 15px monospace';
        for (var i = 1; i < run.points.length; i++) {
          var a = run.points[i - 1], b = run.points[i];
          var len = Calc.haversineFt(a, b) * settings.calibration;
          if (len < 5) continue;
          var A = P(a), B = P(b);
          var mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
          var txt = Math.round(len) + " ft";
          var w = g.measureText(txt).width + 12;
          g.fillStyle = 'rgba(14,19,23,.9)';
          g.fillRect(mx - w / 2, my - 12, w, 24);
          g.fillStyle = col;
          g.fillText(txt, mx - w / 2 + 6, my + 6);
        }
        run.points.forEach(function (p) {
          var q = P(p);
          g.fillStyle = col; g.beginPath(); g.arc(q[0], q[1], 6, 0, 6.284); g.fill();
          g.strokeStyle = '#0E1317'; g.lineWidth = 2.5; g.stroke();
        });
      });

      try { return cv.toDataURL('image/jpeg', 0.85); } catch (e) { return null; }
    });
  }

  // redesenha uma medição de foto com as marcações, para o PDF
  function photoImage(entry) {
    return new Promise(function (res) {
      var src = entry.img || (entry.key ? Api.photoUrl(entry.key) : null);
      if (!src) { res(entry.thumb || null); return; }
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () {
        var MAX = 1100;
        var s = Math.min(1, MAX / im.naturalWidth);
        var cv = document.createElement('canvas');
        cv.width = Math.round(im.naturalWidth * s);
        cv.height = Math.round(im.naturalHeight * s);
        var g = cv.getContext('2d');
        g.drawImage(im, 0, 0, cv.width, cv.height);
        g.lineCap = 'round'; g.lineJoin = 'round';
        var LW = Math.max(4, Math.round(cv.width / 150));   // traço proporcional ao papel
        var FS = Math.max(13, Math.round(cv.width / 55));

        // pontos gravados em coordenada relativa (0..1) desde a v0.24
        var fx = entry.norm ? im.naturalWidth : 1;
        var fy = entry.norm ? im.naturalHeight : 1;
        function P(p) { return [p.x * fx * s, p.y * fy * s]; }
        var px = entry.refPx || 0;
        var sc = 0;
        if (entry.ref && entry.ref.length === 2) {
          var d = Math.hypot((entry.ref[0].x - entry.ref[1].x) * fx,
                             (entry.ref[0].y - entry.ref[1].y) * fy);
          sc = d > 0 ? (entry.refFeet || 16) / d : 0;
          g.strokeStyle = '#2BE0C0'; g.lineWidth = LW;
          g.beginPath();
          entry.ref.forEach(function (p, i) { var q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
          g.stroke();
          var A = P(entry.ref[0]), B = P(entry.ref[1]);
          g.font = '600 ' + FS + 'px monospace'; g.fillStyle = '#2BE0C0';
          g.fillText('ref ' + (entry.refFeet || 16) + " ft", (A[0] + B[0]) / 2 - 26, (A[1] + B[1]) / 2 + 22);
        }

        (entry.dsLines || []).forEach(function (r) {
          if (r.length < 2) return;
          g.strokeStyle = 'rgba(14,19,23,.5)'; g.lineWidth = LW * 2;
          g.beginPath(); r.forEach(function (p, i) { var q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke();
          g.strokeStyle = '#FF8A3D'; g.lineWidth = LW;
          g.beginPath(); r.forEach(function (p, i) { var q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke();
        });

        (entry.lines || []).forEach(function (r) {
          if (r.length < 2) return;
          g.strokeStyle = 'rgba(14,19,23,.5)'; g.lineWidth = LW * 2.2;
          g.beginPath(); r.forEach(function (p, i) { var q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke();
          g.strokeStyle = '#FFC91B'; g.lineWidth = LW;
          g.beginPath(); r.forEach(function (p, i) { var q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke();
          if (sc) {
            g.font = '600 ' + FS + 'px monospace';
            for (var i = 1; i < r.length; i++) {
              var a = P(r[i - 1]), bb = P(r[i]);
              var len = Math.hypot((r[i].x - r[i - 1].x) * fx,
                                   (r[i].y - r[i - 1].y) * fy) * sc;
              var mx = (a[0] + bb[0]) / 2, my = (a[1] + bb[1]) / 2;
              var txt = Math.round(len) + " ft";
              var w = g.measureText(txt).width + FS;
              g.fillStyle = 'rgba(14,19,23,.9)';
              g.fillRect(mx - w / 2, my - FS * 0.9, w, FS * 1.8);
              g.fillStyle = '#FFC91B'; g.fillText(txt, mx - w / 2 + FS / 2, my + FS * 0.45);
            }
          }
          r.forEach(function (p) {
            var q = P(p);
            g.fillStyle = '#FFC91B'; g.beginPath(); g.arc(q[0], q[1], LW * 1.3, 0, 6.284); g.fill();
            g.strokeStyle = '#0E1317'; g.lineWidth = LW / 2; g.stroke();
          });
        });

        try { res(cv.toDataURL('image/jpeg', 0.82)); } catch (e) { res(entry.thumb || null); }
      };
      im.onerror = function () { res(entry.thumb || null); };
      im.src = src;
    });
  }

  /* ---------- PDF / compartilhar ---------- */
  function measureRows() {
    var rows = '';
    job.runs.forEach(function (r, i) {
      if (r.points.length < 2) return;
      var f = Calc.measure([r], settings.calibration).feet;
      rows += '<tr><td>Run ' + (i + 1) + ' — satellite</td><td>' + levelEn(r.level) + '</td>' +
              '<td>' + (r.points.length - 1) + '</td><td>' + Math.round(f) + " ft</td></tr>";
    });
    (job.manual || []).forEach(function (e, i) {
      rows += '<tr><td>Run ' + (job.runs.length + i + 1) + ' — photo</td><td>' + levelEn(e.level) + '</td>' +
              '<td>—</td><td>' + Math.round(e.feet) + " ft</td></tr>";
    });
    return rows;
  }

  var EN = {
    gutter: 'Seamless Gutter', miters: 'Miters / Corners', caps: 'End Caps',
    hangers: 'Hidden Hangers', dsCount: 'Downspouts', dsFt: 'Downspout (length)',
    elbows: 'Elbows', straps: 'Downspout Straps', splash: 'Splash Blocks',
    screws: 'Screws', sealant: 'Sealant (tubes)'
  };

  function levelEn(lv) {
    return String(lv) === '2' ? '2nd floor' : String(lv) === '3' ? '3rd floor' : 'Ground';
  }

  function buildPrint(mapPng, photoPngs) {
    var p = job._price, l = job._list, c = job.client, m = job._m;
    var shown = p.lines.filter(function (x) { return !/^Margem/.test(x.name); });
    var hidden = p.lines.reduce(function (a, x) { return a + (/^Margem/.test(x.name) ? x.total : 0); }, 0);
    if (hidden > 0) {
      var base = shown.reduce(function (a, x) { return a + x.total; }, 0) || 1;
      shown = shown.map(function (x) {
        var t = x.total * (1 + hidden / base);
        return { name: x.name, qty: x.qty, unit: x.unit, total: t };
      });
    }
    var rows = shown.map(function (x) {
      var n = x.name === 'Instalação' ? 'Installation' : x.name;
      return '<tr><td>' + n + '</td><td>' + (x.unit ? x.qty + ' ' + x.unit : '') + '</td><td>' + money(x.total) + '</td></tr>';
    }).join('');
    var mat = l.filter(function (i) { return i.qty > 0; }).map(function (i) {
      var n = EN[i.key] || i.name;
      if (i.key === 'gutter') n = job.size + '" ' + n;
      return i.qty + ' ' + i.unit + ' — ' + n;
    }).join(' · ');

    var lv = m.byLevel || {};
    var lvTxt = ['1', '2', '3'].filter(function (k) { return lv[k]; })
      .map(function (k) { return levelEn(k) + ': ' + Math.round(lv[k]) + ' ft'; }).join(' · ');

    var evidence = '';
    if (mapPng) {
      evidence += '<div class="p-shot"><div class="p-title">Aerial measurement</div>' +
                  '<img src="' + mapPng + '"></div>';
    }
    (photoPngs || []).forEach(function (o) {
      if (!o.png) return;
      evidence += '<div class="p-shot"><div class="p-title">Facade — ' + levelEn(o.level) +
                  ' · ' + Math.round(o.feet) + ' ft</div><img src="' + o.png + '"></div>';
    });

    $('#print-area').innerHTML =
      '<div class="p-head"><div><h1>' + (settings.company || 'Gutter Co.') + '</h1>' +
      '<div>' + [settings.phone, settings.email].filter(Boolean).join(' · ') + '</div>' +
      (settings.license ? '<div>Lic. ' + settings.license + '</div>' : '') + '</div>' +
      '<div style="text-align:right"><div class="p-title">Estimate</div><div>' + job.id + '</div><div>' +
      new Date().toLocaleDateString('en-US') + '</div></div></div>' +

      '<div class="p-grid"><div><div class="p-title">Prepared for</div><b>' + (c.name || '') + '</b><br>' +
      (c.phone || '') + '<br>' + (c.email || '') + '</div>' +
      '<div><div class="p-title">Job site</div>' + (fullAddress() || '') + '</div>' +
      '<div><div class="p-title">Measured</div>' + ft(m.feet) + ' of ' + job.size + '" gutter<br>' +
      m.corners + ' corners · ' + Calc.qty(l, 'dsCount') + ' downspouts' +
      (job.color ? '<br>Color: ' + job.color : '') + '</div></div>' +

      '<div class="p-title">Measurement detail</div>' +
      '<table class="p-runs"><thead><tr><th>Section</th><th>Level</th><th>Segments</th><th>Length</th></tr></thead>' +
      '<tbody>' + measureRows() +
      '<tr class="p-sum"><td><b>Total</b></td><td>' + lvTxt + '</td><td></td><td><b>' + ft(m.feet) + '</b></td></tr>' +
      '</tbody></table>' +

      evidence +

      '<div class="p-title">Scope &amp; price</div>' +
      '<table><thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody>' + rows +
      (p.discount ? '<tr><td>Discount</td><td></td><td>-' + money(p.discount) + '</td></tr>' : '') +
      (p.tax ? '<tr><td>Tax</td><td></td><td>' + money(p.tax) + '</td></tr>' : '') +
      '</tbody></table>' +
      '<div class="p-total"><span>Total</span><span>' + money(p.total) + '</span></div>' +

      '<div class="p-foot"><b>Materials included:</b> ' + mat + '.<br>' +
      'Estimate valid for 30 days. Aerial lengths taken from orthorectified imagery; facade lengths scaled ' +
      'from a known reference in the photograph. Measurements verified on site before fabrication. ' +
      'Final quantities may vary within 5%.<br><br>' +
      'Accepted by: ______________________________  Date: ____________</div>';
  }

  $('#btn-pdf').addEventListener('click', function () {
    toast('Montando o PDF com as marcações…');
    var shots = (job.manual || []).map(function (e) {
      return photoImage(e).then(function (png) {
        return { png: png, level: e.level, feet: e.feet };
      });
    });
    Promise.all([mapImage()].concat(shots))
      .then(function (all) {
        buildPrint(all[0], all.slice(1));
        setTimeout(function () { window.print(); }, 250);
      })
      .catch(function () {
        buildPrint(null, []);
        setTimeout(function () { window.print(); }, 120);
      });
  });

  $('#btn-share').addEventListener('click', function () {
    var p = job._price;
    var txt = (settings.company || 'Gutter estimate') + '\n' +
      (job.client.name || '') + ' — ' + fullAddress() + '\n' +
      ft(job._m.feet) + ' of ' + job.size + '" gutter, ' + Calc.qty(job._list, 'dsCount') + ' downspouts, ' +
      job._m.corners + ' corners\nTotal: ' + money(p.total);
    if (navigator.share) navigator.share({ title: 'Gutter Estimate', text: txt }).catch(function () {});
    else { navigator.clipboard.writeText(txt); toast('Resumo copiado.'); }
  });

  /* ---------- clientes / histórico ---------- */
  function renderClients() {
    var seen = {}, out = [];
    jobs.forEach(function (j) {
      var key = (j.client.name || '') + '|' + (j.client.address || '');
      if (!seen[key]) { seen[key] = 1; out.push(j); }
    });
    $('#clients-list').innerHTML = out.length ? out.map(function (j) {
      return '<div class="list-item"><div class="li-main"><b>' + (j.client.name || 'Sem nome') + '</b>' +
        '<small>' + [j.client.address, j.client.city].filter(Boolean).join(', ') + '</small></div>' +
        '<span class="li-val">' + (j.client.phone || '') + '</span></div>';
    }).join('') : '<p class="empty">Nenhum cliente ainda. Todo orçamento salvo cria um cliente aqui.</p>';
  }

  function renderHistory() {
    $('#history-list').innerHTML = jobs.length ? jobs.map(function (j) {
      var st = ST[j.status] || ST.draft;
      return '<div class="list-item" data-open="' + j.id + '"><div class="li-main"><b>' + (j.client.name || 'Sem nome') + '</b>' +
        '<small>' + new Date(j.savedAt).toLocaleDateString('pt-BR') + ' · ' + ft(j.feet) +
        ' · <span class="st-tag ' + st.cls + '">' + st.label + '</span></small></div>' +
        '<span class="li-val">' + money(j.total) + '</span></div>';
    }).join('') : '<p class="empty">Nenhum orçamento salvo ainda.</p>';
  }

  $('#history-list').addEventListener('click', function (e) {
    var el = e.target.closest('[data-open]');
    if (!el) return;
    var found = jobs.filter(function (j) { return j.id === el.dataset.open; })[0];
    if (!found) return;
    job = JSON.parse(JSON.stringify(found));
    job.manual = job.manual || [];
    job.runs = job.runs || [];
    fillJobForm();
    go('quote');
  });

  /* ---------- configurações ---------- */
  var SET_MAP = {
    '#set-company': 'company', '#set-phone': 'phone', '#set-email': 'email', '#set-license': 'license',
    '#p-min': 'minJob',
    '#d-lf5': 'd_lf5', '#d-lf6': 'd_lf6', '#d-ds': 'd_ds', '#d-elbow': 'd_elbow', '#d-miter': 'd_miter',
    '#d-cap': 'd_cap', '#d-hanger': 'd_hanger', '#d-splash': 'd_splash', '#d-labor': 'd_labor',
    '#p-mpct': 'marginPct',
    '#r-hanger': 'hangerSpacingIn', '#r-ds': 'dsEveryFt', '#r-waste': 'wastePct', '#r-cal': 'calibration',
    '#set-user': 'user', '#set-pass': 'pass'
  };

  function fillSettings() {
    Object.keys(SET_MAP).forEach(function (sel) { $(sel).value = settings[SET_MAP[sel]]; });
  }
  $('#btn-save-settings').addEventListener('click', function () {
    Object.keys(SET_MAP).forEach(function (sel) {
      var k = SET_MAP[sel], v = $(sel).value;
      settings[k] = (typeof Calc.DEFAULTS[k] === 'number') ? (Number(v) || 0) : v;
    });
    if (!settings.user) settings.user = 'admin';
    if (!settings.pass) settings.pass = '1234';
    if (!settings.calibration) settings.calibration = 1;
    save(K.set, settings);
    toast('Configurações salvas.');
  });

  $('#btn-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify({ settings: settings, jobs: jobs }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rainline-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  });

  $('#btn-refresh').addEventListener('click', function () {
    toast('Buscando a versão mais nova…');
    var jobs = [];
    if (window.caches) jobs.push(caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) { return caches.delete(k); }));
    }));
    if (navigator.serviceWorker) jobs.push(
      navigator.serviceWorker.getRegistrations().then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister(); }));
      })
    );
    Promise.all(jobs).catch(function () {}).then(function () {
      setTimeout(function () { location.reload(true); }, 400);
    });
  });

  /* ---------- boot ---------- */
  if (load(K.sess, null)) go('home');
  armBack();
  bootCloud();
  Api.health().then(function (ok) {
    var m = $('#login-mode');
    if (m) m.textContent = ok
      ? 'Conectado ao servidor — orçamentos salvos na nuvem.'
      : 'Sem servidor agora — o app funciona offline neste aparelho.';
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
