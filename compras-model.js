(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ComprasModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  function week(date) {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return d.toISOString().slice(0, 10);
  }
  function price(value) {
    const s = String(value == null ? '' : value).trim().replace(/[$\s]/g, '');
    if (!s) return null;
    const normalized = /^\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
    const n = Number(normalized);
    return Number.isFinite(n) && n >= 0 ? round(n) : null;
  }
  function redact(text) {
    return String(text||'').replace(/\b(?:CLABE|tarjeta|cuenta)(?:\s+(?:n[úu]mero|terminaci[oó]n|terminada|de|cr[eé]dito|d[eé]bito|en))*\s*[:#-]?\s*(?:\d[ -]?){4,19}/gi,'[IDENTIFICADOR OCULTO]')
      .replace(/\b(?:\d[ -]?){13,19}\b/g,'[IDENTIFICADOR OCULTO]')
      .replace(/\bsaldo(?:\s+(?:disponible|actual|anterior|total|al corte))*\s*[:=]?\s*\$?\s*[\d,]+(?:\.\d{1,2})?/gi,'[SALDO OCULTO]');
  }
  function ordered(list) {
    return (list.items || []).filter(x => !x.del).map((x, i) => ({x, i}))
      .sort((a, b) => (a.x.o == null ? a.i : a.x.o) - (b.x.o == null ? b.i : b.x.o) || a.i - b.i).map(v => v.x);
  }
  function migrate(list, currentWeek) {
    list.items = list.items || [];
    list.items.forEach((x, i) => { if (x.o == null) x.o = i; if (x.q == null) x.q = ''; });
    list.archives = list.archives || {};
    list.hist = list.hist || [];
    list.week = list.week || currentWeek;
    return list;
  }
  function rollWeek(list, currentWeek, stamp) {
    migrate(list, currentWeek);
    if (list.week >= currentWeek) return false;
    list.archives[list.week] = {items:copy(list.items), t:stamp};
    list.items = ordered(list).map(x => ({...x, p:null, ok:false, t:stamp}));
    list.week = currentWeek; list.tm = stamp;
    return true;
  }
  function move(list, id, delta, stamp) {
    const items = ordered(list), i = items.findIndex(x => x.id === id), next = i + delta;
    if (i < 0 || next < 0 || next >= items.length) return false;
    [items[i], items[next]] = [items[next], items[i]];
    items.forEach((x, index) => { x.o = index; x.t = stamp; });
    return true;
  }
  function selection(list) {
    const items = ordered(list).filter(x => x.ok);
    const invalid = items.filter(x => !String(x.n || '').trim() || !Number.isFinite(x.p) || x.p <= 0);
    return {items, invalid, total:round(items.reduce((s, x) => s + (Number.isFinite(x.p) && x.p > 0 ? x.p : 0), 0))};
  }
  function receipt(list, id, date) {
    const s = selection(list);
    if (!s.items.length || s.invalid.length) throw new Error('Escribe un precio válido para cada producto seleccionado.');
    return {id, w:list.week, f:date, total:s.total, state:'pendiente', t:Date.now(),
      items:s.items.map(x => ({id:x.id,n:x.n,q:x.q || '',p:x.p,o:x.o}))};
  }
  function record(list, entry, stamp) {
    if (list.hist.some(x => x.id === entry.id)) return;
    list.hist.push(copy(entry));
    const ids = new Set(entry.items.map(x => x.id));
    list.items.forEach(x => { if (ids.has(x.id)) { x.ok = false; x.t = stamp; } });
  }
  function removeList(list,stamp) { list.del=true;list.deletedAt=stamp;list.tm=stamp; }
  function restoreList(list,stamp) { list.del=false;list.restoredAt=stamp;list.tm=stamp; }
  function merge(a, b) {
    const meta = a.week && b.week && a.week !== b.week ? (a.week > b.week ? a : b) : ((a.tm || 0) >= (b.tm || 0) ? a : b);
    // An old server does not know week/q/o/history. Its response must not erase them.
    const sameWeek = !b.week || !a.week || a.week === b.week;
    const active = sameWeek ? [a, b] : [meta];
    const items = new Map();
    active.forEach(l => (l.items || []).forEach(x => {
      const old = items.get(x.id);
      if (!old) items.set(x.id, {...x});
      else if ((x.t || 0) > (old.t || 0)) items.set(x.id, {...old, ...x});
      else items.set(x.id, {...x, ...old});
    }));
    const hist = new Map();
    [...(a.hist || []), ...(b.hist || [])].forEach(x => { const o = hist.get(x.id); if (!o || (x.t || 0) > (o.t || 0)) hist.set(x.id, copy(x)); });
    const archives = {...(a.archives || {})};
    Object.entries(b.archives || {}).forEach(([w, x]) => { if (!archives[w] || x.t > archives[w].t) archives[w] = copy(x); });
    // Preserve the losing week's data when two devices cross a week boundary.
    [a,b].forEach(l => { if (l.week && meta.week && l.week < meta.week && !archives[l.week]) archives[l.week] = {items:copy(l.items || []),t:l.tm || 0}; });
    const deletedAt=Math.max(a.deletedAt||(a.del?a.tm||0:0),b.deletedAt||(b.del?b.tm||0:0));
    const restoredAt=Math.max(a.restoredAt||0,b.restoredAt||0);
    return {...a,...b,...meta,del:deletedAt>restoredAt,deletedAt,restoredAt,week:meta.week || a.week || b.week,items:[...items.values()],hist:[...hist.values()],archives};
  }
  function mergeInto(a,b) {
    const result=merge(a,b), existing=new Map((a.items||[]).map(x=>[x.id,x]));
    result.items=result.items.map(x=>{const old=existing.get(x.id);return old?Object.assign(old,x):x;});
    return Object.assign(a,result);
  }
  return {copy,round,week,price,redact,ordered,migrate,rollWeek,move,selection,receipt,record,removeList,restoreList,merge,mergeInto};
});
