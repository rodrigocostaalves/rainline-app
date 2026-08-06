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
      client: {}, runs: [], overrides: {},
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
    geocode();
  });

  function fullAddress() {
    var c = job.client;
    return [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');
  }

  function geocode() {
    var q = fullAddress();
    if (!q) { toast('Sem endereço — arraste o mapa até a casa.'); return; }
    toast('Procurando o imóvel…');
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d[0]) {
          map.setView([+d[0].lat, +d[0].lon], 20);
          job.center = { lat: +d[0].lat, lng: +d[0].lon };
          toast('Imóvel encontrado. Confira antes de medir.');
        } else {
          toast('Endereço não encontrado. Arraste o mapa até a casa.');
        }
      })
      .catch(function () { toast('Sem internet para buscar. Posicione o mapa na mão.'); });
  }

  /* ---------- mapa e desenho ---------- */
  function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 22 })
      .setView([28.5384, -81.3789], 18); // Orlando
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 19, maxZoom: 22,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics'
    }).addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    drawLayer = L.layerGroup().addTo(map);

    map.on('click', function (e) {
      if (!job) return;
      if (!job.runs.length) job.runs.push({ points: [] });
      job.runs[job.runs.length - 1].points.push({ lat: e.latlng.lat, lng: e.latlng.lng });
      renderDraw();
    });
  }

  function renderDraw() {
    if (!drawLayer) return;
    drawLayer.clearLayers();

    job.runs.forEach(function (run, ri) {
      var pts = run.points.map(function (p) { return [p.lat, p.lng]; });
      if (pts.length > 1) {
        L.polyline(pts, { color: '#FFC91B', weight: 5, opacity: .95 }).addTo(drawLayer);
        L.polyline(pts, { color: '#101418', weight: 9, opacity: .35 }).addTo(drawLayer).bringToBack();
        for (var i = 1; i < pts.length; i++) {
          var a = run.points[i - 1], b = run.points[i];
          var mid = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2];
          var len = Calc.haversineFt(a, b) * settings.calibration;
          L.marker(mid, {
            interactive: false,
            icon: L.divIcon({ className: 'seg-label', html: Math.round(len) + ' ft', iconSize: [48, 18], iconAnchor: [24, 9] })
          }).addTo(drawLayer);
        }
      }
      run.points.forEach(function (p, pi) {
        var mk = L.marker([p.lat, p.lng], {
          draggable: true,
          icon: L.divIcon({ className: 'vertex', iconSize: [16, 16], iconAnchor: [8, 8] })
        }).addTo(drawLayer);
        mk.on('drag', function (ev) {
          job.runs[ri].points[pi] = { lat: ev.latlng.lat, lng: ev.latlng.lng };
          updateTape();
        });
        mk.on('dragend', renderDraw);
      });
    });
    updateTape();
  }

  function updateTape() {
    var m = Calc.measure(job ? job.runs : [], settings.calibration);
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

  $('#btn-undo').addEventListener('click', function () {
    if (!job || !job.runs.length) return;
    var last = job.runs[job.runs.length - 1];
    last.points.pop();
    if (!last.points.length && job.runs.length > 1) job.runs.pop();
    renderDraw();
  });
  $('#btn-newline').addEventListener('click', function () {
    if (!job) return;
    var last = job.runs[job.runs.length - 1];
    if (last && !last.points.length) { toast('A linha atual ainda está vazia.'); return; }
    job.runs.push({ points: [] });
    toast('Linha nova. Toque no primeiro canto do beiral.');
  });
  $('#btn-clear').addEventListener('click', function () {
    if (!job) return;
    job.runs = []; renderDraw();
  });
  $('#btn-relocate').addEventListener('click', geocode);
  $('#btn-to-materials').addEventListener('click', function () {
    var m = Calc.measure(job.runs, settings.calibration);
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
    renderDraw();
    toast('Exemplo carregado. Arraste os pontos amarelos para ver a medida mudar.');
  });

  /* ---------- materiais ---------- */
  function currentList() {
    var m = Calc.measure(job.runs, settings.calibration);
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

  /* ---------- boot ---------- */
  if (load(K.sess, null)) go('home');
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
