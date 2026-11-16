// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable and sortable table, a per-protocol detail view with the model's
// own arithmetic and the protocol's farm plan, a live-token view with the comparable multiples the
// prices come from, and a method view that states the model. No network: every byte is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var params = new URLSearchParams(window.location.search);
  var state = {
    tab: params.get('tab') || 'board',
    q: params.get('q') || '',
    category: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'rank',
    dir: params.get('dir') === 'asc' ? 1 : params.get('dir') === 'desc' ? -1 : 1,
    selected: params.get('detail') || null,
  };
  if (state.sort === 'rank') state.dir = 1;

  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  if (state.selected && !bySlug[state.selected]) state.selected = null;

  // ---------- formatting ----------
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(3) + 'x'; }
  function fmtX(n) { return n.toFixed(3) + 'x'; }

  // ---------- header + stats ----------
  document.getElementById('asof').innerHTML =
    '<strong>Snapshot ' + esc(DATA.as_of) + '</strong>' + esc(DATA.stats.protocols) + ' protocols tracked<br>' +
    'model ' + esc(DATA.model_version) + ' · floor ' + fmtUsd(DATA.floor_usd);
  document.getElementById('src').textContent = 'Data: ' + DATA.source + '. Board and page are generated from that one sealed file; nothing is fetched.';

  function statsHtml() {
    var s = DATA.stats;
    var cards = [
      ['Protocols ranked', String(s.board_rows), 'every one records no token yet'],
      ['Watchlist covered', s.watchlist_rows + ' / ' + s.watchlist_rows, 'the house floor, all ranked'],
      ['Early finds', String(s.early_rows), 'below the floor, found by the radar'],
      ['TVL under rank', fmtUsd(s.board_tvl_usd), 'across the ranked protocols'],
      ['Priced from comps', String(s.comp_protocols), 'live tokens set the multiples'],
    ];
    return '<section class="stats">' + cards.map(function (c) {
      return '<div class="stat"><div class="k">' + esc(c[0]) + '</div><div class="v">' + esc(c[1]) + '</div><div class="s">' + esc(c[2]) + '</div></div>';
    }).join('') + '</section>';
  }

  function tabsHtml() {
    var tabs = [['board', 'The board'], ['live', 'Live tokens & comps'], ['method', 'Method']];
    return '<nav class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button class="tab" role="tab" data-tab="' + t[0] + '" aria-selected="' + (state.tab === t[0]) + '">' + t[1] + '</button>';
    }).join('') + '</nav>';
  }

  // ---------- board ----------
  function categories() {
    var seen = {};
    rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  var SORTS = {
    rank: function (r) { return r.rank; },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d; },
    age: function (r) { return r.age_days; },
    multiple: function (r) { return r.model.multiple; },
    implied: function (r) { return r.implied_value_usd; },
  };
  function sorted(list) {
    var key = SORTS[state.sort] || SORTS.rank;
    return list.slice().sort(function (a, b) {
      var va = key(a), vb = key(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (va !== vb) return (va < vb ? -1 : 1) * state.dir;
      return a.rank - b.rank;
    });
  }

  function controlsHtml() {
    var catOpts = ['<option value="all">All categories</option>'].concat(categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    var chainOpts = ['<option value="all">All chains</option>'].concat(chains().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    var sortOpts = [['rank', 'Rank'], ['implied', 'Implied value'], ['tvl', 'TVL'], ['change', '7d change'], ['age', 'Age'], ['multiple', 'Multiple']].map(function (o) {
      return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    return '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name or slug" value="' + esc(state.q) + '" aria-label="Search protocols">' +
      '<label>Category <select id="cat">' + catOpts + '</select></label>' +
      '<label>Chain <select id="chain">' + chainOpts + '</select></label>' +
      '<button class="chip" id="watch" aria-pressed="' + state.watch + '">★ Watchlist only</button>' +
      '<label>Sort <select id="sort">' + sortOpts + '</select></label>' +
      '<span class="count" id="count"></span></div>';
  }

  function th(key, label, cls) {
    var arrow = state.sort === key ? ' <span class="dir">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '';
    return '<th class="sortable ' + (cls || '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
  }

  function tableHtml(list) {
    if (list.length === 0) return '<div class="tablewrap"><div class="empty">No protocol matches this filter. Loosen the search, or clear the watchlist toggle.</div></div>';
    var body = list.map(function (r) {
      var ch = r.chains.length === 0 ? '—' : esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      var pct = r.change_7d === null ? '<span class="pslug">n/a</span>' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="rank">#' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? ' <span class="star" title="On the house watchlist">★</span>' : '') +
        '<br><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td>' + (r.category ? '<span class="catchip">' + esc(r.category) + '</span>' : '<span class="pslug">uncategorised</span>') + '</td>' +
        '<td class="chains">' + ch + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num mult">' + fmtMult(r.model.multiple) + '</td>' +
        '<td class="num implied">' + fmtUsd(r.implied_value_usd) + '</td></tr>';
    }).join('');
    return '<div class="tablewrap"><table><thead><tr>' +
      th('rank', '#') + '<th>Protocol</th><th>Category</th><th>Chains</th>' +
      th('tvl', 'TVL', 'num') + th('change', '7d', 'num') + th('age', 'Age', 'num') +
      th('multiple', 'Multiple', 'num') + th('implied', 'Implied value', 'num') +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // ---------- detail ----------
  function stepHtml(step) {
    var m = /^(.*) Cost: (.*)\. Time: (.*)\.$/.exec(step);
    if (!m) return '<li>' + esc(step) + '</li>';
    return '<li>' + esc(m[1]) + '<span class="meta"><b>Cost:</b> ' + esc(m[2]) + ' &nbsp;<b>Time:</b> ' + esc(m[3]) + '</span></li>';
  }

  function detailHtml(r) {
    var md = r.model;
    var lo = md.implied_low_usd, hi = md.implied_high_usd;
    var segL = hi > 0 ? (lo / hi) * 100 : 0;
    var dotL = hi > 0 ? (r.implied_value_usd / hi) * 100 : 0;
    return '<aside class="detail" aria-label="Protocol detail">' +
      '<button class="close" id="close" aria-label="Close detail">×</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="sub">' + esc(r.slug) + ' · rank #' + r.rank + ' of ' + rows.length + '</div>' +
      '<div class="badges">' +
      (r.watchlist ? '<span class="badge watch">★ Watchlist</span>' : '<span class="badge">Early find</span>') +
      '<span class="badge pre">Pre-token</span>' +
      (r.category ? '<span class="badge">' + esc(r.category) + '</span>' : '') + '</div>' +
      '<div class="biglabel">Implied launch value</div>' +
      '<div class="bigvalue">' + fmtUsd(r.implied_value_usd) + '</div>' +
      '<div class="rangebar"><div class="track"><div class="seg" style="left:' + segL.toFixed(1) + '%;width:' + Math.max(1.5, 100 - segL).toFixed(1) + '%"></div>' +
      '<div class="dot" style="left:' + dotL.toFixed(1) + '%"></div></div>' +
      '<div class="ends"><span>range ' + fmtUsd(lo) + '</span><span>' + fmtUsd(hi) + '</span></div></div>' +
      '<h3>How the value is built</h3>' +
      '<dl class="kv">' +
      '<dt>TVL (snapshot)</dt><dd>' + fmtUsd(r.tvl_usd) + '</dd>' +
      '<dt>Category multiple</dt><dd>' + fmtMult(md.multiple) + '</dd>' +
      '<dt>Comps behind it</dt><dd>' + md.comps + (md.comps === 1 ? ' live token' : ' live tokens') + '</dd>' +
      '<dt>Momentum (7d ' + fmtPct(r.change_7d) + ')</dt><dd>' + fmtX(md.momentum_multiplier) + '</dd>' +
      '<dt>Maturity (' + fmtAge(r.age_days) + ')</dt><dd>' + fmtX(md.maturity_multiplier) + '</dd>' +
      '<dt>Breadth (' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + ')</dt><dd>' + fmtX(md.breadth_multiplier) + '</dd>' +
      '<dt>Implied value</dt><dd>' + fmtUsd(r.implied_value_usd) + '</dd>' +
      '</dl>' +
      '<h3>Snapshot record</h3>' +
      '<dl class="kv">' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || 'none named') + '</dd>' +
      '<dt>Tracked since</dt><dd>' + esc(r.listed_at || 'not reported') + '</dd>' +
      '<dt>Token</dt><dd>none recorded</dd>' +
      '</dl>' +
      '<h3>Farm plan</h3>' +
      '<ol class="farm">' + r.farm_steps.map(stepHtml).join('') + '</ol>' +
      '</aside>';
  }

  function boardHtml() {
    var list = sorted(filtered());
    var detail = state.selected && bySlug[state.selected] ? detailHtml(bySlug[state.selected]) : '';
    return statsHtml() + tabsHtml() + controlsHtml() +
      '<div class="layout' + (detail ? ' with-detail' : '') + '">' + tableHtml(list) + detail + '</div>';
  }

  // ---------- live view ----------
  function liveHtml() {
    var g = DATA.global_multiple;
    var liveBody = DATA.live.map(function (r) {
      return '<tr><td><span class="pname">' + esc(r.name) + '</span> <span class="pslug">' + esc(r.symbol || '') + '</span></td>' +
        '<td>' + (r.category ? '<span class="catchip">' + esc(r.category) + '</span>' : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num mult">' + fmtMult(r.multiple) + '</td></tr>';
    }).join('');
    var multBody = DATA.multiples.map(function (m) {
      return '<tr><td>' + esc(m.category) + '</td><td class="num">' + m.comps + '</td>' +
        '<td class="num mult">' + fmtMult(m.median) + '</td><td class="num">' + fmtMult(m.p25) + '</td><td class="num">' + fmtMult(m.p75) + '</td>' +
        '<td class="num mult">' + fmtMult(m.used) + '</td><td class="num">' + fmtMult(m.used_low) + ' – ' + fmtMult(m.used_high) + '</td></tr>';
    }).join('');
    return statsHtml() + tabsHtml() +
      '<section class="panel"><h2>Already launched — the market the prices come from</h2>' +
      '<p>These protocols\' tokens already trade, so the board never ranks them: it learns from them. Each one\'s <strong>market cap ÷ TVL</strong> is a price the market pays for a dollar of TVL in that category. Across all <strong>' + g.comps + ' comparable live protocols</strong> the median multiple is <strong>' + fmtMult(g.median) + '</strong> (25th–75th percentile ' + fmtMult(g.p25) + ' – ' + fmtMult(g.p75) + '). The board\'s top live tokens by market cap:</p>' +
      '<div class="tablewrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Multiple</th></tr></thead><tbody>' + liveBody + '</tbody></table></div></section>' +
      '<section class="panel"><h2>Category multiples used by the model</h2>' +
      '<p>Each category\'s median is shrunk toward the global median by its sample size — <strong>used = (n × median + ' + DATA.model.shrinkage_k + ' × global) / (n + ' + DATA.model.shrinkage_k + ')</strong> — so a category priced by a handful of tokens cannot swing the board, and each ratio is winsorized at the market-wide 90th percentile (' + fmtMult(DATA.model.ratio_cap) + ') before any of this, so one frothy token cannot price a category alone. The used range prices each row\'s low and high.</p>' +
      '<div class="tablewrap"><table><thead><tr><th>Category</th><th class="num">Comps</th><th class="num">Median</th><th class="num">P25</th><th class="num">P75</th><th class="num">Used</th><th class="num">Used range</th></tr></thead><tbody>' + multBody + '</tbody></table></div></section>';
  }

  // ---------- method view ----------
  function methodHtml() {
    var m = DATA.model, s = DATA.stats, g = DATA.global_multiple;
    return statsHtml() + tabsHtml() +
      '<section class="panel"><h2>The model, stated whole</h2>' +
      '<p>One function prices every row. No protocol name is special-cased, and nothing outside the sealed snapshot is read. Model version <strong>' + esc(DATA.model_version) + '</strong>.</p>' +
      '<ul class="method">' +
      '<li><strong>Coverage.</strong> All ' + s.watchlist_rows + ' watchlist protocols are ranked, always. Below the $50M floor the radar adds ' + s.early_rows + ' more pre-token protocols — every one that is an independent launch candidate: not a versioned deployment of another protocol, not an exchange\'s own product, and not a wrapped, staked or bridged claim on an asset that already trades.</li>' +
      '<li><strong>Base price.</strong> A protocol\'s TVL is multiplied by its category\'s market-cap-to-TVL multiple, taken from the ' + g.comps + ' live protocols in the same snapshot whose token trades (global median ' + fmtMult(g.median) + '). Each comp\'s ratio is first winsorized at the market-wide 90th percentile, ' + fmtMult(m.ratio_cap) + ', so one frothy token cannot price a whole category; the category median is then shrunk toward the global median with <code>used = (n × median + ' + m.shrinkage_k + ' × global) / (n + ' + m.shrinkage_k + ')</code>. The category\'s shrunk 25th and 75th percentiles give the row\'s range.</li>' +
      '<li><strong>Momentum.</strong> The seven-day TVL change, clamped to ' + m.momentum_floor_pct + '%…+' + m.momentum_cap_pct + '%, moves the price by <code>1 + ' + m.momentum_strength + ' × g / (|g| + ' + m.momentum_scale + ')</code> — a saturating curve, so one hot week cannot rule a ranking.</li>' +
      '<li><strong>Maturity.</strong> Years running with no token move the price by <code>' + m.maturity_base + ' + ' + m.maturity_gain + ' × (1 − exp(−years / ' + m.maturity_tau_years + '))</code>: a longer record prices higher, with diminishing returns. An unreported listing date counts as the board\'s median known age, ' + m.imputed_age_days + ' days.</li>' +
      '<li><strong>Breadth.</strong> Each chain past the first adds ' + (m.breadth_per_chain * 100) + '% up to +' + Math.round(m.breadth_per_chain * m.breadth_max_extra * 100) + '%: reach is worth something, not everything.</li>' +
      '<li><strong>Farm plans.</strong> Each row\'s six steps come from its own record: a playbook for its category, a gas class for its first chain, a capital ticket sized to its TVL, and a hold window from its age. Every step states what it costs and how long it takes.</li>' +
      '<li><strong>Limits.</strong> The snapshot is one day\'s record (' + esc(DATA.as_of) + '); TVL is not revenue, and a multiple is not a promise. The board says what a launch would be worth if the record stayed as it is — never that a token will come.</li>' +
      '</ul></section>';
  }

  // ---------- render + events ----------
  function syncUrl() {
    try {
      var p = new URLSearchParams();
      if (state.tab !== 'board') p.set('tab', state.tab);
      if (state.q) p.set('q', state.q);
      if (state.category !== 'all') p.set('cat', state.category);
      if (state.chain !== 'all') p.set('chain', state.chain);
      if (state.watch) p.set('watch', '1');
      if (state.sort !== 'rank') { p.set('sort', state.sort); p.set('dir', state.dir === 1 ? 'asc' : 'desc'); }
      if (state.selected) p.set('detail', state.selected);
      history.replaceState(null, '', p.toString() ? '?' + p.toString() : window.location.pathname);
    } catch (e) { /* file URLs in some browsers: state still works, the URL just stays put */ }
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = state.tab === 'live' ? liveHtml() : state.tab === 'method' ? methodHtml() : boardHtml();
    var count = document.getElementById('count');
    if (count) count.textContent = filtered().length + ' of ' + rows.length + ' protocols';
    syncUrl();
  }

  app.addEventListener('click', function (ev) {
    var t = ev.target;
    var tab = t.closest ? t.closest('[data-tab]') : null;
    if (tab) { state.tab = tab.getAttribute('data-tab'); render(); return; }
    if (t.id === 'watch') { state.watch = !state.watch; render(); return; }
    if (t.id === 'close') { state.selected = null; render(); return; }
    var thEl = t.closest ? t.closest('th[data-sort]') : null;
    if (thEl) {
      var key = thEl.getAttribute('data-sort');
      if (state.sort === key && key !== 'rank') state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      render(); return;
    }
    var tr = t.closest ? t.closest('tr[data-slug]') : null;
    if (tr) { state.selected = tr.getAttribute('data-slug'); render(); }
  });
  app.addEventListener('input', function (ev) {
    if (ev.target.id === 'q') { state.q = ev.target.value; render(); var q = document.getElementById('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  });
  app.addEventListener('change', function (ev) {
    if (ev.target.id === 'cat') { state.category = ev.target.value; render(); }
    if (ev.target.id === 'chain') { state.chain = ev.target.value; render(); }
    if (ev.target.id === 'sort') { state.sort = ev.target.value; state.dir = state.sort === 'rank' ? 1 : -1; render(); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && state.selected) { state.selected = null; render(); }
  });

  render();
})();
