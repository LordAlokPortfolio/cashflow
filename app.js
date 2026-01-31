const LS = "cashflow_npeople_v1";

/* ---------- DOM helpers ---------- */
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const el = (id) => document.getElementById(id);

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

function defaultState(){
  const td = new Date(); td.setHours(0,0,0,0);
  const fallback = toISO(addDays(td, -14));
  return {
    theme: "dark",
    mode: "setup",         // setup -> run
    quizStep: 0,
    settings: {
      payEveryDays: 14,
      horizonDays: 90,
      rentDueDay: 28
    },
    shared: {
      rentAmount: 0,
      cashBuffer: 0,
      note: ""
    },
    people: [
      {
        id: crypto.randomUUID(),
        name: "Person 1",
        lastPayDate: fallback,
        payAmount: 0,
        cash: 0,
        perPayObligationLabel: "Per-pay obligation",
        perPayObligationAmount: 0,
        debts: [
          { id: crypto.randomUUID(), label: "Card 1", type: "cc", dueDay: 16, balance: 0, apr: 0 },
          { id: crypto.randomUUID(), label: "LOC", type: "loc", dueDay: 8, balance: 0, apr: 0 }
        ]
      },
      {
        id: crypto.randomUUID(),
        name: "Person 2",
        lastPayDate: fallback,
        payAmount: 0,
        cash: 0,
        perPayObligationLabel: "Per-pay obligation",
        perPayObligationAmount: 0,
        debts: [
          { id: crypto.randomUUID(), label: "Card 1", type: "cc", dueDay: 5, balance: 0, apr: 0 }
        ]
      }
    ],
    future: []
  };
}

/* ---------- tabs/drawer/theme ---------- */
function mountTabs(){
  qsa(".seg button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const tab = btn.dataset.tab;
      qsa(".seg button").forEach(b=>b.classList.toggle("active", b===btn));
      ["setup","today","future","results","settings"].forEach(t=>{
        el("tab-"+t).classList.toggle("hidden", t !== tab);
      });
    });
  });
}

function showTab(tab){
  qsa(".seg button").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  ["setup","today","future","results","settings"].forEach(t=>{
    el("tab-"+t).classList.toggle("hidden", t !== tab);
  });
}

function mountDrawer(){
  const open = ()=>{ el("drawer").classList.remove("hidden"); el("backdrop").classList.remove("hidden"); };
  const close = ()=>{ el("drawer").classList.add("hidden"); el("backdrop").classList.add("hidden"); };
  el("btnSidebar").addEventListener("click", open);
  el("btnCloseDrawer").addEventListener("click", close);
  el("backdrop").addEventListener("click", close);
}

function mountTheme(st){
  const apply = (t)=> document.documentElement.setAttribute("data-theme", t);
  apply(st.theme || "dark");
  el("btnTheme").addEventListener("click", ()=>{
    const s = load() || defaultState();
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = (cur === "dark") ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    s.theme = next;
    save(s);
  });
}

/* ---------- render Today/Future/Settings ---------- */
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
          <label>Cash on hand (optional)</label>
          <input data-p="${p.id}" data-k="cash" type="number" step="0.01" value="${p.cash || 0}">
        </div>
      </div>
      <div class="divider"></div>
      <div class="muted small" style="margin-bottom:8px;">Debts (statement balances)</div>
      <div class="grid" data-debts="${p.id}"></div>
      <div class="divider"></div>
      <div class="grid">
        <div class="field">
          <label>${p.perPayObligationLabel}</label>
          <input data-p="${p.id}" data-k="perPayObligationAmount" type="number" step="0.01" value="${p.perPayObligationAmount || 0}">
        </div>
      </div>
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
      <td class="right"><button class="btn danger ios6-btn danger" data-del="${i}" style="padding:8px 10px;">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const st2 = load() || defaultState();
      st2.future.splice(Number(btn.dataset.del), 1);
      save(st2);
      renderFuture(st2);
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
        <button class="btn danger ios6-btn danger" data-delperson="${p.id}">Delete</button>
      </div>

      <div class="grid">
        <div class="field">
          <label>Name</label>
          <input data-p="${p.id}" data-k="name" type="text" value="${p.name}">
        </div>
        <div class="field">
          <label>Per-pay obligation label</label>
          <input data-p="${p.id}" data-k="perPayObligationLabel" type="text" value="${p.perPayObligationLabel || "Per-pay obligation"}">
        </div>
        <div class="field">
          <label>Per-pay obligation amount</label>
          <input data-p="${p.id}" data-k="perPayObligationAmount" type="number" step="0.01" value="${p.perPayObligationAmount || 0}">
        </div>
      </div>

      <div class="divider"></div>
      <div class="section-title">
        <div class="h">Debts</div>
        <button class="btn ios6-btn" data-adddebt="${p.id}">Add debt</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th style="width:90px;">Type</th>
            <th style="width:90px;">Due</th>
            <th style="width:100px;">APR%</th>
            <th style="width:140px;" class="right">Balance</th>
            <th style="width:110px;"></th>
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
        <td class="right"><button class="btn danger ios6-btn danger" data-deldebt="${p.id}:${d.id}" style="padding:8px 10px;">Delete</button></td>
      `;
      dt.appendChild(tr);
    });

    card.querySelectorAll("button[data-deldebt]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const [pid, did] = b.dataset.deldebt.split(":");
        const st2 = load() || defaultState();
        const p2 = st2.people.find(x=>x.id===pid);
        p2.debts = p2.debts.filter(x=>x.id!==did);
        save(st2);
        boot();
      });
    });

    card.querySelector("button[data-adddebt]").addEventListener("click", ()=>{
      const st2 = load() || defaultState();
      const p2 = st2.people.find(x=>x.id===p.id);
      p2.debts.push({ id: crypto.randomUUID(), label:"New debt", type:"cc", dueDay:0, balance:0, apr:0 });
      save(st2);
      boot();
    });

    card.querySelector("button[data-delperson]").addEventListener("click", ()=>{
      const st2 = load() || defaultState();
      st2.people = st2.people.filter(x=>x.id!==p.id);
      save(st2);
      boot();
    });
  });

  el("btnAddPerson").onclick = ()=>{
    const st2 = load() || defaultState();
    st2.people.push({
      id: crypto.randomUUID(),
      name: `Person ${st2.people.length+1}`,
      lastPayDate: toISO(addDays(new Date(), -14)),
      payAmount: 0,
      cash: 0,
      perPayObligationLabel: "Per-pay obligation",
      perPayObligationAmount: 0,
      debts: [{ id: crypto.randomUUID(), label:"Card 1", type:"cc", dueDay:0, balance:0, apr:0 }]
    });
    save(st2);
    boot();
  };
}

/* ---------- input handlers (unchanged core storage behavior) ---------- */
function attachInputHandlers(){
  document.body.addEventListener("input", (e)=>{
    const t = e.target;
    const st = load() || defaultState();

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

/* ---------- CORE engine (unchanged decision semantics) ---------- */
function compute(st){
  const today = new Date(); today.setHours(0,0,0,0);
  const every = st.settings.payEveryDays || 14;
  const horizon = st.settings.horizonDays || 90;

  const events = [];
  const warnings = [];

  let cashStart = (st.shared.cashBuffer || 0);
  st.people.forEach(p=> cashStart += (p.cash || 0));

  // Pay streams and per-pay obligations
  st.people.forEach(p=>{
    const lp = parseISO(p.lastPayDate);
    if (!lp) { warnings.push(`${p.name}: missing last pay date`); return; }
    let pay = nextPayFromLast(today, lp, every);
    while (pay <= addDays(today, horizon)){
      events.push({ date: toISO(pay), name: `${p.name} pay`, inflow: Number(p.payAmount||0), outflow: 0 });
      if ((p.perPayObligationAmount||0) > 0){
        events.push({ date: toISO(pay), name: `${p.name}: ${p.perPayObligationLabel}`, inflow: 0, outflow: Number(p.perPayObligationAmount||0) });
      }
      pay = addDays(pay, every);
    }
  });

  // Shared rent (next occurrence only; user re-enters each month if needed)
  const rentDue = nextDueByDay(today, st.settings.rentDueDay);
  if (rentDue && (st.shared.rentAmount||0) > 0){
    events.push({ date: toISO(rentDue), name: `Rent`, inflow: 0, outflow: Number(st.shared.rentAmount||0) });
  }

  // Debts due: CC full; LOC minimum interest-only
  st.people.forEach(p=>{
    p.debts.forEach(d=>{
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

  // Future expenses
  (st.future||[]).forEach(x=>{
    if (x?.date && Number(x.amount||0) !== 0){
      events.push({ date: x.date, name: `Future: ${x.label||"Expense"}`, inflow: 0, outflow: Number(x.amount||0) });
    }
  });

  // Sort
  events.sort((a,b)=>{
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (b.inflow - a.inflow) || (a.outflow - b.outflow);
  });

  // Walk
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

  return {
    today: toISO(today),
    cashStart,
    nextPay: toISO(nextPay),
    nextPay2: toISO(nextPay2),
    inflow1, out1, inflow2, out2,
    rows,
    minBal,
    firstNeg,
    firstNegRow,
    warnings
  };
}

function renderResults(st, model){
  // DECISION
  let verdict = "SAFE";
  let reason = "All required bills can be paid on time with current inputs.";
  let action = "Proceed normally.";

  if (model.firstNegRow){
    verdict = "UNSAFE";
    const shortBy = Math.abs(model.firstNegRow.balance);
    reason = `Blocking event: ${model.firstNegRow.name} on ${model.firstNegRow.date}. Short by $${fmt(shortBy)}.`;
    action = `Action: bridge $${fmt(shortBy)} until next pay or reduce/shift a bill before ${model.firstNegRow.date}.`;
  }

  el("decisionCard").innerHTML = `
    <div class="kpi" style="grid-column: span 3;">
      <div class="t">Decision</div>
      <div class="v ${verdict==="SAFE" ? "good" : "bad"}">${verdict}</div>
      <div class="small">${reason}</div>
      <div class="small">${action}</div>
    </div>
  `;

  const surplus1 = (model.cashStart + model.inflow1) - model.out1;
  const surplus2 = (model.cashStart + model.inflow2) - model.out2;

  el("kpiGrid").innerHTML = `
    <div class="kpi"><div class="t">Today</div><div class="v">${model.today}</div><div class="small muted">Starting cash: ${fmt(model.cashStart)}</div></div>
    <div class="kpi"><div class="t">Next pay (house)</div><div class="v">${model.nextPay}</div><div class="small muted">Earliest next pay</div></div>
    <div class="kpi"><div class="t">By next pay</div><div class="v ${surplus1>=0?"good":"bad"}">${surplus1>=0?"+":""}${fmt(surplus1)}</div><div class="small muted">Outflows ≤ next pay: ${fmt(model.out1)}</div></div>
    <div class="kpi"><div class="t">By 2nd pay</div><div class="v ${surplus2>=0?"good":"bad"}">${surplus2>=0?"+":""}${fmt(surplus2)}</div><div class="small muted">Outflows ≤ 2nd pay: ${fmt(model.out2)}</div></div>
    <div class="kpi"><div class="t">Minimum balance</div><div class="v ${model.minBal>=0?"good":"bad"}">${fmt(model.minBal)}</div><div class="small muted">${model.firstNeg ? "First negative: "+model.firstNeg : "No negative in horizon"}</div></div>
    <div class="kpi"><div class="t">Horizon</div><div class="v">${st.settings.horizonDays}d</div><div class="small muted">Pay cycle: ${st.settings.payEveryDays}d</div></div>
  `;

  const tbody = el("eventsTbody");
  tbody.innerHTML = "";
  model.rows.forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.name}</td>
      <td class="right">${r.inflow?fmt(r.inflow):""}</td>
      <td class="right">${r.outflow?fmt(r.outflow):""}</td>
      <td class="right">${fmt(r.balance)}</td>
      <td>${r.balance<0 ? '<span class="bad">NEGATIVE</span>' : ""}</td>
    `;
    tbody.appendChild(tr);
  });

  el("warnings").innerHTML = model.warnings.length
    ? `<b>Warnings:</b><br>${model.warnings.map(w=>"- "+w).join("<br>")}`
    : "";
}

/* ---------- export/import ---------- */
function exportJSON(){
  const st = load() || defaultState();
  const blob = new Blob([JSON.stringify(st,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cashflow-backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importJSON(file){
  const txt = await file.text();
  const st = JSON.parse(txt);
  save(st);
  boot();
}

/* ---------- QUIZ (Setup Wizard) ---------- */
/*
  First version: asks EVERYTHING in quiz format, then jumps to Results.
  It writes directly into the same state the engine already uses.
*/
function buildQuiz(st){
  const p1 = st.people[0];
  const p2 = st.people[1];

  // helper: ensure at least 2 people exist
  while (st.people.length < 2){
    st.people.push({
      id: crypto.randomUUID(),
      name: `Person ${st.people.length+1}`,
      lastPayDate: toISO(addDays(new Date(), -14)),
      payAmount: 0,
      cash: 0,
      perPayObligationLabel: "Per-pay obligation",
      perPayObligationAmount: 0,
      debts: [{ id: crypto.randomUUID(), label:"Card 1", type:"cc", dueDay:0, balance:0, apr:0 }]
    });
  }

  const steps = [
    // Household basics
    { key:"people.0.name", type:"text", q:"What is Person 1 name?", reason:"Names reduce friction. Labels don’t change math." },
    { key:"people.1.name", type:"text", q:"What is Person 2 name?", reason:"Same engine, different boundary conditions." },

    { key:"settings.payEveryDays", type:"number", q:"Pay cycle in days?", reason:"Your inflow rhythm.", min:1, preset:14 },
    { key:"settings.horizonDays", type:"number", q:"Projection horizon in days?", reason:"How far ahead to check risk.", min:14, preset:90 },

    // Rent
    { key:"shared.rentAmount", type:"money", q:"Rent amount?", reason:"Rent is usually the dominant fixed constraint." },
    { key:"settings.rentDueDay", type:"number", q:"Rent due day (1–31)?", reason:"Used to schedule the next rent event.", min:1, max:31, preset:28 },

    // Person 1 pay + cash
    { key:"people.0.lastPayDate", type:"date", q:"Person 1 last pay date?", reason:"All future pay dates derive from this." },
    { key:"people.0.payAmount", type:"money", q:"Person 1 pay amount (per pay)?", reason:"Primary inflow." },
    { key:"people.0.cash", type:"money", q:"Person 1 cash on hand (optional)?", reason:"Starting buffer improves accuracy.", optional:true },

    // Person 1 per-pay obligation
    { key:"people.0.perPayObligationLabel", type:"text", q:"Person 1 per-pay obligation label?", reason:"Example: car loan, lease, etc.", preset:"Car loan" },
    { key:"people.0.perPayObligationAmount", type:"money", q:"Person 1 per-pay obligation amount?", reason:"Deducted every pay date.", preset:0 },

    // Person 1 Debt 1 (CC)
    { key:"people.0.debts.0.label", type:"text", q:"Person 1 Card #1 name?", reason:"Example: AMEX, Scotia, CIBC." , preset:"AMEX"},
    { key:"people.0.debts.0.type", type:"select", q:"Person 1 Card #1 type?", reason:"CC must be paid in full by due day.", options:["cc","loc"], preset:"cc"},
    { key:"people.0.debts.0.dueDay", type:"number", q:"Person 1 Card #1 due day (1–31)?", reason:"Used for the next due event.", min:1, max:31, preset:16 },
    { key:"people.0.debts.0.apr", type:"number", q:"APR% (only matters if LOC)", reason:"LOC minimum = interest-only.", preset:0 },
    { key:"people.0.debts.0.balance", type:"money", q:"Statement/balance amount?", reason:"Amount due on the due day.", preset:0 },

    // Person 1 Debt 2 (LOC default exists)
    { key:"people.0.debts.1.label", type:"text", q:"Person 1 Debt #2 name?", reason:"Example: LOC.", preset:"LOC" },
    { key:"people.0.debts.1.type", type:"select", q:"Person 1 Debt #2 type?", reason:"LOC treated as minimum interest-only.", options:["cc","loc"], preset:"loc"},
    { key:"people.0.debts.1.dueDay", type:"number", q:"Person 1 Debt #2 due day (1–31)?", reason:"Used for the next due event.", min:1, max:31, preset:8 },
    { key:"people.0.debts.1.apr", type:"number", q:"APR% for LOC?", reason:"Required for LOC minimum payment.", preset:9 },
    { key:"people.0.debts.1.balance", type:"money", q:"LOC balance?", reason:"Used to compute interest-only minimum.", preset:0 },

    // Person 2 pay + cash
    { key:"people.1.lastPayDate", type:"date", q:"Person 2 last pay date?", reason:"Second inflow stream." },
    { key:"people.1.payAmount", type:"money", q:"Person 2 pay amount (per pay)?", reason:"Second inflow stream." },
    { key:"people.1.cash", type:"money", q:"Person 2 cash on hand (optional)?", reason:"Starting buffer improves accuracy.", optional:true },

    // Person 2 per-pay obligation
    { key:"people.1.perPayObligationLabel", type:"text", q:"Person 2 per-pay obligation label?", reason:"Example: car lease.", preset:"Car lease" },
    { key:"people.1.perPayObligationAmount", type:"money", q:"Person 2 per-pay obligation amount?", reason:"Deducted every pay date.", preset:0 },

    // Person 2 Debt 1
    { key:"people.1.debts.0.label", type:"text", q:"Person 2 Card #1 name?", reason:"Example: CIBC, Scotia.", preset:"CIBC" },
    { key:"people.1.debts.0.type", type:"select", q:"Person 2 Card #1 type?", reason:"CC must be paid in full by due day.", options:["cc","loc"], preset:"cc"},
    { key:"people.1.debts.0.dueDay", type:"number", q:"Person 2 Card #1 due day (1–31)?", reason:"Used for the next due event.", min:1, max:31, preset:5 },
    { key:"people.1.debts.0.apr", type:"number", q:"APR% (only matters if LOC)", reason:"Leave 0 if CC.", preset:0 },
    { key:"people.1.debts.0.balance", type:"money", q:"Statement balance?", reason:"Amount due on the due day.", preset:0 },

    // Shared extras
    { key:"shared.cashBuffer", type:"money", q:"House cash buffer (optional)?", reason:"If you want the app to be strict, keep 0.", optional:true },
    { key:"shared.note", type:"text", q:"Optional note?", reason:"For your own context.", optional:true, preset:"" },
  ];

  return steps;
}

function getByPath(obj, path){
  return path.split(".").reduce((acc, k)=> (acc==null ? acc : acc[k]), obj);
}
function setByPath(obj, path, value){
  const parts = path.split(".");
  let cur = obj;
  for (let i=0; i<parts.length-1; i++){
    const key = parts[i];
    if (cur[key] == null) cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length-1]] = value;
}

function ensureDebts(st){
  // ensure default debts exist for first 2 people
  for (let i=0;i<2;i++){
    if (!st.people[i].debts) st.people[i].debts = [];
    while (st.people[i].debts.length < 2 && i===0){
      st.people[i].debts.push({ id: crypto.randomUUID(), label:"New debt", type:"cc", dueDay:0, balance:0, apr:0 });
    }
    while (st.people[i].debts.length < 1 && i===1){
      st.people[i].debts.push({ id: crypto.randomUUID(), label:"New debt", type:"cc", dueDay:0, balance:0, apr:0 });
    }
  }
}

function renderQuiz(st){
  ensureDebts(st);
  const steps = buildQuiz(st);
  const i = Math.max(0, Math.min(st.quizStep || 0, steps.length-1));
  st.quizStep = i;
  save(st);

  const step = steps[i];
  el("quizProgress").textContent = `Step ${i+1} of ${steps.length}`;
  el("quizProgressFill").style.width = `${Math.round(((i+1)/steps.length)*100)}%`;
  el("quizQuestion").textContent = step.q;
  el("quizReason").textContent = step.reason || "";

  const inputWrap = el("quizInput");
  inputWrap.innerHTML = "";

  const currentVal = getByPath(st, step.key);
  const preset = (currentVal == null || currentVal === "" || (typeof currentVal === "number" && isNaN(currentVal)))
    ? (step.preset ?? currentVal)
    : currentVal;

  let inputEl;

  if (step.type === "select"){
    inputEl = document.createElement("select");
    inputEl.className = "ios6-input";
    inputEl.innerHTML = step.options.map(o=>`<option value="${o}">${o.toUpperCase()}</option>`).join("");
    inputEl.value = preset ?? step.options[0];
  } else {
    inputEl = document.createElement("input");
    inputEl.type = (step.type === "date") ? "date" : (step.type === "text" ? "text" : "number");
    if (step.type === "money") inputEl.step = "0.01";
    if (step.type === "number") inputEl.step = "1";
    if (step.min != null) inputEl.min = String(step.min);
    if (step.max != null) inputEl.max = String(step.max);
    inputEl.value = (preset ?? (step.type==="date" ? "" : 0));
  }

  inputEl.style.width = "100%";
  inputEl.style.padding = "11px 12px";
  inputEl.style.borderRadius = "14px";
  inputEl.style.border = "1px solid var(--stroke)";
  inputEl.style.background = "rgba(0,0,0,.12)";
  inputEl.style.color = "var(--text)";

  inputWrap.appendChild(inputEl);

  el("quizBack").disabled = (i===0);
  el("quizNext").textContent = (i === steps.length-1) ? "Finish" : "Next";

  el("quizNote").textContent = "";
}

function commitQuizAnswer(st){
  const steps = buildQuiz(st);
  const i = st.quizStep || 0;
  const step = steps[i];
  const inputWrap = el("quizInput");
  const control = inputWrap.querySelector("input, select");
  if (!control) return true;

  let val = control.value;

  if (step.type === "money" || step.type === "number"){
    val = Number(val || 0);
  }

  if (step.type === "date"){
    val = (val || "");
  }

  // optional field allows blank; else require something sensible
  if (!step.optional){
    if (step.type === "text" && String(val).trim() === ""){
      el("quizNote").innerHTML = `<span class="bad">Required.</span>`;
      return false;
    }
    if ((step.type === "money" || step.type === "number") && (val == null || isNaN(val))){
      el("quizNote").innerHTML = `<span class="bad">Enter a number.</span>`;
      return false;
    }
    if (step.type === "date" && String(val).trim() === ""){
      el("quizNote").innerHTML = `<span class="bad">Pick a date.</span>`;
      return false;
    }
  }

  setByPath(st, step.key, val);
  save(st);
  return true;
}

function finishQuiz(st){
  st.mode = "run";
  st.quizStep = 0;
  save(st);

  // Render normal UI and jump straight to Results with decision
  boot();
  const model = compute(st);
  renderResults(st, model);
  showTab("results");
}

/* ---------- buttons ---------- */
function wireButtons(){
  el("btnCompute").onclick = ()=>{
    const st = load() || defaultState();
    st.shared.rentAmount = Number(el("rentAmount").value||0);
    st.shared.cashBuffer = Number(el("cashBuffer").value||0);
    st.shared.note = el("note").value || "";
    save(st);

    const model = compute(st);
    renderResults(st, model);
    showTab("results");
  };

  el("btnSave").onclick = ()=>{ /* saved on input */ };

  el("btnExport").onclick = ()=>{
    const st = load() || defaultState();
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
    const st = JSON.parse(txt);
    save(st);
    boot();
    e.target.value = "";
  });

  el("btnAddFuture").onclick = ()=>{
    const st = load() || defaultState();
    const d = el("fDate").value;
    const a = Number(el("fAmount").value||0);
    const l = el("fLabel").value || "";
    if (!d || !a) return;
    st.future.push({ date:d, amount:a, label:l });
    save(st);
    el("fDate").value=""; el("fAmount").value=""; el("fLabel").value="";
    renderFuture(st);
  };

  el("btnWhatIf").onclick = ()=>{
    const st = load() || defaultState();
    const model = compute(st);
    const d = el("wDate").value;
    const a = Number(el("wAmount").value||0);
    if (!d || !a){ el("whatIfOut").textContent = "Enter date and amount."; return; }

    let bal = model.cashStart;
    model.rows.forEach(r=>{
      if (new Date(r.date) <= new Date(d)) bal += (r.inflow||0) - (r.outflow||0);
    });
    bal -= a;

    el("whatIfOut").innerHTML = bal>=0
      ? `<span class="good">Safe.</span> Balance after purchase: <b>${fmt(bal)}</b>`
      : `<span class="bad">Not safe.</span> Short by <b>${fmt(Math.abs(bal))}</b>`;
  };

  el("btnToggleTable").onclick = ()=> el("timelineWrap").classList.toggle("hidden");

  el("btnResetAll").onclick = ()=>{
    if (!confirm("Delete local data on this device?")) return;
    localStorage.removeItem(LS);
    location.reload();
  };

  // Quiz nav
  el("quizBack").onclick = ()=>{
    const st = load() || defaultState();
    if (st.quizStep > 0) st.quizStep -= 1;
    save(st);
    renderQuiz(st);
  };

  el("quizNext").onclick = ()=>{
    const st = load() || defaultState();
    if (!commitQuizAnswer(st)) return;

    const steps = buildQuiz(st);
    if ((st.quizStep || 0) >= steps.length-1){
      finishQuiz(st);
      return;
    }
    st.quizStep = (st.quizStep || 0) + 1;
    save(st);
    renderQuiz(st);
  };
}

/* ---------- boot ---------- */
function boot(){
  let st = load();
  if (!st) st = defaultState();

  document.documentElement.setAttribute("data-theme", st.theme || "dark");

  // settings fields
  el("payEveryDays").value = st.settings.payEveryDays;
  el("horizonDays").value = st.settings.horizonDays;
  el("rentDueDay").value = st.settings.rentDueDay;

  // shared
  el("rentAmount").value = st.shared.rentAmount || 0;
  el("cashBuffer").value = st.shared.cashBuffer || 0;
  el("note").value = st.shared.note || "";

  renderToday(st);
  renderFuture(st);
  renderSettings(st);

  // compute once
  const model = compute(st);
  renderResults(st, model);

  // service worker
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");

  // mode routing
  if (st.mode === "setup"){
    // hide non-setup tabs (optional; but keeps focus)
    el("tabBtnToday").disabled = true;
    el("tabBtnFuture").disabled = true;
    el("tabBtnResults").disabled = true;
    el("tabBtnSettings").disabled = true;

    showTab("setup");
    renderQuiz(st);
  } else {
    el("tabBtnToday").disabled = false;
    el("tabBtnFuture").disabled = false;
    el("tabBtnResults").disabled = false;
    el("tabBtnSettings").disabled = false;

    // start on Results (decision-first)
    showTab("results");
  }
}

function mountTabsAndNav(){
  mountTabs();
  mountDrawer();
}

(function init(){
  mountTabsAndNav();
  attachInputHandlers();

  let st = load();
  if (!st) st = defaultState();

  mountTheme(st);
  save(st);
  wireButtons();
  boot();
})();