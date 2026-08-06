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
    if (name === 'materials') renderMaterials();
    if (name === 'quote') renderQuote();
    if (name === 'clients') renderClients();
    if (name === 'history') renderHistory();
    if (name === 'settings') fillSettings();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go],[data-back],[data-action]');
    if (!b) return;
    if (b.dataset.go) go(b.dataset.go === 'job' ? (newJob(), 'job') : b.dataset.go);
    if (b.dataset.back) go(b.dataset.back);
    if (b.dataset.action === 'logout') { save(K.sess, null); go('login'); }
  });

  /* ---------- login ---------- */
  $('#form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var u = $('#login-user').value.trim(), p = $('#login-pass').value;
    if (u === settings.user && p === settings.pass) {
      save(K.sess, { user: u, at: Date.now() });
      $('#login-pass').value = '';
      go('home');
    } else {
      $('#login-hint').textContent = 'Usuário ou senha não conferem. Tente de novo.';
    }
  });

  /* ---------- dashboard ---------- */
  function renderHome() {
    $('#home-user').textContent = (load(K.sess, {}) || {}).user || 'Vendedor';
    var now = new Date(), n = 0, v = 0;
    jobs.forEach(function (j) {
      var d = new Date(j.savedAt);
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) { n++; v += j.total || 0; }
    });
    $('#stat-month').textContent = n;
    $('#stat-value').textContent = '$' + Math.round(v).toLocaleString('en-US');
  }

  /* ---------- novo orçamento ---------- */
  function newJob() {
    job = {
      id: 'Q' + Date.now().toString(36).toUpperCase(),
      client: {}, runs: [], manual: [], overrides: {},
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
    go('map');
    initMap();
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
    var saved = 0;
    try {
      var id = localStorage.getItem('rainline.layer');
      LAYERS.forEach(function (l, i) { if (l.id === id) saved = i; });
    } catch (e) {}
    applyLayer(saved);

    map.on('click', function (e) {
      if (!job) return;
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
  }

  /* ---------- detectar o telhado ---------- */
  function detectRoof() {
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

  /* ---------- botões do mapa ---------- */
  $$('[data-mapmode]').forEach(function (b) {
    b.addEventListener('click', function () { setMapMode(b.dataset.mapmode); });
  });
  $('#btn-detect').addEventListener('click', detectRoof);
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
    job.runs = []; selected = null; renderDraw();
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
    var c = map.getCenter();
    window.open('https://www.bing.com/maps?cp=' + c.lat.toFixed(6) + '~' + c.lng.toFixed(6) +
                '&lvl=19&style=b', '_blank');
  });
  $('#btn-sv').addEventListener('click', function () {
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

  $('#rail-toggle').addEventListener('click', function () {
    var r = $('#map-rail');
    var closed = r.classList.toggle('is-closed');
    $('#rail-toggle').textContent = closed ? '‹' : '›';
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
    map.setView([job.center.lat, job.center.lng], 21);
    setMapMode('draw');
    renderDraw();
    toast('Exemplo carregado. Arraste os pontos amarelos para ver a medida mudar.');
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
    runs: [[]],                     // linhas medidas, em pixels da imagem
    scale: 0,                       // pés por pixel
    level: 1
  };

  function photoCanvas() { return document.getElementById('photo-canvas'); }

  function openPhoto() {
    go('photo');
    setTimeout(drawPhoto, 60);
  }

  $('#btn-photo').addEventListener('click', openPhoto);
  $('#btn-pick').addEventListener('click', function () { $('#photo-file').click(); });
  $('#btn-photo-pick2').addEventListener('click', function () { $('#photo-file').click(); });

  $('#photo-file').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var img = new Image();
    img.onload = function () {
      ph.img = img; ph.w = img.naturalWidth; ph.h = img.naturalHeight;
      ph.ref = []; ph.runs = [[]]; ph.scale = 0; ph.step = 'ref';
      setPhotoStep('ref');
      $('#photo-empty').hidden = true;
      drawPhoto();
      toast('Agora trace a referência: dois toques nas bordas da porta da garagem.');
    };
    img.onerror = function () { toast('Não consegui abrir essa imagem.'); };
    img.src = URL.createObjectURL(f);
  });

  function setPhotoStep(s) {
    ph.step = s;
    $$('[data-pstep]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.pstep === s); });
    $('#ref-row').style.opacity = s === 'ref' ? '1' : '.5';
  }
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
      recalcPhoto();
    });
  });
  $('#ref-feet').addEventListener('input', recalcPhoto);

  $$('[data-plevel]').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('[data-plevel]').forEach(function (o) { o.classList.remove('is-on'); });
      b.classList.add('is-on');
      ph.level = +b.dataset.plevel;
    });
  });

  // toque na imagem
  photoCanvas().addEventListener('click', function (ev) {
    if (!ph.img) return;
    var r = photoCanvas().getBoundingClientRect();
    var x = (ev.clientX - r.left - ph.fit.x) / ph.fit.s;
    var y = (ev.clientY - r.top - ph.fit.y) / ph.fit.s;
    if (x < 0 || y < 0 || x > ph.w || y > ph.h) return;

    if (ph.step === 'ref') {
      if (ph.ref.length >= 2) ph.ref = [];
      ph.ref.push({ x: x, y: y });
      if (ph.ref.length === 2) {
        recalcPhoto();
        setPhotoStep('measure');
        toast('Escala definida. Agora trace os beirais.');
      }
    } else {
      ph.runs[ph.runs.length - 1].push({ x: x, y: y });
    }
    recalcPhoto();
  });

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

  function recalcPhoto() {
    var rf = Number($('#ref-feet').value) || 0;
    if (ph.ref.length === 2 && rf > 0) {
      var px = pxLen(ph.ref[0], ph.ref[1]);
      ph.scale = px > 0 ? rf / px : 0;
    }
    var t = photoFeet();
    $('#photo-total').textContent = Math.round(t.feet);
    $('#photo-scale').textContent = ph.scale
      ? 'escala ok · ' + t.lines + ' linha(s)'
      : 'sem escala ainda';
    drawPhoto();
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

    var s = Math.min(W / ph.w, H / ph.h);
    var x = (W - ph.w * s) / 2, y = (H - ph.h * s) / 2;
    ph.fit = { x: x, y: y, s: s };
    g.drawImage(ph.img, x, y, ph.w * s, ph.h * s);

    function P(p) { return [x + p.x * s, y + p.y * s]; }

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

  $('#btn-photo-undo').addEventListener('click', function () {
    if (ph.step === 'ref') { ph.ref.pop(); }
    else {
      var last = ph.runs[ph.runs.length - 1];
      last.pop();
      if (!last.length && ph.runs.length > 1) ph.runs.pop();
    }
    recalcPhoto();
  });

  $('#btn-photo-newline').addEventListener('click', function () {
    if (ph.step !== 'measure') { toast('Termine a referência primeiro.'); return; }
    if (!ph.runs[ph.runs.length - 1].length) { toast('A linha atual está vazia.'); return; }
    ph.runs.push([]);
    toast('Linha nova na foto.');
  });

  $('#btn-photo-add').addEventListener('click', function () {
    var t = photoFeet();
    if (t.feet < 1) { toast('Trace pelo menos uma linha com escala definida.'); return; }
    job.manual = job.manual || [];
    job.manual.push({
      feet: Math.round(t.feet), corners: t.corners, level: ph.level, note: 'medido na foto'
    });
    ph.runs = [[]];
    recalcPhoto();
    toast(Math.round(t.feet) + ' ft somados ao orçamento.');
    go('map');
    setTimeout(function () { if (map) { map.invalidateSize(); updateTape(); } }, 60);
  });

  window.addEventListener('resize', function () { if (ph.img) drawPhoto(); });

  /* ---------- materiais ---------- */
  function currentList() {
    var m = Calc.measure(job.runs, settings.calibration, job.manual);
    var cfg = Object.assign({}, settings, { size: job.size, stories: job.stories });
    var list = Calc.materials(m, cfg);
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

  /* ---------- orçamento ---------- */
  function renderQuote() {
    var d = currentList();
    $('#quote-discount').value = job.discount || 0;
    $('#quote-tax').value = job.taxPct || 0;
    var cfg = Object.assign({}, d.cfg, { discount: job.discount, taxPct: job.taxPct });
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
  }
  ['#quote-discount', '#quote-tax'].forEach(function (sel) {
    $(sel).addEventListener('input', function () {
      job.discount = Number($('#quote-discount').value) || 0;
      job.taxPct = Number($('#quote-tax').value) || 0;
      renderQuote();
    });
  });

  $('#btn-save').addEventListener('click', function () {
    job.savedAt = Date.now();
    job.total = job._price.total;
    job.feet = job._m.feet;
    var i = jobs.findIndex(function (j) { return j.id === job.id; });
    var copy = JSON.parse(JSON.stringify(job));
    delete copy._price; delete copy._list; delete copy._m;
    if (i >= 0) jobs[i] = copy; else jobs.unshift(copy);
    save(K.jobs, jobs);
    toast('Orçamento ' + job.id + ' salvo.');
  });

  /* ---------- PDF / compartilhar ---------- */
  function buildPrint() {
    var p = job._price, l = job._list, c = job.client;
    var rows = p.lines.map(function (x) {
      return '<tr><td>' + x.name + '</td><td>' + (x.unit ? x.qty + ' ' + x.unit : '') + '</td><td>' + money(x.total) + '</td></tr>';
    }).join('');
    var mat = l.filter(function (i) { return i.qty > 0; }).map(function (i) {
      return i.qty + ' ' + i.unit + ' — ' + i.name;
    }).join(' · ');

    $('#print-area').innerHTML =
      '<div class="p-head"><div><h1>' + (settings.company || 'Gutter Co.') + '</h1>' +
      '<div>' + [settings.phone, settings.email].filter(Boolean).join(' · ') + '</div>' +
      (settings.license ? '<div>Lic. ' + settings.license + '</div>' : '') + '</div>' +
      '<div style="text-align:right"><div class="p-title">Estimate</div><div>' + job.id + '</div><div>' +
      new Date().toLocaleDateString('en-US') + '</div></div></div>' +
      '<div class="p-grid"><div><div class="p-title">Prepared for</div><b>' + (c.name || '') + '</b><br>' +
      (c.phone || '') + '<br>' + (c.email || '') + '</div>' +
      '<div><div class="p-title">Job site</div>' + (fullAddress() || '') + '</div>' +
      '<div><div class="p-title">Measured</div>' + ft(job._m.feet) + ' of ' + job.size + '" gutter<br>' +
      job._m.corners + ' corners · ' + Calc.qty(l, 'dsCount') + ' downspouts' + (job.color ? '<br>Color: ' + job.color : '') + '</div></div>' +
      '<table><thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody>' + rows +
      (p.discount ? '<tr><td>Discount</td><td></td><td>-' + money(p.discount) + '</td></tr>' : '') +
      (p.tax ? '<tr><td>Tax</td><td></td><td>' + money(p.tax) + '</td></tr>' : '') +
      '</tbody></table>' +
      '<div class="p-total"><span>Total</span><span>' + money(p.total) + '</span></div>' +
      '<div class="p-foot"><b>Materials included:</b> ' + mat + '.<br>' +
      'Estimate valid for 30 days. Measurements taken from aerial imagery and verified on site before fabrication. ' +
      'Final quantities may vary within 5%.<br><br>' +
      'Accepted by: ______________________________  Date: ____________</div>';
  }

  $('#btn-pdf').addEventListener('click', function () {
    buildPrint();
    setTimeout(function () { window.print(); }, 80);
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
      return '<div class="list-item" data-open="' + j.id + '"><div class="li-main"><b>' + (j.client.name || 'Sem nome') + '</b>' +
        '<small>' + new Date(j.savedAt).toLocaleDateString('pt-BR') + ' · ' + ft(j.feet) + ' · ' + j.id + '</small></div>' +
        '<span class="li-val">' + money(j.total) + '</span></div>';
    }).join('') : '<p class="empty">Nenhum orçamento salvo ainda.</p>';
  }

  $('#history-list').addEventListener('click', function (e) {
    var el = e.target.closest('[data-open]');
    if (!el) return;
    var found = jobs.filter(function (j) { return j.id === el.dataset.open; })[0];
    if (!found) return;
    job = JSON.parse(JSON.stringify(found));
    go('quote');
  });

  /* ---------- configurações ---------- */
  var SET_MAP = {
    '#set-company': 'company', '#set-phone': 'phone', '#set-email': 'email', '#set-license': 'license',
    '#p-lf5': 'lf5', '#p-lf6': 'lf6', '#p-ds': 'dsFt', '#p-miter': 'miter', '#p-min': 'minJob',
    '#d-lf5': 'd_lf5', '#d-lf6': 'd_lf6', '#d-ds': 'd_ds', '#d-elbow': 'd_elbow', '#d-miter': 'd_miter',
    '#d-cap': 'd_cap', '#d-hanger': 'd_hanger', '#d-splash': 'd_splash', '#d-labor': 'd_labor', '#d-markup': 'd_markup',
    '#r-hanger': 'hangerSpacingIn', '#r-ds': 'dsEveryFt', '#r-waste': 'wastePct', '#r-cal': 'calibration',
    '#set-user': 'user', '#set-pass': 'pass'
  };

  function fillSettings() {
    Object.keys(SET_MAP).forEach(function (sel) { $(sel).value = settings[SET_MAP[sel]]; });
    setMode(settings.mode);
  }
  function setMode(mode) {
    $$('#seg-mode .seg-btn').forEach(function (b) { b.classList.toggle('is-on', b.dataset.mode === mode); });
    $('#price-simple').hidden = mode !== 'simple';
    $('#price-detail').hidden = mode !== 'detail';
  }
  $('#seg-mode').addEventListener('click', function (e) {
    if (!e.target.dataset.mode) return;
    settings.mode = e.target.dataset.mode; setMode(settings.mode);
  });

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
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
