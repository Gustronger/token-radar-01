// Token Radar dashboard, radar-4. Reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, filters, and a per-protocol detail
// drawer with the model's inputs, live comparables and farm plan. No network.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, liveSort: 'mcap', liveDir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }
  function rawR(r) { return r.mcap_usd && r.tvl_usd ? r.mcap_usd / r.tvl_usd : null; }
  function winR(r) {
    if (r === null || r === undefined || !isFinite(r)) return null;
    return Math.min(DATA.model.ratio_cap, Math.max(DATA.model.ratio_floor, r));
  }
  function median(s) {
    var n = s.length;
    if (n === 0) return null;
    var m = Math.floor(n / 2);
    return n % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // A row's multiple is the overall median, not a category calibration, when
  // n = 0; n >= 3 never is; n = 1-2 only while it still equals the overall.
  function isFallback(row) {
    var m = DATA.multiples ? DATA.multiples[row.category || ''] : undefined;
    if (typeof row.multiple_n === 'number') {
      if (row.multiple_n === 0) return true;
      if (row.multiple_n >= 3) return false;
      return m === undefined || m === DATA.overall_multiple;
    }
    return m === undefined || m === DATA.overall_multiple;
  }
  function flagLabel(flag) {
    if (!flag) return '';
    if (flag.kind === 'token-trades') return 'token already trades';
    return flag.kind || 'record check';
  }
  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = Math.min(model.chain_cap, 1 + model.chain_step * Math.min(Math.max((row.chains || []).length, 1) - 1, 5));
    var multiple = row.category_multiple === undefined ? DATA.overall_multiple : row.category_multiple;
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity * chains));
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Farm plan: the same derivation main.ts writes to board.json — category,
  // chains, TVL and age decide the action, capital, hold and every cost.
  // Must match lib/model.ts step for step. $CH = chain, $C = $capital, $N = name.
  var ACT = [
    ['cdp', 'Deposit $C of collateral through $N on $CH, mint the stablecoin it issues against that collateral, and hold the minted coins.'],
    ['lend', 'Supply $C of USDC to $N on $CH, borrow a small amount against it, and keep both legs open.'],
    ['collateral', 'Deposit $C of collateral assets through $N on $CH to secure the networks it covers, and keep the deposit staked.'],
    ['restak|staking', "Stake $C of the chain's staking asset through $N and keep the receipt token in your wallet."],
    ['perpetual|derivative', 'Deposit $C of USDC as margin on $N, open one small hedged position, and close it the same week.'],
    ['prediction', 'Fund $C on $N and place one small market position on an outcome you have read.'],
    ['curator|allocator|risk', 'Deposit $C into a $N vault on $CH and hold the vault shares.'],
    ['stable', 'Mint or deposit $C of the stable asset through $N on $CH and hold it.'],
    ['rwa', "Mint $C of the protocol's yield asset on $CH and hold it for the full term."],
    ['insurance', 'Buy $C of cover from $N on $CH and keep the policy until it lapses.'],
    ['basis|yield aggregator', "Deposit $C into $N's main strategy on $CH and leave it running."],
    ['index', 'Buy $C of the $N index token on $CH and hold it through one rebalance.'],
    ['dex|yield|leveraged farm', "Provide $C of liquidity to $N's main pool on $CH and keep the position open through a full fee cycle."],
    ['liquidity manager', 'Deposit $C of USDC into a $N managed liquidity position on $CH and keep it open through a full fee cycle.'],
    ['bridge', 'Bridge $C of USDC to $CH through $N, then use the bridged funds in an app on that chain.'],
    ['=chain', "Bridge $C of USDC to the $N chain and use it in one of the chain's own apps, keeping the position open."],
    ['payment', 'Open a payment channel through $N on $CH with $C of capacity and keep it open for routing.'],
    ['otc', 'Place $C into an OTC listing through $N on $CH and keep the listing open until it fills.'],
    ['card', "Load $C onto a $N card on $CH and spend it through the card's own app."],
    ['governance|incentive', 'Deposit $C into $N on $CH and vote with the position in the next governance round.'],
    ['=farm', "Deposit $C of USDC into $N's farm on $CH and keep the position open through a full reward cycle."],
    ['cedefi', "Deposit $C of USDC into $N's vault on $CH and hold the vault shares."],
    ['anchor|btc', 'Deposit $C of BTC through $N on $CH and hold the receipt it issues.']
  ];
  function action(p, cap, ch) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < ACT.length; i++) {
      var k = ACT[i][0], hit = false;
      if (k.charAt(0) === '=') hit = c === k.slice(1);
      else { var parts = k.split('|'); for (var j = 0; j < parts.length; j++) if (c.indexOf(parts[j]) >= 0) { hit = true; break; } }
      if (hit) return ACT[i][1].split('$CH').join(ch).split('$C').join('$' + cap).split('$N').join(p.name);
    }
    return 'Deposit $' + cap + ' of USDC into ' + p.name + ' on ' + ch + ' and keep the position open.';
  }
  // Steps 3-5 by plan kind: [weekly, hold, hold-cost code, hold-time code, check].
  // HOLD in a hold text is the hold in days. Costs/times shared by every kind
  // are built once in planParts below.
  var PLANS = {
    perps: ['Check funding rates and the hedge once a week, rebalance it only if it has drifted, and record each fill.', 'Close the hedged position within the same week and record the realised funding and price difference; do not hold a leveraged position for 30 days.', 'margin', 'week', "Before you close out, check the funding owed and the final margin on the protocol's own site, and withdraw only through the link it publishes."],
    prediction: ['Check open markets once a week, add a small position only to a market whose rules you have read, and record each entry.', 'Hold each market position until the market resolves, then record the outcome; do not exit early on price moves alone.', 'res', 'res', "Before a market resolves, check its resolution rules on the protocol's own site so you know what counts as a win."],
    rwa: ["Check the asset's accrual and maturity date once a week and record the balance; no weekly trade is needed.", 'Hold the asset until its term or maturity date, then redeem it through the protocol and record the redemption.', 'mat', 'mat', "Before redemption, check the maturity date and any redemption fee on the protocol's own site, and redeem only through the link it publishes."],
    staking: ['Check staking rewards once a week and record them; leave the stake and its receipt token untouched.', "Keep the stake locked through the protocol's unbonding period and record each reward payout; do not unstake early.", 'stake', 'unbond', "Before you unstake, check the unbonding period and the reward schedule on the protocol's own site."],
    curator: ["Check the vault's share price and allocation once a week and record it; do not chase vaults week to week.", 'Hold the position for at least HOLD days so the activity is counted in more than one snapshot.', 'vault', 'hold', "Before you withdraw, check the vault's share price and withdrawal queue on the protocol's own site, and withdraw only through the link it publishes."],
    cdp: ['Check the collateral ratio once a week and top it up if it has slipped toward liquidation; record the ratio.', 'Keep the minted stablecoin position open for at least HOLD days, keeping the collateral ratio above the liquidation line.', 'collat', 'hold', "Before you repay, check the collateral ratio and any mint fee on the protocol's own site, and repay only through the link it publishes."],
    stable: ["Check the stable asset's peg once a week and record the balance; no weekly trade is needed.", 'Hold the position for at least HOLD days so the activity is counted in more than one snapshot.', 'pos', 'hold', "Before you redeem, check the redemption route and any fee on the protocol's own site, and redeem only through the link it publishes."],
    lending: ['Check borrow rates and the health factor once a week, and rebalance only if the health factor has slipped; keep the receipts.', 'Hold the position for at least HOLD days so the activity is counted in more than one snapshot.', 'pos', 'hold', "Before you withdraw, check the borrow balance and the health factor on the protocol's own site, and repay first if anything is still borrowed."],
    insurance: ['Check the cover status once a week and record it; no weekly action is needed while the policy runs.', 'Keep the policy until it lapses or the cover period ends, then record the outcome.', 'cover', 'lapse', "Before the policy lapses, check the claim terms on the protocol's own site so you know what is covered."],
    bridge: ['Check the bridged funds once a week and record where they are working on the destination chain.', 'Keep the bridged funds working on the destination chain for at least HOLD days.', 'pos', 'hold', "Before you bridge back, check the return route and fee on the protocol's own site, and bridge only through the link it publishes."],
    liquidity: ["Check the fees earned once a week and record them; add liquidity only if the pool is still the protocol's main one.", 'Hold the position for at least HOLD days so the activity is counted in more than one snapshot.', 'pos', 'hold', "Before you withdraw, check the position and any earned fees on the protocol's own site, and withdraw only through the link it publishes."],
    generic: ['Make one qualifying action each week, such as a deposit or a swap, and keep the receipts.', 'Hold the position for at least HOLD days so the activity is counted in more than one snapshot.', 'pos', 'hold', "Before you withdraw, check the position and any withdrawal queue on the protocol's own site, and withdraw only through the link it publishes."]
  };
  function planKind(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'perps';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('lend') >= 0) return 'lending';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0 || c.indexOf('collateral') >= 0) return 'staking';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'curator';
    if (c.indexOf('cdp') >= 0) return 'cdp';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('index') >= 0) return 'generic';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('basis') >= 0) return 'liquidity';
    return 'generic';
  }
  function planParts(kind, cap, hold, gasW) {
    var hc = { pos: 'the $' + cap + ' stays in the position', margin: 'the $' + cap + ' margin is released at close-out', res: 'the $' + cap + ' stays in the position until resolution', mat: 'the $' + cap + ' stays in the position until maturity', stake: 'the $' + cap + ' stays staked', vault: 'the $' + cap + ' stays in the vault', collat: 'the $' + cap + ' of collateral stays locked', cover: 'the $' + cap + ' stays in cover' };
    var ht = { hold: hold + ' days', week: 'within the week', res: 'until the market resolves', mat: 'until maturity', unbond: 'through the unbonding period', lapse: 'until the policy lapses' };
    var p = PLANS[kind] || PLANS.generic;
    return {
      weekly: { text: p[0], cost: 'about ' + gasW + ' of gas a week', time: '10 minutes a week' },
      holdStep: { text: p[1].split('HOLD').join(String(hold)), cost: hc[p[2]], time: ht[p[3]] },
      check: { text: p[4], cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    };
  }
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    if (chain === 'Ethereum') return { setup: '$5', weekly: '$3' };
    if (chain === 'Tron') return { setup: '$2', weekly: '$1' };
    if (chain === 'Bitcoin') return { setup: '$2', weekly: '$1' };
    if (chain === 'Solana') return { setup: '$0.01', weekly: '$0.01' };
    if (chain === 'Binance') return { setup: '$0.30', weekly: '$0.20' };
    return { setup: '$0.10', weekly: '$0.10' };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farm(p) {
    var chain = chainOf(p);
    var cap = capFor(p);
    var hold = holdFor(p.age_days);
    var gas = gasFor(chain);
    var plan = planParts(planKind(p), cap, hold, gas.weekly);
    var multi = p.chains && p.chains.length > 1
      ? ' Repeat the deposit on a second chain ' + p.name + ' supports, ' + p.chains[1] + ', so the activity is visible there too.'
      : '';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: action(p, cap, chain) + multi, cost: '$' + cap + ' of capital and about ' + gas.setup + ' of gas', time: '15 minutes to set up' },
      plan.weekly,
      plan.holdStep,
      plan.check,
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.scope === 'watchlist' && !r.watchlist) return false;
      if (state.scope === 'early' && r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: state.category !== 'all' ? state.category + ' protocols, ranked by implied value' : DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar ranks every other pre-token protocol the snapshot can score — ' + DATA.early_size + ' more — so the board covers the whole pre-token universe, not just the floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows beyond the watchlist' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var scopeSelect = el('select', { id: 'scope', 'aria-label': 'Watchlist or early rows' },
      el('option', { value: 'all', text: 'Watchlist + early' }),
      el('option', { value: 'watchlist', text: 'Watchlist only', selected: state.scope === 'watchlist' ? 'selected' : null }),
      el('option', { value: 'early', text: 'Early radar only', selected: state.scope === 'early' ? 'selected' : null })
    );
    scopeSelect.addEventListener('change', function () { state.scope = scopeSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'scope', text: 'Board' }), scopeSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : liveRows().length + ' of ' + DATA.live.length + ' live-token protocols' })
    );
  }
  // Active-filter chips: the filtered state as a glanceable fact, not just
  // a select value. Each chip clears its own filter; Clear resets all.
  function chipRow() {
    var active = [];
    if (state.q) active.push({ label: 'Search: ' + state.q, clear: function () { state.q = ''; } });
    if (state.category !== 'all') active.push({ label: 'Category: ' + state.category, clear: function () { state.category = 'all'; } });
    if (state.chain !== 'all') active.push({ label: 'Chain: ' + state.chain, clear: function () { state.chain = 'all'; } });
    if (state.tab === 'pre-token' && state.scope !== 'all') active.push({ label: 'Board: ' + (state.scope === 'watchlist' ? 'Watchlist only' : 'Early radar only'), clear: function () { state.scope = 'all'; } });
    if (active.length === 0) return null;
    var total = state.tab === 'pre-token' ? DATA.board_size : DATA.live.length;
    var shown = state.tab === 'pre-token' ? rows().length : liveRows().length;
    var row = el('div', { class: 'chips' });
    active.forEach(function (c) {
      row.appendChild(el('button', { class: 'chip', type: 'button', text: c.label + ' \u00d7', onclick: function () { c.clear(); writeHash(); render(); } }));
    });
    row.appendChild(el('span', { class: 'chip-count', text: shown + ' of ' + total + ' rows' }));
    row.appendChild(el('button', { class: 'chip clear', type: 'button', text: 'Clear', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; writeHash(); render(); } }));
    return row;
  }
  function thSort(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = (key === 'rank' || key === 'name') ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    // Bars scale to the board's global max, not the visible list's, so a
    // protocol's bar is the same in every view and across screenshots.
    var max = DATA.rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var flag = r.record_flag;
      var tokenBadge = flag
        ? ' \u00b7 \u26a0 ' + flagLabel(flag) + ' \u2014 see detail'
        : ' \u00b7 no token on record';
      var fallback = isFallback(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + tokenBadge }),
          el('span', { class: r.watchlist ? 'tag wl' : 'tag', text: r.watchlist ? 'Watchlist' : 'Early' })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: fallback ? 'num mult-fallback' : 'num', text: fmtMult(r.category_multiple) + (fallback ? '*' : '') }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tbody.appendChild(tr);
    });
    var panel = el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, comparables and farm plan.' }),
          el('thead', null, el('tr', null,
            thSort('rank', 'Rank'),
            thSort('name', 'Protocol'),
            thSort('tvl', 'TVL'),
            thSort('growth', '7d'),
            thSort('age', 'Age'),
            thSort('multiple', 'Multiple'),
            thSort('implied', 'Implied value')
          )),
          tbody
        )
      )
    );
    if (list.some(isFallback)) {
      var footnote = DATA.rows.some(function (r) { return typeof r.multiple_n === 'number'; })
        ? '* overall median \u2014 no live comps in this category'
        : '* overall median \u2014 fewer than 3 live comps in this category';
      panel.appendChild(el('p', { class: 'sub footnote', text: footnote }));
    }
    return panel;
  }

  // The live tab shares the board's search/category/chain filters; the
  // watchlist/early scope does not apply here (live rows carry no scope).
  function liveRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.live.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedLive(list) {
    var key = state.liveSort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'ratio') {
        av = winR(rawR(a)); bv = winR(rawR(b));
        av = av === null ? -Infinity : av; bv = bv === null ? -Infinity : bv;
      }
      else { av = a.mcap_usd === null ? -Infinity : a.mcap_usd; bv = b.mcap_usd === null ? -Infinity : b.mcap_usd; }
      if (av < bv) return -state.liveDir;
      if (av > bv) return state.liveDir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function thLive(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.liveSort === key) state.liveDir = -state.liveDir; else { state.liveSort = key; state.liveDir = key === 'name' ? 1 : -1; } render(); } },
        label,
        state.liveSort === key ? el('span', { 'aria-hidden': 'true', text: state.liveDir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }
  function liveTable() {
    var list = sortedLive(liveRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No live-token protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the live set again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    var anyCapped = false;
    var anyFloored = false;
    list.forEach(function (r) {
      var raw = rawR(r);
      var w = winR(raw);
      var capped = raw !== null && raw > DATA.model.ratio_cap;
      var floored = raw !== null && raw < DATA.model.ratio_floor;
      if (capped) anyCapped = true;
      if (floored) anyFloored = true;
      tbody.appendChild(el('tr', { 'data-static': 'true' },
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + ' \u00b7 already trades' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: w === null ? 'n/a' : fmtMult(w) + ((capped || floored) ? '*' : '') })
      ));
    });
    // 119: the snapshot's live-token protocols feeding the multiples (144
    // with a market cap, minus 16 non-positive, minus 9 CEX), verified
    // against the snapshot; data.js carries no live total.
    var panel = el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'The ' + DATA.live.length + ' largest live-token protocols; the multiples use all 119. Market caps are facts, not a model — these protocols already trade, so they are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            thLive('name', 'Protocol'),
            thLive('tvl', 'TVL'),
            thLive('growth', '7d'),
            thLive('mcap', 'Market cap'),
            thLive('ratio', 'Mcap / TVL')
          )),
          tbody
        )
      )
    );
    if (anyCapped || anyFloored) {
      var note = '* ratios above ' + DATA.model.ratio_cap.toFixed(1) + 'x are capped at ' + DATA.model.ratio_cap.toFixed(1) + 'x before use';
      if (anyFloored) note += '; ratios below ' + DATA.model.ratio_floor + 'x are floored at ' + DATA.model.ratio_floor + 'x';
      panel.appendChild(el('p', { class: 'sub footnote', text: note }));
    }
    return panel;
  }

  function multTable() {
    var entries = Object.keys(DATA.multiples || {}).map(function (k) { return [k, DATA.multiples[k]]; });
    entries.sort(function (a, b) { return b[1] - a[1]; });
    var fallbackCount = entries.filter(function (e) { return e[1] === DATA.overall_multiple; }).length;
    // Board categories with no live comps never reach the multiples table;
    // they take the overall median too, so they join the collapsed row.
    var noCompCount = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).filter(function (c) { return !(c in (DATA.multiples || {})); }).length;
    var tbody = el('tbody');
    entries.filter(function (e) { return e[1] !== DATA.overall_multiple; }).forEach(function (e) {
      var cal = DATA.liveByCategory && DATA.liveByCategory[e[0]];
      var noteText = (cal && !Array.isArray(cal) && typeof cal.n === 'number') ? 'n=' + cal.n + ' live comp' + (cal.n === 1 ? '' : 's') : '';
      tbody.appendChild(el('tr', { 'data-static': 'true' },
        el('td', null, el('b', { text: e[0] })),
        el('td', { class: 'num', text: fmtMult(e[1]) }),
        el('td', { class: 'num', text: noteText })
      ));
    });
    var collapsed = fallbackCount + noCompCount;
    if (collapsed > 0) {
      tbody.appendChild(el('tr', { 'data-static': 'true' },
        el('td', null, el('b', { text: collapsed + ' categories take the overall median ' + fmtMult(DATA.overall_multiple) + (fallbackCount > 0 ? ' (fewer than 3 live comps)' : ' (no live comps)') })),
        el('td', { class: 'num', text: fmtMult(DATA.overall_multiple) }),
        el('td', { class: 'num', text: fallbackCount > 0 ? 'overall median \u2014 ' + fallbackCount + ' with 1\u20132 live comps, ' + noCompCount + ' with none' : 'overall median \u2014 no live comps' })
      ));
    }
    var graded = DATA.rows.some(function (r) { return typeof r.multiple_n === 'number'; });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Category multiples: each is the median market-cap / TVL of the live-token protocols in that category, winsorized and shrunk toward the overall median.' + (graded ? ' Categories with no live comps take the overall median.' : ' Categories with fewer than 3 live comps take the overall median.') }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Note' }))),
          tbody
        )
      )
    );
  }
  function modelPanel() {
    var m = DATA.model;
    var graded = DATA.rows.some(function (r) { return typeof r.multiple_n === 'number'; });
    var multipleRule = graded
      ? 'shrunk toward the overall median of ' + DATA.overall_multiple + 'x with a prior of ' + m.shrink_prior + ' at every comp count: multiple = (n \u00d7 median + ' + m.shrink_prior + ' \u00d7 overall) / (n + ' + m.shrink_prior + '); a category with no live comps at all takes the overall median.'
      : 'shrunk toward the overall median of ' + DATA.overall_multiple + 'x; a category with fewer than ' + m.min_category_comps + ' live comps takes the overall median.';
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, 5)) )'
      ),
      el('p', { class: 'sub', text: 'The category multiple is the median market-cap / TVL of the live-token protocols in that category, winsorized to [' + m.ratio_floor + ', ' + m.ratio_cap + '] and ' + multipleRule + ' Age is the time since the protocol was first listed, the best record of how long it has run with no token on record; an unlisted age uses ' + m.unknown_age_days + ' days. Bridges, exchange products and wrapped or staked receipts are not ranked: their token already exists by construction.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  // The calibration set behind a row's multiple. With liveByCategory (per
  // category: n, medians, multiple, comps capped at 5 by market cap) the
  // drawer shows that real set. Without it, the page only ships the 24
  // largest live-token protocols, so the drawer says so and never claims
  // their median is the row's multiple.
  function comparables(row) {
    var fallback = isFallback(row);
    var n = typeof row.multiple_n === 'number' ? row.multiple_n : null;
    var note = typeof row.multiple_note === 'string' && row.multiple_note ? row.multiple_note : null;
    var cat = DATA.liveByCategory && DATA.liveByCategory[row.category || ''];
    var comps = null;
    var catN = null;
    var catMedian = null;
    if (cat) {
      if (Array.isArray(cat)) {
        comps = cat.map(function (r) {
          return { name: r.name, mcap_usd: r.mcap_usd, tvl_usd: r.tvl_usd, ratio_w: r.ratio_winsorized, ratio_raw: r.ratio_raw };
        });
        catN = n;
      } else {
        comps = (cat.comps || []).map(function (r) {
          return { name: r.name, mcap_usd: r.mcap_usd, tvl_usd: r.tvl_usd, ratio_w: r.ratio_winsorized, ratio_raw: r.ratio_raw };
        });
        catN = typeof cat.n === 'number' ? cat.n : n;
        catMedian = typeof cat.median_winsorized === 'number' ? cat.median_winsorized : null;
      }
    }
    if (comps === null) {
      comps = DATA.live.filter(function (r) { return r.category === row.category; }).map(function (r) {
        var raw = rawR(r);
        return { name: r.name, mcap_usd: r.mcap_usd, tvl_usd: r.tvl_usd, ratio_w: winR(raw), ratio_raw: raw };
      });
    }
    var med = catMedian;
    if (med === null && catN !== null && comps.length >= catN && comps.length > 0) {
      med = median(comps.map(function (c) { return c.ratio_w; }).sort(function (a, b) { return a - b; }));
    }
    var items = comps.map(function (c) {
      var ratioText = c.ratio_w === null || c.ratio_w === undefined ? 'n/a' : fmtMult(c.ratio_w);
      var capped = c.ratio_raw !== null && c.ratio_raw !== undefined && c.ratio_w !== null && c.ratio_w !== undefined && c.ratio_raw !== c.ratio_w;
      return el('li', null,
        el('b', { text: c.name + ' ' }),
        el('span', { text: 'mcap ' + fmtUsd(c.mcap_usd) + ' on TVL ' + fmtUsd(c.tvl_usd) + ' = ' + ratioText + (capped ? ' (raw ' + fmtMult(c.ratio_raw) + ', capped)' : '') })
      );
    });
    var basis;
    if (note) {
      basis = note + '.';
    } else if (fallback) {
      basis = 'This row takes the overall median ' + fmtMult(DATA.overall_multiple) + ' \u2014 fewer than 3 live comps in this category.';
    } else if (n !== null && med !== null) {
      basis = 'n=' + n + ' comps, median ' + fmtMult(med) + ', shrunk to ' + fmtMult(row.category_multiple) + '.';
    } else if (n !== null) {
      basis = 'n=' + n + ' live comps in this category; their median, shrunk toward the overall median, sets this row\u2019s multiple of ' + fmtMult(row.category_multiple) + '.';
    } else {
      basis = 'This row\u2019s multiple is ' + fmtMult(row.category_multiple) + ' \u2014 the category median of all live comps, winsorized and shrunk toward the overall median.';
    }
    var scope;
    if (n === 0) {
      scope = 'No live-token protocol in this category, so there is no calibration set behind this row.';
    } else if (cat) {
      scope = (catN !== null && comps.length < catN)
        ? 'The ' + comps.length + ' largest of ' + catN + ' live-token protocols in this category, by market cap, with their winsorized ratios.'
        : 'Live-token protocols in this category, with their winsorized market-cap / TVL.';
    } else {
      scope = comps.length === 0
        ? 'No live-token protocol in this category is among the ' + DATA.live.length + ' largest by market cap on this page.'
        : 'The ' + comps.length + ' largest live-token protocol' + (comps.length === 1 ? '' : 's') + ' in this category by market cap. The multiple is built from every live comp in the category, not just these \u2014 their median is not this row\u2019s multiple.';
    }
    var wrap = el('div', null, el('p', { class: 'sub', text: scope + ' ' + basis }));
    if (items.length > 0) wrap.appendChild(el('ul', { class: 'peers' }, items));
    return wrap;
  }
  // The derivation beside the category multiple. It must agree with
  // comparables() below it; the row's own multiple_note states exactly
  // that, so it is used verbatim when data.js carries it.
  function multNote(row) {
    if (typeof row.multiple_note === 'string' && row.multiple_note) return row.multiple_note;
    var n = typeof row.multiple_n === 'number' ? row.multiple_n : null;
    if (isFallback(row)) {
      return n !== null ? 'n=' + n + ' comp' + (n === 1 ? '' : 's') + ' \u2014 overall median' : 'overall median \u2014 fewer than 3 live comps';
    }
    var byCat = DATA.liveByCategory && DATA.liveByCategory[row.category || ''];
    if (byCat && !Array.isArray(byCat) && typeof byCat.median_winsorized === 'number') {
      return 'n=' + n + ' comps, median ' + fmtMult(byCat.median_winsorized) + ', shrunk to ' + fmtMult(row.category_multiple);
    }
    var list = byCat ? (Array.isArray(byCat) ? byCat : (byCat.comps || [])) : null;
    if (n !== null && list && list.length >= n) {
      var med = median(list.map(function (r) { return r.ratio_winsorized; }).sort(function (a, b) { return a - b; }));
      if (med !== null) return 'n=' + n + ' comps, median ' + fmtMult(med) + ', shrunk to ' + fmtMult(row.category_multiple);
    }
    return 'category median, winsorized + shrunk';
  }
  function eq(label, value, deriv) {
    var left = el('div', null, el('span', { text: label }));
    if (deriv) left.appendChild(el('div', { class: 'eq-note', text: deriv }));
    return el('div', { class: 'eq-row' }, left, el('b', { class: 'num', text: value }));
  }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farm(row);
    var m = DATA.model;
    var chainText = row.chains && row.chains.length
      ? row.chains.slice(0, 2).join(', ') + (row.chains.length > 2 ? ' + ' + (row.chains.length - 2) + ' more' : '')
      : 'an unnamed chain';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' \u00b7 watchlist' : ' \u00b7 early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + chainText })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    if (row.record_flag) {
      var flagHead = flagLabel(row.record_flag);
      dialog.appendChild(el('div', { class: 'flag' },
        el('b', { text: '\u26a0 ' + flagHead.charAt(0).toUpperCase() + flagHead.slice(1) }),
        el('p', { text: row.record_flag.note || '' })
      ));
    }
    var growthRaw = row.change_7d;
    var growthUsed = Math.min(m.growth_cap, Math.max(m.growth_floor, growthRaw === null || growthRaw === undefined ? 0 : growthRaw));
    var growthDeriv = (growthRaw === null || growthRaw === undefined ? 'no 7d change on record \u2014 0% \u00d7 ' + m.growth_weight : fmtPct(growthUsed) + ' \u00d7 ' + m.growth_weight) + (growthRaw !== null && growthRaw !== undefined && growthUsed !== growthRaw ? ' (clamped from ' + fmtPct(growthRaw) + ')' : '');
    var ageUsed = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var ageCapped = Math.min(Math.max(ageUsed, 0), m.maturity_days);
    var maturityDeriv = ageCapped + 'd / ' + m.maturity_days + 'd' + (row.age_days === null || row.age_days === undefined ? ' (age unknown)' : ageUsed > m.maturity_days ? ' (capped)' : '');
    var nChains = Math.max((row.chains || []).length, 1);
    var chainExtra = Math.min(nChains - 1, 5);
    var chainDeriv = nChains === 1 ? '1 chain \u2192 1.00' : nChains + ' chains \u2192 ' + (nChains - 1 > 5 ? 'capped at ' + m.chain_cap : '1 + ' + m.chain_step + ' \u00d7 ' + chainExtra);
    var impliedDeriv = fmtUsd(row.tvl_usd) + ' \u00d7 ' + fmtMult(row.category_multiple) + ' \u00d7 ' + String(row.growth_multiplier) + ' \u00d7 ' + String(row.maturity_multiplier) + ' \u00d7 ' + String(row.chain_multiplier);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        eq('TVL', fmtUsd(row.tvl_usd)),
        eq('Category multiple', fmtMult(row.category_multiple), multNote(row)),
        eq('Seven-day growth', fmtPct(row.change_7d)),
        eq('Growth multiplier', String(row.growth_multiplier), growthDeriv),
        eq('Age with no token on record', fmtAge(row.age_days)),
        eq('Maturity multiplier', String(row.maturity_multiplier), maturityDeriv),
        eq('Chain multiplier', String(row.chain_multiplier), chainDeriv),
        eq('Implied value', fmtUsd(row.implied_value_usd), impliedDeriv)
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var actionText = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: actionText }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Live comparables' }),
      comparables(row)
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') {
      shell.appendChild(el('p', { class: 'strip', text: 'implied = TVL \u00d7 category multiple \u00d7 growth \u00d7 maturity \u00d7 chains \u2014 full formula below the board.' }));
    }
    shell.appendChild(controls());
    var chips = chipRow();
    if (chips) shell.appendChild(chips);
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(multTable());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
