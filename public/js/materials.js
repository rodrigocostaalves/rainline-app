/* RainLine — motor de cálculo de materiais e preços
   Todas as regras ficam aqui. Mexeu na regra, mexe só neste arquivo. */
(function (global) {
  'use strict';

  var DEFAULTS = {
    company: '', phone: '', email: '', license: '',
    user: 'admin', pass: '1234',
    minJob: 0,
    // custo do material + mão de obra
    d_lf5: 2.20, d_lf6: 3.10, d_ds: 2.40, d_elbow: 4.50,
    d_miter: 12.00, d_cap: 3.50, d_hanger: 3.20, d_splash: 8.00,
    d_labor: 3.50,
    marginPct: 20,
    // regras
    hangerSpacingIn: 24,   // Flórida: 24" por causa de vento/chuva forte
    dsEveryFt: 35,         // 1 descida a cada ~35 ft de calha
    wastePct: 10,
    calibration: 1.00
  };

  var FT_PER_STORY = { 1: 12, 2: 22, 3: 32 };

  /* ---- medição ---------------------------------------------------- */
  // runs = [{ points:[{lat,lng},...] }]
  function measure(runs, calibration, manual) {
    var cal = calibration || 1;
    var total = 0, segments = 0, corners = 0, live = 0, ends = 0;
    var byLevel = {}, runsByLevel = {};
    runs.forEach(function (r) {
      var p = r.points || [];
      if (p.length < 2) return;
      var lv = String(r.level || 1);
      live++;
      var len = 0;
      for (var i = 1; i < p.length; i++) {
        len += haversineFt(p[i - 1], p[i]);
        segments++;
      }
      total += len;
      byLevel[lv] = (byLevel[lv] || 0) + len * cal;
      runsByLevel[lv] = (runsByLevel[lv] || 0) + 1;
      if (isClosed(p)) {
        corners += p.length - 1;   // volta fechada: todo vértice é canto
      } else {
        corners += p.length - 2;
        ends += 2;                 // só linha aberta leva end cap
      }
    });
    // trechos medidos fora do mapa (foto de fachada, trena em campo)
    var manualFeet = 0;
    (manual || []).forEach(function (e) {
      var f = Number(e.feet) || 0;
      if (f <= 0) return;
      var lv = String(e.level || 1);
      manualFeet += f;
      live++;
      ends += 2;
      corners += Number(e.corners) || 0;
      byLevel[lv] = (byLevel[lv] || 0) + f;
      runsByLevel[lv] = (runsByLevel[lv] || 0) + 1;
    });

    return {
      feet: total * cal + manualFeet,
      manualFeet: manualFeet,
      segments: segments,
      corners: corners,
      runs: live,
      ends: ends,
      byLevel: byLevel,
      runsByLevel: runsByLevel
    };
  }

  // fechada = último ponto praticamente em cima do primeiro
  function isClosed(p) {
    return p.length > 2 && haversineFt(p[0], p[p.length - 1]) < 3;
  }

  function haversineFt(a, b) {
    var R = 20902231; // raio da Terra em pés
    var dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  function rad(d) { return d * Math.PI / 180; }

  /* ---- lista de materiais ----------------------------------------- */
  function materials(m, cfg) {
    var s = Object.assign({}, DEFAULTS, cfg || {});
    var feet = Math.max(0, m.feet);
    var stories = String(s.stories || 1);
    var dsLen = FT_PER_STORY[stories] || 12;

    var gutterFt = Math.ceil(feet * (1 + s.wastePct / 100));

    // uma descida do 2º andar gasta o dobro de cano de uma do térreo
    var dsCount = 0, dsFt = 0, straps = 0;
    var levels = m.byLevel || {};
    var anyLevel = false;
    Object.keys(levels).forEach(function (lv) {
      anyLevel = true;
      var lvFeet = levels[lv];
      var lvRuns = (m.runsByLevel || {})[lv] || 1;
      var n = lvFeet > 0 ? Math.max(lvRuns, Math.ceil(lvFeet / s.dsEveryFt)) : 0;
      var h = FT_PER_STORY[lv] || 12;
      dsCount += n;
      dsFt += n * h;
      straps += n * (lv === '1' ? 2 : lv === '2' ? 4 : 6);
    });
    if (!anyLevel && feet > 0) {           // compatível com orçamentos antigos
      dsCount = Math.max(m.runs || 1, Math.ceil(feet / s.dsEveryFt));
      dsFt = dsCount * dsLen;
      straps = dsCount * (stories === '1' ? 2 : stories === '2' ? 4 : 6);
    }
    var hangers = Math.ceil(feet / (s.hangerSpacingIn / 12));

    return [
      { key: 'gutter', name: (s.size || 5) + '" Seamless Gutter', note: 'inclui ' + s.wastePct + '% de perda', qty: gutterFt, unit: 'ft' },
      { key: 'miters', name: 'Miters / Corners', note: 'cantos medidos no mapa', qty: m.corners, unit: 'ea' },
      { key: 'caps', name: 'End Caps', note: '2 por linha aberta', qty: m.ends, unit: 'ea' },
      { key: 'hangers', name: 'Hidden Hangers', note: '1 a cada ' + s.hangerSpacingIn + '"', qty: hangers, unit: 'ea' },
      { key: 'dsCount', name: 'Downspouts', note: '1 a cada ' + s.dsEveryFt + ' ft', qty: dsCount, unit: 'ea' },
      { key: 'dsFt', name: 'Downspout (comprimento)', note: 'altura conforme o nível de cada linha', qty: dsFt, unit: 'ft' },
      { key: 'elbows', name: 'Elbows', note: '3 por descida (2 em cima, 1 embaixo)', qty: dsCount * 3, unit: 'ea' },
      { key: 'straps', name: 'Downspout Straps', note: '2 por andar de descida', qty: straps, unit: 'ea' },
      { key: 'splash', name: 'Splash Blocks', note: '1 por descida', qty: dsCount, unit: 'ea' },
      { key: 'screws', name: 'Parafusos', note: '1 por hanger + folga', qty: Math.ceil(hangers * 1.1), unit: 'ea' },
      { key: 'sealant', name: 'Vedação (tubos)', note: 'cantos + end caps', qty: Math.max(feet > 0 ? 1 : 0, Math.ceil((m.corners + m.ends) / 8)), unit: 'ea' }
    ];
  }

  function qty(list, key) {
    var f = list.filter(function (i) { return i.key === key; })[0];
    return f ? Number(f.qty) || 0 : 0;
  }

  /* ---- preço ------------------------------------------------------- */
  function price(list, cfg) {
    var s = Object.assign({}, DEFAULTS, cfg || {});
    var size = String(s.size || 5);
    var lines = [], subtotal = 0;

    function add(name, q, unitPrice, unitLabel) {
      if (!q) return;
      var t = q * unitPrice;
      lines.push({ name: name, qty: q, unit: unitLabel || 'ea', unitPrice: unitPrice, total: t });
      subtotal += t;
    }

    var gutterFt = qty(list, 'gutter');

    add(size + '" Seamless Gutter', gutterFt, size === '6' ? s.d_lf6 : s.d_lf5, 'ft');
    add('Miters / Corners', qty(list, 'miters'), s.d_miter);
    add('End Caps', qty(list, 'caps'), s.d_cap);
    add('Hidden Hangers', qty(list, 'hangers'), s.d_hanger);
    add('Downspout', qty(list, 'dsFt'), s.d_ds, 'ft');
    add('Elbows', qty(list, 'elbows'), s.d_elbow);
    add('Splash Blocks', qty(list, 'splash'), s.d_splash);
    // mão de obra: entra no custo, mas fica fora da lista que o cliente vê
    var labor = gutterFt * (Number(s.d_labor) || 0);
    subtotal += labor;

    var material = subtotal - labor;           // só material
    var cost = subtotal;                       // material + mão de obra

    // margem: só percentual, aplicada sobre o custo
    var margin = 0;
    if (s.marginMode === 'pct') {
      margin = cost * ((Number(s.marginPct) || 0) / 100);
      if (margin > 0) {
        lines.push({ name: 'Margem comercial', qty: 1, unit: '', unitPrice: margin, total: margin });
        subtotal += margin;
      }
    }

    var minApplied = false;
    if (subtotal > 0 && subtotal < s.minJob) { subtotal = s.minJob; minApplied = true; }

    var discount = Number(s.discount) || 0;
    var afterDisc = Math.max(0, subtotal - discount);
    var tax = afterDisc * ((Number(s.taxPct) || 0) / 100);

    return {
      lines: lines,
      material: material,
      labor: labor,
      cost: cost,
      margin: margin,
      marginAfterDiscount: margin - discount,
      subtotal: subtotal,
      minApplied: minApplied,
      discount: discount,
      tax: tax,
      total: afterDisc + tax
    };
  }

  global.Calc = {
    DEFAULTS: DEFAULTS,
    measure: measure,
    materials: materials,
    price: price,
    qty: qty,
    isClosed: isClosed,
    haversineFt: haversineFt
  };
})(window);
