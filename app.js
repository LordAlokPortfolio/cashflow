/* =========================================================
   Next Bill — Anchor-first + CSV Mapping + Local Profile
   - Quick Check: anchor cards (Rent, each CC/LOC due)
   - Statements: CSV upload + mapping wizard + normalize into IndexedDB
   - Insights: coverage/accuracy meter (honest gating)
   - Profile: export/import + reset device data
   ========================================================= */

const LS_PROFILE = "nextbill_profile_v2";

/* ---------- DOM helpers ---------- */
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const el = (id) => document.getElementById(id);

/* ---------- formatting ---------- */
function fmtMoney(x){
  const v = Number(x || 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseISO(s){ return s ? new Date(s + "T00:00:00") : null; }
function toISO(d){
  const z = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return z.toISOString().slice(0,10);
}
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function dim(y,m){ return new Date(y, m+1, 0).getDate(); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function nextDueByDay(today, dueDay){
  if (!dueDay || dueDay < 1) return null;
  const y = today.getFullYear(), m = today.getMonth();
  const thisM = new Date(y, m, Math.min(dueDay, dim(y,m)));
  if (today.getDate() <= dueDay) return thisM;
  const nm = new Date(y, m+1, 1);
  return new Date(nm.getFullYear(), nm.getMonth(), Math.min(dueDay, dim(nm.getFullYear(), nm.getMonth())));
}
function addMonths(d, k){
  const y = d.getFullYear(), m = d.getMonth();
  const day = d.getDate();
  const target = new Date(y, m + k, 1);
  return new Date(target.getFullYear(), target.getMonth(), Math.min(day, dim(target.getFullYear(), target.getMonth())));
}

/* =========================================================
   IndexedDB (statements)
   ========================================================= */
const DB_NAME = "nextbill_db_v1";
const DB_VER = 1;

function idbOpen(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("tx")){
        const os = db.createObjectStore("tx", { keyPath: "id" });
        os.createIndex("byDate", "date");
      }
      if (!db.objectStoreNames.contains("meta")){
        db.createObjectStore("meta", { keyPath: "k" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store, val){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(val);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(store, key){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function idbClear(store){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbCount(store){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}
async function idbGetCoverage(){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tx", "readonly");
    const os = tx.objectStore("tx");
    const idx = os.index("byDate");

    let first = null, last = null;

    // first
    const req1 = idx.openCursor();
    req1.onsuccess = () => {
      const cur = req1.result;
      if (cur){
        first = cur.value.date;
        cur.continue(); // keep going to find last
      } else {
        resolve({ start:first, end:last });
      }
    };
    req1.onerror = () => reject(req1.error);

    // last: we can’t reverse easily without IDBKeyRange; so we compute last in req1 loop:
    idx.openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (cur){
        last = cur.value.date;
        cur.continue();
      }
    };
  });
}

/* =========================================================
   Profile (local)
   ========================================================= */
function defaultProfile(){
  return {
    v: 2,
    createdAt: new Date().toISOString(),
    quick: {
      defaultHorizonDays: 90,
      defaultBufferFloor: 0,
      sameDayOrder: "expensesFirst" // or incomeFirst
    },
    rent: { amount: 0, dueDay: 28 },
    income: [
      // { id, label, lastPayDate, everyDays, amount }
    ],
    debts: [
      // { id, label, type:"cc"|"loc", dueDay, balance, apr, creditLimit }
    ],
    planned: [
      // { id, date, amount, label }
    ],
    csvMapping: null, // { headers, delimiter, dateCol, descCol, mode, amountCol, debitCol, creditCol, typeCol, debitTokens[], accountCol }
    coverage: { start:null, end:null, days:0, count:0, lastImportAt:null }
  };
}

function loadProfile(){
  const raw = localStorage.getItem(LS_PROFILE);
  if (!raw) return defaultProfile();
  try {
    const p = JSON.parse(raw);
    return migrateProfile(p);
  } catch {
    return defaultProfile();
  }
}
function saveProfile(p){
  localStorage.setItem(LS_PROFILE, JSON.stringify(p));
}
function migrateProfile(p){
  if (!p || typeof p !== "object") return defaultProfile();
  if (!p.v) p.v = 2;
  if (!p.quick) p.quick = { defaultHorizonDays:90, defaultBufferFloor:0, sameDayOrder:"expensesFirst" };
  if (!p.rent) p.rent = { amount:0, dueDay:28 };
  if (!Array.isArray(p.income)) p.income = [];
  if (!Array.isArray(p.debts)) p.debts = [];
  if (!Array.isArray(p.planned)) p.planned = [];
  if (!p.coverage) p.coverage = { start:null, end:null, days:0, count:0, lastImportAt:null };
  return p;
}
function uid(){ return crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2); }

/* =========================================================
   Tabs / Drawer / Theme
   ========================================================= */
function showTab(tab){
  qsa(".seg button").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  ["quick","statements","insights","profile"].forEach(t=>{
    const sec = el("tab-"+t);
    if (sec) sec.classList.toggle("hidden", t !== tab);
  });
}
function mountTabs(){
  qsa(".seg button").forEach(btn=>{
    btn.addEventListener("click", ()=> showTab(btn.dataset.tab));
  });
}
function mountDrawer(){
  const open = ()=>{ el("drawer").classList.remove("hidden"); el("backdrop").classList.remove("hidden"); };
  const close = ()=>{ el("drawer").classList.add("hidden"); el("backdrop").classList.add("hidden"); };
  el("btnSidebar").addEventListener("click", open);
  el("btnCloseDrawer").addEventListener("click", close);
  el("backdrop").addEventListener("click", close);
}
function mountTheme(){
  el("btnTheme").addEventListener("click", ()=>{
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = (cur === "dark") ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    const p = loadProfile();
    p.theme = next;
    saveProfile(p);
  });
}

/* =========================================================
   Quick Check UI render
   ========================================================= */
function renderQuick(p){
  document.documentElement.setAttribute("data-theme", p.theme || "dark");

  // defaults
  el("qcHorizonDays").value = p.quick.defaultHorizonDays;
  el("qcBufferFloor").value = p.quick.defaultBufferFloor;

  // rent
  el("rentAmount").value = p.rent.amount || 0;
  el("rentDueDay").value = p.rent.dueDay || 28;

  // note
  el("note").value = p.quick.note || "";

  // cash today (not stored as persistent default; last value only)
  el("qcCashToday").value = p.quick.lastCashToday ?? 0;

  // income list
  const incRoot = el("incomeList");
  incRoot.innerHTML = "";
  p.income.forEach(it=>{
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginTop = "10px";
    card.innerHTML = `
      <div class="section-title">
        <div class="h">${it.label || "Income"}</div>
        <button class="ios6-btn danger" data-delincome="${it.id}">Delete</button>
      </div>
      <div class="grid">
        <div class="field">
          <label>Label</label>
          <input data-income="${it.id}" data-k="label" type="text" value="${it.label || ""}">
        </div>
        <div class="field">
          <label>Last pay date</label>
          <input data-income="${it.id}" data-k="lastPayDate" type="date" value="${it.lastPayDate || ""}">
        </div>
        <div class="field">
          <label>Every (days)</label>
          <input data-income="${it.id}" data-k="everyDays" type="number" min="1" value="${it.everyDays || 14}">
        </div>
      </div>
      <div class="grid" style="margin-top:10px;">
        <div class="field">
          <label>Amount (per pay)</label>
          <input data-income="${it.id}" data-k="amount" type="number" step="0.01" value="${it.amount || 0}">
        </div>
        <div class="field">
          <label></label>
          <div class="note">Used to forecast anchors.</div>
        </div>
        <div class="field"></div>
      </div>
    `;
    incRoot.appendChild(card);
  });

  // debt list
  const dRoot = el("debtList");
  dRoot.innerHTML = "";
  p.debts.forEach(d=>{
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginTop = "10px";
    card.innerHTML = `
      <div class="section-title">
        <div class="h">${d.label || "Debt"}</div>
        <button class="ios6-btn danger" data-deldebt="${d.id}">Delete</button>
      </div>
      <div class="grid">
        <div class="field">
          <label>Label</label>
          <input data-debt="${d.id}" data-k="label" type="text" value="${d.label || ""}">
        </div>
        <div class="field">
          <label>Type</label>
          <select data-debt="${d.id}" data-k="type">
            <option value="cc" ${d.type==="cc"?"selected":""}>CC</option>
            <option value="loc" ${d.type==="loc"?"selected":""}>LOC</option>
          </select>
        </div>
        <div class="field">
          <label>Due day (1–31)</label>
          <input data-debt="${d.id}" data-k="dueDay" type="number" min="1" max="31" value="${d.dueDay || 1}">
        </div>
      </div>
      <div class="grid" style="margin-top:10px;">
        <div class="field">
          <label>Balance (statement)</label>
          <input data-debt="${d.id}" data-k="balance" type="number" step="0.01" value="${d.balance || 0}">
        </div>
        <div class="field">
          <label>APR % (LOC only)</label>
          <input data-debt="${d.id}" data-k="apr" type="number" step="0.01" value="${d.apr || 0}">
        </div>
        <div class="field">
          <label>Credit limit (LOC only)</label>
          <input data-debt="${d.id}" data-k="creditLimit" type="number" step="0.01" value="${d.creditLimit || 0}">
        </div>
      </div>
    `;
    dRoot.appendChild(card);
  });

  // planned list
  const pRoot = el("plannedList");
  pRoot.innerHTML = "";
  p.planned.sort((a,b)=>a.date.localeCompare(b.date)).forEach(x=>{
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginTop = "10px";
    card.innerHTML = `
      <div class="section-title">
        <div class="h">${x.label || "Planned"}</div>
        <button class="ios6-btn danger" data-delplanned="${x.id}">Delete</button>
      </div>
      <div class="grid">
        <div class="field">
          <label>Date</label>
          <input data-planned="${x.id}" data-k="date" type="date" value="${x.date || ""}">
        </div>
        <div class="field">
          <label>Amount</label>
          <input data-planned="${x.id}" data-k="amount" type="number" step="0.01" value="${x.amount || 0}">
        </div>
        <div class="field">
          <label>Label</label>
          <input data-planned="${x.id}" data-k="label" type="text" value="${x.label || ""}">
        </div>
      </div>
    `;
    pRoot.appendChild(card);
  });
}

function renderProfile(p){
  el("profileDefaultHorizon").value = p.quick.defaultHorizonDays;
  el("profileDefaultBuffer").value = p.quick.defaultBufferFloor;
  el("profileSameDayOrder").value = p.quick.sameDayOrder || "expensesFirst";
}

async function renderInsights(p){
  const count = await idbCount("tx");
  const cov = await idbGetCoverage();
  const start = cov.start, end = cov.end;

  let days = 0;
  if (start && end){
    const a = parseISO(start), b = parseISO(end);
    days = Math.floor((b - a)/(24*3600*1000)) + 1;
  }

  const level =
    count === 0 ? "None" :
    days >= 180 ? "High" :
    days >= 60 ? "Medium" : "Low";

  el("coverageKpis").innerHTML = `
    <div class="kpi"><div class="t">Coverage</div><div class="v">${start && end ? `${start} → ${end}` : "None"}</div><div class="small muted">${days} days</div></div>
    <div class="kpi"><div class="t">Transactions</div><div class="v">${count}</div><div class="small muted">Stored on device</div></div>
    <div class="kpi"><div class="t">Accuracy</div><div class="v">${level}</div><div class="small muted">${level==="None" ? "Import statements to enable insights" : "Charts should disclose coverage"}</div></div>
  `;

  if (count === 0){
    el("insightsBody").innerHTML = `
      Import statements to enable insights. Quick Check works without statements.
      <br><br>
      Recommendation: import <b>3–6 months</b> for stable budget baselines.
    `;
  } else {
    el("insightsBody").innerHTML = `
      Statements exist. Next step: categorization rules (non-AI, rule-based), then charts.
      <br><br>
      This build intentionally does not show misleading charts yet.
    `;
  }
}

/* =========================================================
   Simulation (anchor-first)
   SAFE = minBalance >= bufferFloor
   ========================================================= */
function estInterest(amount, aprPct, days){
  if (amount <= 0 || !aprPct || aprPct <= 0 || days <= 0) return 0;
  return amount * (aprPct/100) * (days/365);
}
function locCapacity(p){
  const locs = (p.debts||[])
    .filter(d=>d.type==="loc")
    .map(d=>{
      const lim = Number(d.creditLimit||0);
      const bal = Number(d.balance||0);
      return { label:d.label, apr:Number(d.apr||0), avail: Math.max(0, lim - bal) };
    })
    .filter(x=>x.avail>0)
    .sort((a,b)=>(a.apr||999)-(b.apr||999));
  const totalAvail = locs.reduce((s,x)=>s+x.avail,0);
  return { totalAvail, best: locs[0] || null };
}

function buildEvents(p, today, horizonDays){
  const end = addDays(today, horizonDays);
  const events = [];
  const warnings = [];

  // incomes: recurring by each stream
  (p.income||[]).forEach(inc=>{
    const lp = parseISO(inc.lastPayDate);
    const every = Number(inc.everyDays||14);
    const amt = Number(inc.amount||0);
    if (!lp){ warnings.push(`${inc.label||"Income"}: missing last pay date`); return; }
    if (!every || every < 1){ warnings.push(`${inc.label||"Income"}: invalid cadence`); return; }
    if (!amt){ warnings.push(`${inc.label||"Income"}: amount is 0`); }

    // next pay after today
    let d = new Date(lp);
    while (d <= today) d = addDays(d, every);

    while (d <= end){
      events.push({ date: toISO(d), name: `${inc.label||"Income"} pay`, inflow: amt, outflow: 0 });
      d = addDays(d, every);
    }
  });

  // rent: monthly recurring within horizon (if configured)
  const rentAmt = Number(p.rent?.amount||0);
  const rentDay = Number(p.rent?.dueDay||0);
  if (rentAmt > 0 && rentDay >= 1){
    let due = nextDueByDay(today, rentDay);
    while (due && due <= end){
      events.push({ date: toISO(due), name: "Rent", inflow: 0, outflow: rentAmt });
      due = addMonths(due, 1);
    }
  }

  // debts: monthly recurring within horizon
  (p.debts||[]).forEach(d=>{
    const dueDay = Number(d.dueDay||0);
    const bal = Number(d.balance||0);
    if (!dueDay || dueDay < 1) return;
    if (bal <= 0) return;

    let due = nextDueByDay(today, dueDay);
    while (due && due <= end){
      if (d.type === "cc"){
        events.push({ date: toISO(due), name: `${d.label} (CC full)`, inflow: 0, outflow: bal, debtId:d.id });
      } else {
        const apr = Number(d.apr||0);
        const minPay = apr > 0 ? (bal * (apr/100) / 12) : 0;
        if (apr <= 0) warnings.push(`${d.label}: LOC APR is 0 → minimum assumed 0`);
        events.push({ date: toISO(due), name: `${d.label} (LOC minimum)`, inflow: 0, outflow: minPay, debtId:d.id });
      }
      due = addMonths(due, 1);
    }
  });

  // planned (one-time)
  (p.planned||[]).forEach(x=>{
    if (x?.date && Number(x.amount||0) !== 0){
      const d = parseISO(x.date);
      if (d >= today && d <= end){
        events.push({ date: x.date, name: `Planned: ${x.label||"Expense"}`, inflow: 0, outflow: Number(x.amount||0) });
      }
    }
  });

  // sort by date, then same-day ordering
  events.sort((a,b)=>{
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if ((p.quick.sameDayOrder||"expensesFirst") === "expensesFirst"){
      // outflow first (conservative)
      if ((a.outflow||0) !== (b.outflow||0)) return (b.outflow||0) - (a.outflow||0);
      return (b.inflow||0) - (a.inflow||0);
    } else {
      // income first
      if ((a.inflow||0) !== (b.inflow||0)) return (b.inflow||0) - (a.inflow||0);
      return (b.outflow||0) - (a.outflow||0);
    }
  });

  return { events, warnings };
}

function runSimulation(p, cashStart, bufferFloor, horizonDays){
  const today = new Date(); today.setHours(0,0,0,0);
  const { events, warnings } = buildEvents(p, today, horizonDays);

  let bal = Number(cashStart||0);
  let minBal = bal;
  let minDate = toISO(today);
  let firstBreach = null;

  const rows = [];
  for (const e of events){
    bal = bal + (e.inflow||0) - (e.outflow||0);
    rows.push({ ...e, balance: bal });

    if (bal < minBal){
      minBal = bal;
      minDate = e.date;
    }
    if (!firstBreach && bal < bufferFloor){
      firstBreach = { ...e, balance: bal };
    }
  }

  return {
    today: toISO(today),
    cashStart: Number(cashStart||0),
    bufferFloor: Number(bufferFloor||0),
    horizonDays,
    rows,
    minBal,
    minDate,
    firstBreach,
    warnings
  };
}

function anchorWindows(p){
  // anchors: rent + each debt next due date (single next due)
  const today = new Date(); today.setHours(0,0,0,0);
  const anchors = [];

  // rent anchor
  const rentDay = Number(p.rent?.dueDay||0);
  const rentAmt = Number(p.rent?.amount||0);
  if (rentDay>=1 && rentAmt>0){
    const due = nextDueByDay(today, rentDay);
    if (due){
      anchors.push({ id:"rent", label:`Rent`, date: toISO(due) });
    }
  }

  // each debt anchor
  (p.debts||[]).forEach(d=>{
    const dueDay = Number(d.dueDay||0);
    if (!dueDay) return;
    const due = nextDueByDay(today, dueDay);
    if (!due) return;
    anchors.push({ id:d.id, label:`${d.label} (${(d.type||"cc").toUpperCase()})`, date: toISO(due) });
  });

  // sort by date
  anchors.sort((a,b)=>a.date.localeCompare(b.date));
  return anchors;
}

function summarizeToDate(model, untilISO){
  const until = parseISO(untilISO);
  let bal = model.cashStart;
  let minBal = bal;
  let minDate = model.today;
  let firstBreach = null;

  for (const r of model.rows){
    const d = parseISO(r.date);
    if (d > until) break;
    bal = r.balance;
    if (bal < minBal){
      minBal = bal;
      minDate = r.date;
    }
    if (!firstBreach && bal < model.bufferFloor){
      firstBreach = { ...r };
    }
  }

  const ok = (minBal >= model.bufferFloor);
  return { ok, minBal, minDate, firstBreach, endBalance: bal };
}

function renderAnchors(p, model){
  const anchors = anchorWindows(p);

  const wrap = document.createElement("div");
  wrap.className = "anchor-grid";

  if (!anchors.length){
    el("anchorCards").innerHTML = `
      <div class="note">
        Add Rent and/or Debts to create anchors. Anchors are what makes decisions easy to interpret.
      </div>
    `;
    return;
  }

  anchors.forEach(a=>{
    const s = summarizeToDate(model, a.date);
    const status = s.ok ? "SAFE" : "NOT SAFE";

    let cause = "";
    let action = "";
    if (!s.ok && s.firstBreach){
      cause = `First breach: ${s.firstBreach.date} — ${s.firstBreach.name}`;
      const shortBy = Math.max(0, model.bufferFloor - s.firstBreach.balance);

      const cap = locCapacity(p);
      if (cap.totalAvail > 0 && cap.best){
        const borrow = Math.min(shortBy, cap.totalAvail);
        const days = Math.max(1, Math.floor((parseISO(a.date) - parseISO(s.firstBreach.date))/(24*3600*1000)));
        const iCost = estInterest(borrow, cap.best.apr, days);
        action = `Action: borrow $${fmtMoney(borrow)} from LOC (${cap.best.label}) • est. interest ~$${fmtMoney(iCost)}.`;
        if (borrow < shortBy){
          action += ` Remaining gap: $${fmtMoney(shortBy - borrow)}.`;
        }
      } else {
        action = `Action: reduce/delay spend or add LOC details (limit+APR) to compute a funding option.`;
      }
    } else {
      action = `Action: proceed as usual.`;
    }

    const card = document.createElement("div");
    card.className = "anchor-card";
    card.innerHTML = `
      <div class="anchor-top">
        <div>
          <div class="anchor-title">${a.label}</div>
          <div class="anchor-meta">Anchor date: ${a.date}</div>
        </div>
        <div class="anchor-status">
          <span class="badge ${status==="SAFE"?"good":"bad"}">${status}</span>
        </div>
      </div>
      <div class="anchor-meta">
        Lowest balance: <b>${fmtMoney(s.minBal)}</b> on <b>${s.minDate}</b><br>
        Buffer floor: <b>${fmtMoney(model.bufferFloor)}</b>
        ${cause ? `<br>${cause}` : ""}
      </div>
      <div class="anchor-action">${action}</div>
    `;
    wrap.appendChild(card);
  });

  el("anchorCards").innerHTML = "";
  el("anchorCards").appendChild(wrap);
}

function renderDetails(model){
  // KPIs
  el("kpiGrid").innerHTML = `
    <div class="kpi"><div class="t">Today</div><div class="v">${model.today}</div><div class="small muted">Start: ${fmtMoney(model.cashStart)}</div></div>
    <div class="kpi"><div class="t">Buffer floor</div><div class="v">${fmtMoney(model.bufferFloor)}</div><div class="small muted">SAFE means never below this</div></div>
    <div class="kpi"><div class="t">Minimum</div><div class="v ${model.minBal>=model.bufferFloor?"good":"bad"}">${fmtMoney(model.minBal)}</div><div class="small muted">On ${model.minDate}</div></div>
  `;

  // rows table
  const tbody = el("eventsTbody");
  tbody.innerHTML = "";
  (model.rows||[]).forEach(r=>{
    const tr = document.createElement("tr");
    const flag = (r.balance < model.bufferFloor) ? '<span class="bad">BREACH</span>' : "";
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.name}</td>
      <td class="right">${r.inflow?fmtMoney(r.inflow):""}</td>
      <td class="right">${r.outflow?fmtMoney(r.outflow):""}</td>
      <td class="right">${fmtMoney(r.balance)}</td>
      <td>${flag}</td>
    `;
    tbody.appendChild(tr);
  });

  el("warnings").innerHTML = (model.warnings && model.warnings.length)
    ? `<b>Warnings:</b><br>${model.warnings.map(w=>"- "+w).join("<br>")}`
    : "";
}

/* =========================================================
   CSV parsing + mapping wizard (bank-agnostic)
   ========================================================= */
function detectDelimiter(text){
  const sample = text.split(/\r?\n/).slice(0,5).join("\n");
  const candidates = [",",";","\t","|"];
  let best = ",", bestScore = -1;
  for (const d of candidates){
    const score = (sample.match(new RegExp(`\\${d}`, "g")) || []).length;
    if (score > bestScore){ bestScore = score; best = d; }
  }
  return best;
}

// minimal CSV parser (supports quotes; not perfect but works for typical exports)
function parseCSV(text, delimiter){
  const rows = [];
  let cur = [], field = "", inQuotes = false;

  for (let i=0;i<text.length;i++){
    const ch = text[i];
    const next = text[i+1];

    if (ch === '"'){
      if (inQuotes && next === '"'){ field += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === delimiter){
      cur.push(field); field = ""; continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")){
      if (ch === "\r" && next === "\n") i++;
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      continue;
    }

    field += ch;
  }
  if (field.length || cur.length){
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter(r=>r.some(x=>String(x||"").trim()!==""));
}

function parseDateFlexible(s){
  const t = String(s||"").trim();
  if (!t) return null;

  // ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  // MM/DD/YYYY or DD/MM/YYYY
  const m = t.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m){
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    // heuristic: if first > 12 => DD/MM
    let mm = a, dd = b;
    if (a > 12){ dd = a; mm = b; }
    mm = clamp(mm,1,12);
    dd = clamp(dd,1,31);
    return `${y}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
  }

  return null;
}

function parseAmountFlexible(s){
  let t = String(s||"").trim();
  if (!t) return 0;
  // remove currency symbols/spaces
  t = t.replace(/[,$]/g,"").replace(/\s+/g,"");
  // parentheses => negative
  let neg = false;
  if (t.startsWith("(") && t.endsWith(")")){ neg = true; t = t.slice(1,-1); }
  const v = Number(t);
  if (!isFinite(v)) return 0;
  return neg ? -v : v;
}

function normalizeRows(rows, map){
  const headers = map.headers;
  const idx = (h) => headers.indexOf(h);

  const dateI = idx(map.dateCol);
  const descI = idx(map.descCol);
  const accountI = map.accountCol ? idx(map.accountCol) : -1;

  const debitTokens = (map.debitTokens||[]).map(x=>String(x).trim().toLowerCase()).filter(Boolean);

  const out = [];
  for (const r of rows){
    const iso = parseDateFlexible(r[dateI]);
    if (!iso) continue;

    const desc = String(r[descI]||"").trim();
    const account = accountI>=0 ? String(r[accountI]||"").trim() : "";

    let amt = 0;
    if (map.mode === "signed"){
      const aI = idx(map.amountCol);
      amt = parseAmountFlexible(r[aI]);
    } else if (map.mode === "debitcredit"){
      const dI = idx(map.debitCol);
      const cI = idx(map.creditCol);
      const debit = parseAmountFlexible(r[dI]);
      const credit = parseAmountFlexible(r[cI]);
      amt = credit - debit;
    } else if (map.mode === "amounttype"){
      const aI = idx(map.amountCol);
      const tI = idx(map.typeCol);
      const raw = parseAmountFlexible(r[aI]);
      const typ = String(r[tI]||"").trim().toLowerCase();
      const isDebit = debitTokens.some(tok => typ.includes(tok));
      amt = isDebit ? -Math.abs(raw) : Math.abs(raw);
    }

    const key = `${iso}|${amt.toFixed(2)}|${desc.toUpperCase().replace(/\s+/g," ").slice(0,80)}|${account.toUpperCase().slice(0,40)}`;
    out.push({
      id: hashStr(key),
      date: iso,
      description: desc,
      amount: Number(amt.toFixed(2)),
      account
    });
  }
  return out;
}

// simple deterministic hash (non-crypto; OK for dedupe key)
function hashStr(s){
  let h = 2166136261;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "tx_" + (h >>> 0).toString(16);
}

/* =========================================================
   Statement import workflow
   ========================================================= */
let _csvCache = null; // { headers, rows, delimiter }

function fillSelect(sel, headers){
  sel.innerHTML = headers.map(h=>`<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join("");
}
function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildMappingFromUI(headers){
  const mode = el("mapAmountMode").value;

  const map = {
    headers,
    delimiter: _csvCache.delimiter,
    dateCol: el("mapDate").value,
    descCol: el("mapDesc").value,
    mode,
    amountCol: el("mapAmount").value,
    debitCol: el("mapDebit").value,
    creditCol: el("mapCredit").value,
    typeCol: el("mapType").value,
    debitTokens: el("mapDebitTokens").value.split(",").map(x=>x.trim()).filter(Boolean),
    accountCol: el("mapAccount").value || ""
  };

  if (mode === "signed"){
    if (!map.amountCol) return { ok:false, msg:"Pick an Amount column." };
  }
  if (mode === "debitcredit"){
    if (!map.debitCol || !map.creditCol) return { ok:false, msg:"Pick Debit and Credit columns." };
  }
  if (mode === "amounttype"){
    if (!map.amountCol || !map.typeCol) return { ok:false, msg:"Pick Amount and Type columns." };
  }

  if (!map.dateCol || !map.descCol) return { ok:false, msg:"Pick Date and Description columns." };

  return { ok:true, map };
}

function renderPreview(headers, dataRows){
  const { ok, map, msg } = buildMappingFromUI(headers);
  if (!ok){
    el("previewTbody").innerHTML = "";
    el("mapWarnings").textContent = msg || "";
    return;
  }

  const preview = normalizeRows(dataRows.slice(0,200), map).slice(0,10);
  el("previewTbody").innerHTML = preview.map(x=>`
    <tr>
      <td>${x.date}</td>
      <td>${escapeHtml(x.description)}</td>
      <td class="right">${fmtMoney(x.amount)}</td>
      <td>${escapeHtml(x.account||"")}</td>
    </tr>
  `).join("");

  // warnings: detect suspicious sign (all positive or all negative)
  const s = preview.map(x=>x.amount);
  const pos = s.filter(v=>v>0).length;
  const neg = s.filter(v=>v<0).length;
  const warn = [];
  if (preview.length && (pos===0 || neg===0)){
    warn.push("Preview amounts are one-sided (all + or all -). Verify amount/sign mapping.");
  }
  el("mapWarnings").textContent = warn.join(" ");
}

async function persistNormalizedTx(list){
  // put each tx (dedupe by id)
  const db = await idbOpen();
  await new Promise((resolve, reject)=>{
    const tx = db.transaction("tx", "readwrite");
    const os = tx.objectStore("tx");
    list.forEach(item => os.put(item));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });

  // update coverage meta
  const count = await idbCount("tx");
  const cov = await idbGetCoverage();
  let days = 0;
  if (cov.start && cov.end){
    const a = parseISO(cov.start), b = parseISO(cov.end);
    days = Math.floor((b - a)/(24*3600*1000)) + 1;
  }
  await idbPut("meta", { k:"coverage", v:{ ...cov, days, count, lastImportAt: new Date().toISOString() } });
}

async function refreshStatementStatus(){
  const count = await idbCount("tx");
  const covMeta = await idbGet("meta","coverage");
  const v = covMeta?.v || { start:null, end:null, days:0, count:count, lastImportAt:null };

  el("statementStatus").innerHTML = `
    <b>On-device statements:</b> ${v.count || 0} tx
    ${v.start && v.end ? ` • coverage ${v.start} → ${v.end} (${v.days} days)` : ""}
    ${v.lastImportAt ? ` • last import ${new Date(v.lastImportAt).toLocaleString()}` : ""}
  `;
}

/* =========================================================
   Events / inputs
   ========================================================= */
function attachInputHandlers(){
  document.body.addEventListener("input", (e)=>{
    const t = e.target;
    const p = loadProfile();

    // Quick persistent defaults
    if (t.id === "rentAmount") p.rent.amount = Number(t.value||0);
    if (t.id === "rentDueDay") p.rent.dueDay = Number(t.value||28);
    if (t.id === "note") p.quick.note = t.value || "";
    if (t.id === "qcCashToday") p.quick.lastCashToday = Number(t.value||0);
    if (t.id === "qcBufferFloor") p.quick.defaultBufferFloor = Number(t.value||0);
    if (t.id === "qcHorizonDays") p.quick.defaultHorizonDays = Number(t.value||90);

    // Profile tab fields
    if (t.id === "profileDefaultHorizon") p.quick.defaultHorizonDays = Number(t.value||90);
    if (t.id === "profileDefaultBuffer") p.quick.defaultBufferFloor = Number(t.value||0);
    if (t.id === "profileSameDayOrder") p.quick.sameDayOrder = t.value;

    // income edits
    const incId = t.dataset.income;
    if (incId){
      const it = p.income.find(x=>x.id===incId);
      if (it){
        const k = t.dataset.k;
        if (k==="label") it.label = t.value || "";
        if (k==="lastPayDate") it.lastPayDate = t.value || "";
        if (k==="everyDays") it.everyDays = Number(t.value||14);
        if (k==="amount") it.amount = Number(t.value||0);
      }
    }

    // debt edits
    const debtId = t.dataset.debt;
    if (debtId){
      const d = p.debts.find(x=>x.id===debtId);
      if (d){
        const k = t.dataset.k;
        if (k==="label") d.label = t.value || "";
        if (k==="type") d.type = t.value || "cc";
        if (k==="dueDay") d.dueDay = Number(t.value||1);
        if (k==="balance") d.balance = Number(t.value||0);
        if (k==="apr") d.apr = Number(t.value||0);
        if (k==="creditLimit") d.creditLimit = Number(t.value||0);
      }
    }

    // planned edits
    const planId = t.dataset.planned;
    if (planId){
      const x = p.planned.find(z=>z.id===planId);
      if (x){
        const k = t.dataset.k;
        if (k==="date") x.date = t.value || "";
        if (k==="amount") x.amount = Number(t.value||0);
        if (k==="label") x.label = t.value || "";
      }
    }

    saveProfile(p);
  });
}

/* =========================================================
   Buttons
   ========================================================= */
function wireButtons(){
  // add income/debt/planned
  el("btnAddIncome").onclick = ()=>{
    const p = loadProfile();
    p.income.push({ id:uid(), label:"Income", lastPayDate:toISO(addDays(new Date(), -14)), everyDays:14, amount:0 });
    saveProfile(p);
    renderQuick(p);
  };
  el("btnAddDebt").onclick = ()=>{
    const p = loadProfile();
    p.debts.push({ id:uid(), label:"Card/LOC", type:"cc", dueDay:1, balance:0, apr:0, creditLimit:0 });
    saveProfile(p);
    renderQuick(p);
  };
  el("btnAddPlanned").onclick = ()=>{
    const p = loadProfile();
    p.planned.push({ id:uid(), date:toISO(addDays(new Date(), 7)), amount:0, label:"Planned expense" });
    saveProfile(p);
    renderQuick(p);
  };

  // deletes
  document.body.addEventListener("click",(e)=>{
    const t = e.target;
    const p = loadProfile();

    if (t.dataset.delincome){
      p.income = p.income.filter(x=>x.id!==t.dataset.delincome);
      saveProfile(p); renderQuick(p);
    }
    if (t.dataset.deldebt){
      p.debts = p.debts.filter(x=>x.id!==t.dataset.deldebt);
      saveProfile(p); renderQuick(p);
    }
    if (t.dataset.delplanned){
      p.planned = p.planned.filter(x=>x.id!==t.dataset.delplanned);
      saveProfile(p); renderQuick(p);
    }
  });

  // compute
  el("btnCompute").onclick = ()=>{
    const p = loadProfile();

    const cashToday = Number(el("qcCashToday").value||0);
    const buffer = Number(el("qcBufferFloor").value||0);
    const horizon = Number(el("qcHorizonDays").value||90);

    // persist last run cash
    p.quick.lastCashToday = cashToday;
    p.quick.defaultBufferFloor = buffer;
    p.quick.defaultHorizonDays = horizon;

    // rent persisted via input handler, but ensure sync
    p.rent.amount = Number(el("rentAmount").value||0);
    p.rent.dueDay = Number(el("rentDueDay").value||28);
    p.quick.note = el("note").value || "";

    saveProfile(p);

    const model = runSimulation(p, cashToday, buffer, horizon);
    renderAnchors(p, model);
    renderDetails(model);
  };

  // details toggle
  el("btnToggleDetails").onclick = ()=>{
    const wrap = el("detailsWrap");
    wrap.classList.toggle("hidden");
    el("btnToggleDetails").textContent = wrap.classList.contains("hidden") ? "Show details" : "Hide details";
  };

  // Export profile
  el("btnExportProfile").onclick = async ()=>{
    const p = loadProfile();
    // also include coverage meta (not tx data)
    const covMeta = await idbGet("meta","coverage");
    p.coverage = covMeta?.v || p.coverage;

    const blob = new Blob([JSON.stringify(p,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nextbill-profile.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import profile
  el("importProfileFile").addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    const p = migrateProfile(JSON.parse(txt));
    saveProfile(p);
    await boot();
    e.target.value = "";
  });

  // Reset everything
  el("btnResetAll").onclick = async ()=>{
    if (!confirm("Delete ALL local app data on this device (profile + statements)?")) return;
    localStorage.removeItem(LS_PROFILE);
    await idbClear("tx");
    await idbClear("meta");
    location.reload();
  };

  // CSV upload
  el("csvFile").addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();

    const delimiter = detectDelimiter(text);
    const rawRows = parseCSV(text, delimiter);
    if (rawRows.length < 2){
      alert("CSV looks empty.");
      e.target.value = "";
      return;
    }

    const headers = rawRows[0].map(h=>String(h||"").trim());
    const dataRows = rawRows.slice(1);

    _csvCache = { headers, rows:dataRows, delimiter };

    // populate wizard selects
    fillSelect(el("mapDate"), headers);
    fillSelect(el("mapDesc"), headers);
    fillSelect(el("mapAmount"), headers);
    fillSelect(el("mapDebit"), headers);
    fillSelect(el("mapCredit"), headers);
    fillSelect(el("mapType"), headers);

    // account optional: include blank first
    el("mapAccount").innerHTML = `<option value="">(none)</option>` + headers.map(h=>`<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join("");

    // try auto-suggest
    autoSuggestMapping(headers, dataRows);

    el("mapWizard").classList.remove("hidden");
    renderPreview(headers, dataRows);

    e.target.value = "";
  });

  // mapping changes => re-preview
  ["mapDate","mapDesc","mapAmountMode","mapAmount","mapDebit","mapCredit","mapType","mapDebitTokens","mapAccount"]
    .forEach(id=>{
      el(id).addEventListener("input", ()=>{
        if (!_csvCache) return;
        renderPreview(_csvCache.headers, _csvCache.rows);
      });
    });

  // confirm mapping
  el("btnConfirmMapping").onclick = async ()=>{
    if (!_csvCache) return;
    const p = loadProfile();
    const { ok, map, msg } = buildMappingFromUI(_csvCache.headers);
    if (!ok){
      alert(msg || "Mapping incomplete.");
      return;
    }

    // normalize
    const normalized = normalizeRows(_csvCache.rows, map);
    if (!normalized.length){
      alert("No transactions parsed. Check date/amount mapping.");
      return;
    }

    // persist normalized tx
    await persistNormalizedTx(normalized);

    // save mapping in profile
    p.csvMapping = map;
    saveProfile(p);

    el("mapWizard").classList.add("hidden");
    _csvCache = null;

    await refreshStatementStatus();
    await renderInsights(loadProfile());

    alert(`Imported ${normalized.length} transactions (deduped by id).`);
  };

  // clear statements
  el("btnClearStatements").onclick = async ()=>{
    if (!confirm("Delete all on-device statement transactions?")) return;
    await idbClear("tx");
    await idbPut("meta", { k:"coverage", v:{ start:null, end:null, days:0, count:0, lastImportAt:null } });
    await refreshStatementStatus();
    await renderInsights(loadProfile());
  };
}

function autoSuggestMapping(headers, rows){
  const hLower = headers.map(h=>h.toLowerCase());

  // date: column with many parseable dates
  const dateScores = headers.map((h, i)=>{
    let ok=0, n=0;
    for (const r of rows.slice(0,200)){
      const v = parseDateFlexible(r[i]);
      if (v) ok++;
      n++;
    }
    return ok/n;
  });
  let bestDate = 0;
  for (let i=1;i<dateScores.length;i++) if (dateScores[i] > dateScores[bestDate]) bestDate = i;

  // description: longest average string
  const descScores = headers.map((h,i)=>{
    let total=0, n=0;
    for (const r of rows.slice(0,200)){
      total += String(r[i]||"").length;
      n++;
    }
    return total/(n||1);
  });
  let bestDesc = 0;
  for (let i=1;i<descScores.length;i++) if (descScores[i] > descScores[bestDesc]) bestDesc = i;

  el("mapDate").value = headers[bestDate];
  el("mapDesc").value = headers[bestDesc];

  // suggest amount column: numeric-heavy
  const numScores = headers.map((h,i)=>{
    let ok=0, n=0;
    for (const r of rows.slice(0,200)){
      const t = String(r[i]||"").replace(/[,$()\s]/g,"");
      if (t === "") continue;
      if (!isNaN(Number(t))) ok++;
      n++;
    }
    return ok/(n||1);
  });
  let bestAmt = 0;
  for (let i=1;i<numScores.length;i++) if (numScores[i] > numScores[bestAmt]) bestAmt = i;
  el("mapAmount").value = headers[bestAmt];

  // debit/credit guess by header names
  const debitIdx = hLower.findIndex(x=>x.includes("debit") || x==="dr");
  const creditIdx = hLower.findIndex(x=>x.includes("credit") || x==="cr");
  if (debitIdx>=0 && creditIdx>=0){
    el("mapAmountMode").value = "debitcredit";
    el("mapDebit").value = headers[debitIdx];
    el("mapCredit").value = headers[creditIdx];
  } else {
    el("mapAmountMode").value = "signed";
  }

  // type column guess
  const typeIdx = hLower.findIndex(x=>x.includes("type"));
  if (typeIdx>=0) el("mapType").value = headers[typeIdx];

  // account column guess
  const acctIdx = hLower.findIndex(x=>x.includes("account"));
  if (acctIdx>=0) el("mapAccount").value = headers[acctIdx];
}

/* =========================================================
   Boot
   ========================================================= */
async function boot(){
  // tabs
  mountTabs();
  mountDrawer();
  mountTheme();
  attachInputHandlers();
  wireButtons();

  const p = loadProfile();
  document.documentElement.setAttribute("data-theme", p.theme || "dark");

  renderQuick(p);
  renderProfile(p);
  await refreshStatementStatus();
  await renderInsights(p);

  // initial compute (optional)
  const cashToday = Number(el("qcCashToday").value||0);
  const buffer = Number(el("qcBufferFloor").value||0);
  const horizon = Number(el("qcHorizonDays").value||90);
  const model = runSimulation(p, cashToday, buffer, horizon);
  renderAnchors(p, model);
  renderDetails(model);

  // register SW
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
}

(async function init(){
  await boot();
})();
