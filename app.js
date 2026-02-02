/* =========================================================
   Cashflow Decision Maker — Quiz setup (dynamic debts) + decisive output
   Requirements implemented:
   1) After entering 1 debt, ask: "Add another CC/LOC?" Yes/No (per person)
   2) Ask Car loan/lease EMI per pay (optional) in quiz (per person)
   3) Phone-safe quiz input sizing handled mostly by CSS; JS also guards
   4) LOC questions are conditional (APR/Limit/Balance asked only if LOC)
   5) Decision output recommends minimal LOC borrowing if UNSAFE
   ========================================================= */

const LS = "cashflow_quiz_v4";

const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const el = (id) => document.getElementById(id);

/* ---------- utils ---------- */
function fmt(x){
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

function nextDueByDay(today, dueDay){
  if (!dueDay || dueDay < 1) return null;
  const y = today.getFullYear(), m = today.getMonth();
  const thisM = new Date(y, m, Math.min(dueDay, dim(y,m)));
  if (today.getDate() <= dueDay) return thisM;
  const nm = new Date(y, m+1, 1);
  return new Date(nm.getFullYear(), nm.getMonth(), Math.min(dueDay, dim(nm.getFullYear(), nm.getMonth())));
}
function nextPayFromLast(today, lastPay, everyDays){
  const diff = Math.floor((today - lastPay) / (24*3600*1000));
  const k = Math.max(0, Math.ceil(diff / everyDays));
  let cand = addDays(lastPay, k*everyDays);
  if (cand <= today) cand = addDays(cand, everyDays);
  return cand;
}

/* ---------- storage ---------- */
function load(){
  const raw = localStorage.getItem(LS);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function save(st){ localStorage.setItem(LS, JSON.stringify(st)); }

/* ---------- default state ---------- */
function defaultState(){
  const td = new Date(); td.setHours(0,0,0,0);
  const fallback = toISO(addDays(td, -14));

  return {
    theme: "dark",
    mode: "setup",
    settings: { payEveryDays: 14, horizonDays: 90, rentDueDay: 28 },
    shared: { rentAmount: 0, cashBuffer: 0, note: "", wantsFuture: false },
    people: [
      {
        id: crypto.randomUUID(),
        name: "Person 1",
        lastPayDate: fallback,
        payAmount: 0,
        cash: 0,
        perPayObligationLabel: "Car loan/lease (per pay)",
        perPayObligationAmount: 0,
        debts: [
          { id: crypto.randomUUID(), label: "AMEX", type: "cc", dueDay: 16, balance: 0, apr: 0, creditLimit: 0 }
        ]
      },
      {
        id: crypto.randomUUID(),
        name: "Person 2",
        lastPayDate: fallback,
        payAmount: 0,
        cash: 0,
        perPayObligationLabel: "Car loan/lease (per pay)",
        perPayObligationAmount: 0,
        debts: [
          { id: crypto.randomUUID(), label: "CIBC", type: "cc", dueDay: 5, balance: 0, apr: 0, creditLimit: 0 }
        ]
      }
    ],
    future: [],
    quiz: { cur: null, history: [] }
  };
}

/* ---------- migration ---------- */
function migrate(st){
  if (!st) return st;

  if (!st.shared) st.shared = { rentAmount:0, cashBuffer:0, note:"", wantsFuture:false };
  if (st.shared.wantsFuture == null) st.shared.wantsFuture = false;

  if (!st.quiz) st.quiz = { cur: null, history: [] };
  if (!Array.isArray(st.quiz.history)) st.quiz.history = [];

  (st.people||[]).forEach(p=>{
    if (!p.debts) p.debts = [];
    if (p.perPayObligationLabel == null) p.perPayObligationLabel = "Car loan/lease (per pay)";
    if (p.perPayObligationAmount == null) p.perPayObligationAmount = 0;

    p.debts.forEach(d=>{
      if (d.creditLimit == null) d.creditLimit = 0;
      if (d.apr == null) d.apr = 0;
      if (d.balance == null) d.balance = 0;
      if (!d.type) d.type = "cc";
      if (d.dueDay == null) d.dueDay = 0;
      if (!d.label) d.label = "Card";
    });

    if (p.debts.length === 0){
      p.debts.push({ id: crypto.randomUUID(), label:"Card 1", type:"cc", dueDay:0, balance:0, apr:0, creditLimit:0 });
    }
  });

  return st;
}

/* =========================================================
   UI helpers
   ========================================================= */
function showTab(tab){
  qsa(".seg button").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  ["setup","today","future","results","settings"].forEach(t=>{
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
    const st = migrate(load() || defaultState());
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = (cur === "dark") ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    st.theme = next;
    save(st);
  });
}

/* =========================================================
   TODAY / FUTURE / SETTINGS render (kept simple)
   ========================================================= */
function renderToday(st){
  const root = el("peopleToday");
  root.innerHTML = "";

  st.people.slice(0,2).forEach((p, idx)=>{
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.style.marginTop = "12px";
    wrap.innerHTML = `
      <div class="section-title">
        <div class="h">${p.name}</div>
        <div class="muted small">${idx===0 ? "Primary" : "Secondary"}</div>
      </div>
      <div class="grid">
        <div class="field">
          <label>Last pay date</label>
          <input data-p="${p.id}" data-k="lastPayDate" type="date" value="${p.lastPayDate || ""}">
        </div>
        <div class="field">
          <label>Pay amount (per pay)</label>
          <input data-p="${p.id}" data-k="payAmount" type="number" step="0.01" value="${p.payAmount || 0}">
        </div>
        <div class="field">
          <label>Cash (optional)</label>
          <input data-p="${p.id}" data-k="cash" type="number" step="0.01" value="${p.cash || 0}">
        </div>
      </div>

      <div class="divider"></div>
      <div class="muted small" style="margin-bottom:8px;">Debts (balances)</div>
      <div class="grid" data-debts="${p.id}"></div>
    `;
    root.appendChild(wrap);

    const debtsGrid = wrap.querySelector(`[data-debts="${p.id}"]`);
    debtsGrid.innerHTML = "";
    p.debts.forEach(d=>{
      const box = document.createElement("div");
      box.className = "field";
      box.innerHTML = `
        <label>${d.label} (${d.type.toUpperCase()})</label>
        <input data-p="${p.id}" data-debt="${d.id}" data-k="balance" type="number" step="0.01" value="${d.balance || 0}">
      `;
      debtsGrid.appendChild(box);
    });
  });

  el("rentAmount").value = st.shared.rentAmount || 0;
  el("cashBuffer").value = st.shared.cashBuffer || 0;
  el("note").value = st.shared.note || "";
}

function renderFuture(st){
  const tbody = el("futureTbody");
  tbody.innerHTML = "";
  st.future.sort((a,b)=>a.date.localeCompare(b.date)).forEach((it, i)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.date}</td>
      <td>${it.label || ""}</td>
      <td class="right">${fmt(it.amount)}</td>
      <td class="right"><button class="ios6-btn danger" data-del="${i}" style="padding:8px 10px;">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const st2 = migrate(load() || defaultState());
      st2.future.splice(Number(btn.dataset.del), 1);
      save(st2);
      boot();
      showTab("future");
    });
  });
}

function renderSettings(st){
  el("payEveryDays").value = st.settings.payEveryDays;
  el("horizonDays").value = st.settings.horizonDays;
  el("rentDueDay").value = st.settings.rentDueDay;

  const root = el("peopleManage");
  root.innerHTML = "";

  st.people.forEach(p=>{
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginTop = "12px";
    card.innerHTML = `
      <div class="section-title">
        <div class="h">${p.name}</div>
        <button class="ios6-btn danger" data-delperson="${p.id}">Delete</button>
      </div>

      <div class="grid">
        <div class="field">
          <label>Name</label>
          <input data-p="${p.id}" data-k="name" type="text" value="${p.name}">
        </div>
        <div class="field">
          <label>Car loan/lease (per pay)</label>
          <input data-p="${p.id}" data-k="perPayObligationAmount" type="number" step="0.01" value="${p.perPayObligationAmount || 0}">
        </div>
        <div class="field">
          <label>Car loan/lease label</label>
          <input data-p="${p.id}" data-k="perPayObligationLabel" type="text" value="${p.perPayObligationLabel || "Car loan/lease (per pay)"}">
        </div>
      </div>

      <div class="divider"></div>
      <div class="section-title">
        <div class="h">Debts</div>
        <button class="ios6-btn" data-adddebt="${p.id}">Add debt</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Label</th><th style="width:90px;">Type</th><th style="width:90px;">Due</th>
            <th style="width:100px;">APR%</th><th style="width:140px;" class="right">Balance</th>
            <th style="width:140px;" class="right">Limit</th><th style="width:110px;"></th>
          </tr>
        </thead>
        <tbody data-debttbody="${p.id}"></tbody>
      </table>
    `;
    root.appendChild(card);

    const dt = card.querySelector(`[data-debttbody="${p.id}"]`);
    dt.innerHTML = "";
    p.debts.forEach(d=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input data-p="${p.id}" data-debt="${d.id}" data-k="label" type="text" value="${d.label}"></td>
        <td>
          <select data-p="${p.id}" data-debt="${d.id}" data-k="type">
            <option value="cc" ${d.type==="cc"?"selected":""}>CC</option>
            <option value="loc" ${d.type==="loc"?"selected":""}>LOC</option>
          </select>
        </td>
        <td><input data-p="${p.id}" data-debt="${d.id}" data-k="dueDay" type="number" min="1" max="31" value="${d.dueDay || 0}"></td>
        <td><input data-p="${p.id}" data-debt="${d.id}" data-k="apr" type="number" step="0.01" value="${d.apr || 0}"></td>
        <td class="right"><input data-p="${p.id}" data-debt="${d.id}" data-k="balance" type="number" step="0.01" value="${d.balance || 0}"></td>
        <td class="right"><input data-p="${p.id}" data-debt="${d.id}" data-k="creditLimit" type="number" step="0.01" value="${d.creditLimit || 0}"></td>
        <td class="right"><button class="ios6-btn danger" data-deldebt="${p.id}:${d.id}" style="padding:8px 10px;">Delete</button></td>
      `;
      dt.appendChild(tr);
    });

    card.querySelectorAll("button[data-deldebt]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const [pid, did] = b.dataset.deldebt.split(":");
        const st2 = migrate(load() || defaultState());
        const p2 = st2.people.find(x=>x.id===pid);
        p2.debts = p2.debts.filter(x=>x.id!==did);
        if (p2.debts.length === 0){
          p2.debts.push({ id: crypto.randomUUID(), label:"Card 1", type:"cc", dueDay:0, balance:0, apr:0, creditLimit:0 });
        }
        save(st2);
        boot();
        showTab("settings");
      });
    });

    card.querySelector("button[data-adddebt]").addEventListener("click", ()=>{
      const st2 = migrate(load() || defaultState());
      const p2 = st2.people.find(x=>x.id===p.id);
      p2.debts.push({ id: crypto.randomUUID(), label:"New debt", type:"cc", dueDay:0, balance:0, apr:0, creditLimit:0 });
      save(st2);
      boot();
      showTab("settings");
    });

    card.querySelector("button[data-delperson]").addEventListener("click", ()=>{
      const st2 = migrate(load() || defaultState());
      st2.people = st2.people.filter(x=>x.id!==p.id);
      save(st2);
      boot();
      showTab("settings");
    });
  });

  el("btnAddPerson").onclick = ()=>{
    const st2 = migrate(load() || defaultState());
    st2.people.push({
      id: crypto.randomUUID(),
      name: `Person ${st2.people.length+1}`,
      lastPayDate: toISO(addDays(new Date(), -14)),
      payAmount: 0,
      cash: 0,
      perPayObligationLabel: "Car loan/lease (per pay)",
      perPayObligationAmount: 0,
      debts: [{ id: crypto.randomUUID(), label:"Card 1", type:"cc", dueDay:0, balance:0, apr:0, creditLimit:0 }]
    });
    save(st2);
    boot();
    showTab("settings");
  };
}

/* =========================================================
   Save-on-input bindings
   ========================================================= */
function attachInputHandlers(){
  document.body.addEventListener("input", (e)=>{
    const t = e.target;
    const st = migrate(load() || defaultState());

    if (t.id === "rentAmount") st.shared.rentAmount = Number(t.value||0);
    if (t.id === "cashBuffer") st.shared.cashBuffer = Number(t.value||0);
    if (t.id === "note") st.shared.note = t.value || "";

    if (t.id === "payEveryDays") st.settings.payEveryDays = Number(t.value||14);
    if (t.id === "horizonDays") st.settings.horizonDays = Number(t.value||90);
    if (t.id === "rentDueDay") st.settings.rentDueDay = Number(t.value||28);

    const pid = t.dataset.p;
    if (pid){
      const p = st.people.find(x=>x.id===pid);
      if (!p) return;
      const k = t.dataset.k;

      if (t.dataset.debt){
        const d = p.debts.find(x=>x.id===t.dataset.debt);
        if (!d) return;
        if (k === "label") d.label = t.value || "";
        if (k === "type") d.type = t.value;
        if (k === "dueDay") d.dueDay = Number(t.value||0);
        if (k === "apr") d.apr = Number(t.value||0);
        if (k === "balance") d.balance = Number(t.value||0);
        if (k === "creditLimit") d.creditLimit = Number(t.value||0);
      } else {
        if (k === "name") p.name = t.value || "";
        if (k === "lastPayDate") p.lastPayDate = t.value || "";
        if (k === "payAmount") p.payAmount = Number(t.value||0);
        if (k === "cash") p.cash = Number(t.value||0);
        if (k === "perPayObligationLabel") p.perPayObligationLabel = t.value || "";
        if (k === "perPayObligationAmount") p.perPayObligationAmount = Number(t.value||0);
      }
    }

    save(st);
  });
}

/* =========================================================
   Decision engine (Feynman)
   ========================================================= */
function estInterest(amount, aprPct, days){
  if (amount <= 0 || !aprPct || aprPct <= 0 || days <= 0) return 0;
  return amount * (aprPct/100) * (days/365);
}

function locCapacity(st){
  let totalAvail = 0;
  const locs = [];
  st.people.forEach(p=>{
    (p.debts||[]).forEach(d=>{
      if (d.type !== "loc") return;
      const lim = Number(d.creditLimit||0);
      const bal = Number(d.balance||0);
      const avail = Math.max(0, lim - bal);
      const apr = Number(d.apr||0);
      totalAvail += avail;
      locs.push({ owner:p.name, label:d.label, avail, apr });
    });
  });
  locs.sort((a,b)=> (a.apr||999)-(b.apr||999));
  return { totalAvail, best: locs[0] || null };
}

function compute(st){
  const today = new Date(); today.setHours(0,0,0,0);
  const every = st.settings.payEveryDays || 14;
  const horizon = st.settings.horizonDays || 90;

  const events = [];
  const warnings = [];

  let cashStart = Number(st.shared.cashBuffer||0);
  st.people.forEach(p=> cashStart += Number(p.cash||0));

  // pay streams + car EMI (per pay)
  st.people.forEach(p=>{
    const lp = parseISO(p.lastPayDate);
    if (!lp) { warnings.push(`${p.name}: missing last pay date`); return; }
    let pay = nextPayFromLast(today, lp, every);
    while (pay <= addDays(today, horizon)){
      events.push({ date: toISO(pay), name: `${p.name} pay`, inflow: Number(p.payAmount||0), outflow: 0 });

      const emi = Number(p.perPayObligationAmount||0);
      if (emi > 0){
        events.push({ date: toISO(pay), name: `${p.name}: ${p.perPayObligationLabel || "Car loan/lease"} `, inflow: 0, outflow: emi });
      }

      pay = addDays(pay, every);
    }
  });

  // rent (next occurrence)
  const rentDue = nextDueByDay(today, st.settings.rentDueDay);
  if (rentDue && (st.shared.rentAmount||0) > 0){
    events.push({ date: toISO(rentDue), name: `Rent`, inflow: 0, outflow: Number(st.shared.rentAmount||0) });
  }

  // debts (next occurrence)
  st.people.forEach(p=>{
    (p.debts||[]).forEach(d=>{
      if (!d.dueDay || d.dueDay < 1) return;
      const due = nextDueByDay(today, d.dueDay);
      if (!due) return;

      const bal = Number(d.balance||0);
      if (bal <= 0) return;

      if (d.type === "cc"){
        events.push({ date: toISO(due), name: `${p.name}: ${d.label} (CC full)`, inflow: 0, outflow: bal });
      } else {
        const apr = Number(d.apr||0);
        const minPay = (apr > 0) ? (bal * (apr/100) / 12) : 0;
        if (apr <= 0) warnings.push(`${p.name}: ${d.label} is LOC but APR is 0 → minimum assumed 0`);
        events.push({ date: toISO(due), name: `${p.name}: ${d.label} (LOC minimum)`, inflow: 0, outflow: minPay });
      }
    });
  });

  // future
  (st.future||[]).forEach(x=>{
    if (x?.date && Number(x.amount||0) !== 0){
      events.push({ date: x.date, name: `Future: ${x.label||"Expense"}`, inflow: 0, outflow: Number(x.amount||0) });
    }
  });

  events.sort((a,b)=>{
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (b.inflow - a.inflow) || (a.outflow - b.outflow);
  });

  let bal = cashStart;
  let minBal = bal;
  let firstNeg = null;
  let firstNegRow = null;

  const rows = events
    .filter(e=>{
      const d = parseISO(e.date);
      return d >= today && d <= addDays(today, horizon);
    })
    .map(e=>{
      bal = bal + (e.inflow||0) - (e.outflow||0);
      if (bal < minBal) minBal = bal;
      if (bal < 0 && !firstNeg){
        firstNeg = e.date;
        firstNegRow = { ...e, balance: bal };
      }
      return { ...e, balance: bal };
    });

  const nextPays = st.people
    .map(p=>parseISO(p.lastPayDate))
    .filter(Boolean)
    .map(lp=>nextPayFromLast(today, lp, every))
    .sort((a,b)=>a-b);

  const nextPay = nextPays[0] || addDays(today, every);
  const nextPay2 = addDays(nextPay, every);

  const inflow1 = rows.filter(r=> parseISO(r.date) <= nextPay).reduce((s,r)=>s+r.inflow,0);
  const out1 = rows.filter(r=> parseISO(r.date) <= nextPay && r.outflow>0).reduce((s,r)=>s+r.outflow,0);
  const inflow2 = rows.filter(r=> parseISO(r.date) <= nextPay2).reduce((s,r)=>s+r.inflow,0);
  const out2 = rows.filter(r=> parseISO(r.date) <= nextPay2 && r.outflow>0).reduce((s,r)=>s+r.outflow,0);

  return { today:toISO(today), cashStart, nextPay:toISO(nextPay), nextPay2:toISO(nextPay2),
           inflow1,out1,inflow2,out2, rows, minBal, firstNeg, firstNegRow, warnings };
}

function renderResults(st, model){
  // --- helpers for decision-only output ---
  function locCapacity(st){
    let totalAvail = 0;
    const locs = [];

    st.people.forEach(p=>{
      (p.debts||[]).forEach(d=>{
        if (d.type !== "loc") return;
        const lim = Number(d.creditLimit||0);
        const bal = Number(d.balance||0);
        const avail = Math.max(0, lim - bal);
        const apr = Number(d.apr||0);
        totalAvail += avail;
        locs.push({ owner:p.name, label:d.label, avail, apr });
      });
    });

    locs.sort((a,b)=> (a.apr||999)-(b.apr||999));
    return { totalAvail, best: locs[0] || null };
  }

  function estInterest(amount, aprPct, days){
    if (amount <= 0 || !aprPct || aprPct <= 0 || days <= 0) return 0;
    return amount * (aprPct/100) * (days/365);
  }

  // --- DECISION TEXT (what user sees) ---
  let verdict = "SAFE";
  let blockingName = "";
  let blockingDate = "";
  let shortBy = 0;
  let actionLine = "Pay as usual.";
  let interestLine = "";

  if (model.firstNegRow){
    verdict = "UNSAFE";
    blockingName = model.firstNegRow.name;
    blockingDate = model.firstNegRow.date;
    shortBy = Math.abs(model.firstNegRow.balance);

    const cap = locCapacity(st);
    if (cap.totalAvail > 0){
      const borrow = Math.min(shortBy, cap.totalAvail);
      const best = cap.best;
      const apr = best?.apr || 0;

      const blockDate = parseISO(blockingDate);
      const nextPayDate = parseISO(model.nextPay);
      const days = Math.max(1, Math.floor((nextPayDate - blockDate)/(24*3600*1000)));

      const iCost = estInterest(borrow, apr, days);

      actionLine = `Best action: Borrow $${fmt(borrow)} from LOC (lowest APR: ${best.owner} • ${best.label}).`;
      interestLine = `Interest estimate: ~$${fmt(iCost)} for ${days} days.`;

      if (borrow < shortBy){
        actionLine += ` LOC limit is not enough. Remaining unfunded: $${fmt(shortBy - borrow)}.`;
      }
      if (!apr || apr<=0){
        interestLine += ` (APR missing → set APR for accuracy.)`;
      }
    } else {
      actionLine = `Best action: Borrow from LOC, but no LOC credit limit is set. Enter LOC limit + APR in Settings.`;
      interestLine = "";
    }
  } else {
    // SAFE: we still show blocking bill (next due) if possible
    // Pick the next outflow event after today as "next bill"
    const nextOut = (model.rows||[]).find(r => (r.outflow||0) > 0);
    if (nextOut){
      blockingName = nextOut.name;
      blockingDate = nextOut.date;
    }
  }

  // Render the text-only decision
  const safeTitle = `✅ DECISION: SAFE`;
  const unsafeTitle = `❌ DECISION: UNSAFE`;

  let html = `
    <div class="h">Decision</div>
    <div style="font-size:20px;font-weight:950;margin-top:6px;" class="${verdict==="SAFE"?"good":"bad"}">
      ${verdict==="SAFE" ? safeTitle : unsafeTitle}
    </div>
  `;

  if (blockingName && blockingDate){
    html += `
      <div style="margin-top:10px;">
        <div class="muted small">Blocking bill</div>
        <div style="font-weight:900;">${blockingName}</div>
        <div class="small muted">Due: ${blockingDate}</div>
      </div>
    `;
  }

  if (verdict === "UNSAFE"){
    html += `
      <div style="margin-top:12px;">
        <div class="muted small">Shortfall</div>
        <div style="font-weight:950;">Short by: $${fmt(shortBy)}</div>
      </div>
      <div style="margin-top:12px;">
        <div style="font-weight:900;">${actionLine}</div>
        ${interestLine ? `<div class="small muted" style="margin-top:6px;">${interestLine}</div>` : ``}
      </div>
      <div style="margin-top:12px;font-weight:950;">
        Final instruction: Do the above action before the due date.
      </div>
    `;
  } else {
    html += `
      <div style="margin-top:12px;font-weight:900;">
        Final instruction: Pay as usual.
      </div>
    `;
  }

  el("decisionText").innerHTML = html;

  // --- DETAILS (optional) still computed but hidden by default ---
  const surplus1 = (model.cashStart + model.inflow1) - model.out1;
  const surplus2 = (model.cashStart + model.inflow2) - model.out2;

  if (el("kpiGrid")){
    el("kpiGrid").innerHTML = `
      <div class="kpi"><div class="t">Today</div><div class="v">${model.today}</div><div class="small muted">Start: ${fmt(model.cashStart)}</div></div>
      <div class="kpi"><div class="t">Next pay</div><div class="v">${model.nextPay}</div><div class="small muted">Earliest pay</div></div>
      <div class="kpi"><div class="t">By next pay</div><div class="v ${surplus1>=0?"good":"bad"}">${surplus1>=0?"+":""}${fmt(surplus1)}</div><div class="small muted">Out ≤ next: ${fmt(model.out1)}</div></div>
      <div class="kpi"><div class="t">By 2nd pay</div><div class="v ${surplus2>=0?"good":"bad"}">${surplus2>=0?"+":""}${fmt(surplus2)}</div><div class="small muted">Out ≤ 2nd: ${fmt(model.out2)}</div></div>
      <div class="kpi"><div class="t">Minimum</div><div class="v ${model.minBal>=0?"good":"bad"}">${fmt(model.minBal)}</div><div class="small muted">${model.firstNeg ? "First neg: "+model.firstNeg : "No neg in horizon"}</div></div>
      <div class="kpi"><div class="t">Horizon</div><div class="v">${st.settings.horizonDays}d</div><div class="small muted">Cycle: ${st.settings.payEveryDays}d</div></div>
    `;
  }

  // timeline
  const tbody = el("eventsTbody");
  if (tbody){
    tbody.innerHTML = "";
    (model.rows||[]).forEach(r=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.date}</td><td>${r.name}</td>
        <td class="right">${r.inflow?fmt(r.inflow):""}</td>
        <td class="right">${r.outflow?fmt(r.outflow):""}</td>
        <td class="right">${fmt(r.balance)}</td>
        <td>${r.balance<0 ? '<span class="bad">NEGATIVE</span>' : ""}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // warnings
  if (el("warnings")){
    el("warnings").innerHTML = (model.warnings && model.warnings.length)
      ? `<b>Warnings:</b><br>${model.warnings.map(w=>"- "+w).join("<br>")}`
      : "";
  }
}


/* =========================================================
   QUIZ state-machine (dynamic debts)
   cur = { stage, pi, di, field }
   history stack enables Back
   ========================================================= */
function setCur(st, cur){
  st.quiz.cur = cur;
  save(st);
}

function pushHistory(st){
  st.quiz.history.push(JSON.parse(JSON.stringify(st.quiz.cur)));
  save(st);
}
function popHistory(st){
  const prev = st.quiz.history.pop();
  save(st);
  return prev || null;
}

function startQuiz(st){
  st.mode = "setup";
  st.quiz.cur = { stage:"names", pi:0, di:0, field:"p1name" };
  st.quiz.history = [];
  save(st);
}

function stepDescriptor(st){
  const p1 = st.people[0];
  const p2 = st.people[1];

  const cur = st.quiz.cur;
  if (!cur) return null;

  // Global stages
  if (cur.stage === "names"){
    if (cur.field === "p1name") return { q:"What is Person 1 name?", reason:"Names reduce friction; math stays the same.", type:"text",
      get:()=>p1.name, set:(v)=>{p1.name=v;} };
    if (cur.field === "p2name") return { q:"What is Person 2 name?", reason:"Second income stream.", type:"text",
      get:()=>p2.name, set:(v)=>{p2.name=v;} };
  }

  if (cur.stage === "settings"){
    if (cur.field === "payEveryDays") return { q:"Pay cycle in days?", reason:"Inflow rhythm.", type:"number", min:1, max:365,
      get:()=>st.settings.payEveryDays, set:(v)=>{st.settings.payEveryDays=v;} };
    if (cur.field === "horizonDays") return { q:"Projection horizon in days?", reason:"How far ahead to check risk.", type:"number", min:14, max:365,
      get:()=>st.settings.horizonDays, set:(v)=>{st.settings.horizonDays=v;} };
    if (cur.field === "rentAmount") return { q:"Rent amount?", reason:"Largest fixed constraint.", type:"money",
      get:()=>st.shared.rentAmount, set:(v)=>{st.shared.rentAmount=v;} };
    if (cur.field === "rentDueDay") return { q:"Rent due day (1–31)?", reason:"Schedules next rent event.", type:"number", min:1, max:31,
      get:()=>st.settings.rentDueDay, set:(v)=>{st.settings.rentDueDay=v;} };
  }

  if (cur.stage === "person"){
    const p = st.people[cur.pi];
    const who = p.name || `Person ${cur.pi+1}`;

    if (cur.field === "lastPayDate") return { q:`${who}: last pay date?`, reason:"Derives next pay dates.", type:"date",
      get:()=>p.lastPayDate, set:(v)=>{p.lastPayDate=v;} };

    if (cur.field === "payAmount") return { q:`${who}: pay amount (per pay)?`, reason:"Income used to cover bills.", type:"money",
      get:()=>p.payAmount, set:(v)=>{p.payAmount=v;} };

    if (cur.field === "cash") return { q:`${who}: cash on hand (optional)?`, reason:"Starting cash improves accuracy.", type:"money", optional:true,
      get:()=>p.cash, set:(v)=>{p.cash=v;} };

    if (cur.field === "emi") return { q:`${who}: car loan/lease per pay (optional)?`, reason:"This can nullify part of each pay.", type:"money", optional:true,
      get:()=>p.perPayObligationAmount, set:(v)=>{p.perPayObligationAmount=v; p.perPayObligationLabel="Car loan/lease (per pay)";} };
  }

  if (cur.stage === "debt"){
    const p = st.people[cur.pi];
    const who = p.name || `Person ${cur.pi+1}`;
    const d = p.debts[cur.di];

    if (!d) return null;

    if (cur.field === "label") return { q:`${who}: CC/LOC #${cur.di+1} name?`, reason:"Example: AMEX, Scotia, CIBC, LOC.", type:"text",
      get:()=>d.label, set:(v)=>{d.label=v;} };

    if (cur.field === "type") return { q:`${who}: ${d.label || "Debt"} type?`, reason:"CC = pay full; LOC = minimum + borrowing option.", type:"select", options:["cc","loc"],
      get:()=>d.type, set:(v)=>{d.type=v;} };

    if (cur.field === "dueDay") return { q:`${who}: ${d.label || "Debt"} due day (1–31)?`, reason:"Schedules next due event.", type:"number", min:1, max:31,
      get:()=>d.dueDay, set:(v)=>{d.dueDay=v;} };

    if (cur.field === "apr") {
      if (d.type !== "loc") return { skip:true };
      return { q:`${who}: ${d.label || "LOC"} APR % ?`, reason:"Needed to estimate minimum and interest cost.", type:"number", min:0, max:200,
        get:()=>d.apr, set:(v)=>{d.apr=v;} };
    }

    if (cur.field === "creditLimit") {
      if (d.type !== "loc") return { skip:true };
      return { q:`${who}: ${d.label || "LOC"} credit limit?`, reason:"Borrowing capacity = limit − balance.", type:"money",
        get:()=>d.creditLimit, set:(v)=>{d.creditLimit=v;} };
    }

    if (cur.field === "balance") return {
      q:`${who}: ${d.label || "Debt"} balance / statement amount?`,
      reason: d.type === "cc" ? "CC must be paid in full by due day." : "LOC balance used to compute minimum interest-only.",
      type:"money",
      get:()=>d.balance,
      set:(v)=>{d.balance=v;}
    };

    if (cur.field === "addMore") return {
      q:`${who}: add another CC/LOC?`,
      reason:"Add only what you actually use.",
      type:"select",
      options:["no","yes"],
      get:()=> "no",
      set:(v)=>{ /* handled in advance() */ }
    };
  }

  if (cur.stage === "finish"){
    if (cur.field === "cashBuffer") return { q:"House cash buffer (optional)?", reason:"Strict decision-making: keep 0.", type:"money", optional:true,
      get:()=>st.shared.cashBuffer, set:(v)=>{st.shared.cashBuffer=v;} };
    if (cur.field === "note") return { q:"Optional note?", reason:"Context only.", type:"text", optional:true,
      get:()=>st.shared.note, set:(v)=>{st.shared.note=v;} };
    if (cur.field === "wantsFuture") return { q:"Do you have future expenses to add now?", reason:"Yes → Future page. No → Decision.", type:"select", options:["no","yes"],
      get:()=> (st.shared.wantsFuture ? "yes" : "no"), set:(v)=>{st.shared.wantsFuture=(v==="yes");} };
  }

  return null;
}

function renderQuiz(st){
  const desc = stepDescriptor(st);
  if (!desc) return;

  // auto-skip conditional loc-only fields
  if (desc.skip){
    advance(st, true);
    return;
  }

  // progress (approx; not exact step count; still useful)
  el("quizProgress").textContent = `STEP`;
  el("quizProgressFill").style.width = "0%";

  el("quizQuestion").textContent = desc.q || "";
  el("quizReason").textContent = desc.reason || "";
  el("quizNote").textContent = "";

  const wrap = el("quizInput");
  wrap.innerHTML = "";

  let input;
  if (desc.type === "select"){
    input = document.createElement("select");
    input.innerHTML = (desc.options||[]).map(o=>`<option value="${o}">${o.toUpperCase()}</option>`).join("");
    input.value = desc.get() ?? (desc.options?.[0] || "");
  } else {
    input = document.createElement("input");
    input.type = (desc.type==="date") ? "date" : (desc.type==="text" ? "text" : "number");
    if (desc.type==="money") input.step = "0.01";
    if (desc.type==="number") input.step = "1";
    if (desc.min != null) input.min = String(desc.min);
    if (desc.max != null) input.max = String(desc.max);
    input.value = desc.get() ?? "";
  }

  // prevent spill on phone
  input.style.width = "100%";
  input.style.maxWidth = "420px";
  input.style.display = "block";
  input.style.margin = "0 auto";

  wrap.appendChild(input);

  el("quizBack").disabled = (st.quiz.history.length === 0);
  el("quizNext").textContent = "Next";
}

function commitQuiz(st){
  const desc = stepDescriptor(st);
  if (!desc || desc.skip) return true;

  const control = el("quizInput").querySelector("input, select");
  if (!control) return true;

  let v = control.value;

  if (desc.type === "money" || desc.type === "number"){
    v = Number(v || 0);
  }

  if (!desc.optional){
    if (desc.type==="text" && String(v).trim()===""){ el("quizNote").textContent = "Required."; return false; }
    if (desc.type==="date" && String(v).trim()===""){ el("quizNote").textContent = "Pick a date."; return false; }
  }

  desc.set(v);
  save(st);
  return true;
}

function advance(st, autoSkip=false){
  const cur = st.quiz.cur;

  // if skipping, do not push history
  if (!autoSkip) pushHistory(st);

  // stage transitions
  if (cur.stage === "names"){
    if (cur.field === "p1name"){ cur.field = "p2name"; setCur(st, cur); return; }
    if (cur.field === "p2name"){ setCur(st, { stage:"settings", pi:0, di:0, field:"payEveryDays" }); return; }
  }

  if (cur.stage === "settings"){
    if (cur.field === "payEveryDays"){ cur.field="horizonDays"; setCur(st, cur); return; }
    if (cur.field === "horizonDays"){ cur.field="rentAmount"; setCur(st, cur); return; }
    if (cur.field === "rentAmount"){ cur.field="rentDueDay"; setCur(st, cur); return; }
    if (cur.field === "rentDueDay"){ setCur(st, { stage:"person", pi:0, di:0, field:"lastPayDate" }); return; }
  }

  if (cur.stage === "person"){
    if (cur.field === "lastPayDate"){ cur.field="payAmount"; setCur(st, cur); return; }
    if (cur.field === "payAmount"){ cur.field="cash"; setCur(st, cur); return; }
    if (cur.field === "cash"){ cur.field="emi"; setCur(st, cur); return; }
    if (cur.field === "emi"){
      // go to debts for this person
      setCur(st, { stage:"debt", pi:cur.pi, di:0, field:"label" });
      return;
    }
  }

  if (cur.stage === "debt"){
    const p = st.people[cur.pi];
    const d = p.debts[cur.di];

    if (cur.field === "label"){ cur.field="type"; setCur(st, cur); return; }
    if (cur.field === "type"){ cur.field="dueDay"; setCur(st, cur); return; }
    if (cur.field === "dueDay"){ cur.field="apr"; setCur(st, cur); return; }
    if (cur.field === "apr"){ cur.field="creditLimit"; setCur(st, cur); return; }
    if (cur.field === "creditLimit"){ cur.field="balance"; setCur(st, cur); return; }
    if (cur.field === "balance"){ cur.field="addMore"; setCur(st, cur); return; }

    if (cur.field === "addMore"){
      const control = el("quizInput").querySelector("select");
      const ans = control ? control.value : "no";

      if (ans === "yes"){
        // add another debt and loop
        p.debts.push({ id: crypto.randomUUID(), label:"New debt", type:"cc", dueDay:0, balance:0, apr:0, creditLimit:0 });
        save(st);
        setCur(st, { stage:"debt", pi:cur.pi, di:p.debts.length-1, field:"label" });
        return;
      }

      // move to next person or finish
      if (cur.pi === 0){
        setCur(st, { stage:"person", pi:1, di:0, field:"lastPayDate" });
        return;
      } else {
        setCur(st, { stage:"finish", pi:0, di:0, field:"cashBuffer" });
        return;
      }
    }
  }

  if (cur.stage === "finish"){
    if (cur.field === "cashBuffer"){ cur.field="note"; setCur(st, cur); return; }
    if (cur.field === "note"){ cur.field="wantsFuture"; setCur(st, cur); return; }
    if (cur.field === "wantsFuture"){
      // Finish → run mode
      st.mode = "run";
      save(st);
      boot();
      if (st.shared.wantsFuture) showTab("future");
      else showTab("results");
      return;
    }
  }
}

function goBack(st){
  const prev = popHistory(st);
  if (!prev) return;
  setCur(st, prev);
}

/* =========================================================
   Buttons
   ========================================================= */
function wireButtons(){
  // Quiz buttons
  el("quizBack").onclick = ()=>{
    const st = migrate(load() || defaultState());
    goBack(st);
    renderQuiz(st);
  };

  el("quizNext").onclick = ()=>{
    const st = migrate(load() || defaultState());
    if (!commitQuiz(st)) return;
    advance(st, false);
    renderQuiz(st);
  };

  // Compute
  el("btnCompute").onclick = ()=>{
    const st = migrate(load() || defaultState());
    st.shared.rentAmount = Number(el("rentAmount").value||0);
    st.shared.cashBuffer = Number(el("cashBuffer").value||0);
    st.shared.note = el("note").value || "";
    save(st);

    const model = compute(st);
    renderResults(st, model);
    showTab("results");
  };

  // Add future
  el("btnAddFuture").onclick = ()=>{
    const st = migrate(load() || defaultState());
    const d = el("fDate").value;
    const a = Number(el("fAmount").value||0);
    const l = el("fLabel").value || "";
    if (!d || !a) return;
    st.future.push({ date:d, amount:a, label:l });
    save(st);
    el("fDate").value=""; el("fAmount").value=""; el("fLabel").value="";
    boot();
    showTab("future");
  };

  // Toggle timeline
  el("btnToggleDetails").onclick = ()=>{
  const wrap = el("detailsWrap");
  wrap.classList.toggle("hidden");
  el("btnToggleDetails").textContent = wrap.classList.contains("hidden") ? "Show details" : "Hide details";
  };


  // Export/Import/Reset
  el("btnExport").onclick = ()=>{
    const st = migrate(load() || defaultState());
    const blob = new Blob([JSON.stringify(st,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cashflow-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  el("importFile").addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    const st = migrate(JSON.parse(txt));
    save(st);
    boot();
    e.target.value = "";
  });

  el("btnResetAll").onclick = ()=>{
    if (!confirm("Delete local data on this device?")) return;
    localStorage.removeItem(LS);
    location.reload();
  };
}

/* =========================================================
   Boot
   ========================================================= */
function boot(){
  let st = migrate(load() || defaultState());
  save(st);

  document.documentElement.setAttribute("data-theme", st.theme || "dark");

  renderToday(st);
  renderFuture(st);
  renderSettings(st);

  const model = compute(st);
  renderResults(st, model);

  if (st.mode === "setup"){
    el("tabBtnToday").disabled = true;
    el("tabBtnFuture").disabled = true;
    el("tabBtnResults").disabled = true;
    el("tabBtnSettings").disabled = true;

    showTab("setup");

    // initialize quiz cursor if missing
    if (!st.quiz.cur){
      startQuiz(st);
    } else {
      save(st);
    }
    renderQuiz(st);

  } else {
    el("tabBtnToday").disabled = false;
    el("tabBtnFuture").disabled = false;
    el("tabBtnResults").disabled = false;
    el("tabBtnSettings").disabled = false;

    showTab("results");
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
}

/* =========================================================
   Init
   ========================================================= */
(function init(){
  mountTabs();
  mountDrawer();
  mountTheme();
  attachInputHandlers();
  wireButtons();

  let st = migrate(load() || defaultState());

  // Force setup after codebase change (prevents blank quiz)
  if (st.mode !== "setup" && st.mode !== "run") st.mode = "setup";
  if (!st.quiz || !st.quiz.cur) {
    st.mode = "setup";
    st.quiz = { cur: null, history: [] };
  }
  save(st);

  boot();
})();
