/* =========================================================
   House Cashflow — Decision Maker Engine (Feynman version)
   - Goal: decide "Can I pay the NEXT required bills?" (SAFE/UNSAFE)
   - CC: pay FULL statement on due day
   - LOC: minimum = interest-only (APR required); LOC creditLimit enables bridge advice
   - No storytelling. One blocking date. One action.
   ========================================================= */

const LS = "cashflow_npeople_v2";

const qs = (sel) => document.querySelector(sel);
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
function save(st){
  localStorage.setItem(LS, JSON.stringify(st));
}

/* ---------- default state ---------- */
function defaultState(){
  const td = new Date(); td.setHours(0,0,0,0);
  const fallback = toISO(addDays(td, -14));

  return {
    theme: "dark",
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
          // creditLimit is important for decision-maker bridging
          { id: crypto.randomUUID(), label: "Card 1", type: "cc", dueDay: 16, balance: 0, apr: 0, creditLimit: 0 },
          { id: crypto.randomUUID(), label: "LOC", type: "loc", dueDay: 8, balance: 0, apr: 0, creditLimit: 0 }
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
          { id: crypto.randomUUID(), label: "Card 1", type: "cc", dueDay: 5, balance: 0, apr: 0, creditLimit: 0 }
        ]
      }
    ],
    future: []
  };
}

/* =========================================================
   UI wiring (tabs / drawer / theme)
   ========================================================= */
function mountTabs(){
  qsa(".seg button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const tab = btn.dataset.tab;
      qsa(".seg button").forEach(b=>b.classList.toggle("active", b===btn));
      ["today","future","results","settings"].forEach(t=>{
        const sec = el("tab-"+t);
        if (sec) sec.classList.toggle("hidden", t !== tab);
      });
    });
  });
}

function showTab(tab){
  qsa(".seg button").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  ["today","future","results","settings"].forEach(t=>{
    const sec = el("tab-"+t);
    if (sec) sec.classList.toggle("hidden", t !== tab);
  });
}

function mountDrawer(){
  const open = ()=>{
    el("drawer")?.classList.remove("hidden");
    el("backdrop")?.classList.remove("hidden");
  };
  const close = ()=>{
    el("drawer")?.classList.add("hidden");
    el("backdrop")?.classList.add("hidden");
  };
  el("btnSidebar")?.addEventListener("click", open);
  el("btnCloseDrawer")?.addEventListener("click", close);
  el("backdrop")?.addEventListener("click", close);
}

function mountTheme(st){
  document.documentElement.setAttribute("data-theme", st.theme || "dark");
  el("btnTheme")?.addEventListener("click", ()=>{
    const s = load() || defaultState();
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = (cur === "dark") ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    s.theme = next;
    save(s);
  });
}

/* =========================================================
   TODAY screen rendering (dynamic inputs users actually change)
   - Keep it simple: Pay dates/amount, cash, balances
   ========================================================= */
function renderToday(st){
  const root = el("peopleToday");
  if (!root) return;
  root.innerHTML = "";

  // Show first 2 on Today for simplicity (Settings supports N)
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
    `;

    root.appendChild(wrap);

    const debtsGrid = wrap.querySelector(`[data-debts="${p.id}"]`);
    debtsGrid.innerHTML = "";

    p.debts.forEach(d=>{
      const box = document.createElement("div");
      box.className = "field";
      box.innerHTML = `
        <label>${d.label} (${String(d.type||"").toUpperCase()})</label>
        <input data-p="${p.id}" data-debt="${d.id}" data-k="balance" type="number" step="0.01" value="${d.balance || 0}">
      `;
      debtsGrid.appendChild(box);
    });
  });

  // Shared inputs
  el("rentAmount").value = st.shared.rentAmount || 0;
  el("cashBuffer").value = st.shared.cashBuffer || 0;
  el("note").value = st.shared.note || "";
}

/* =========================================================
   FUTURE expenses
   ========================================================= */
function renderFuture(st){
  const tbody = el("futureTbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  st.future.sort((a,b)=>a.date.localeCompare(b.date)).forEach((it, i)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.date}</td>
      <td>${it.label || ""}</td>
      <td class="right">${fmt(it.amount)}</td>
      <td class="right"><button class="btn danger" data-del="${i}" style="padding:8px 10px;">Delete</button></td>
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

/* =========================================================
   SETTINGS (N-supported management; includes creditLimit)
   ========================================================= */
function renderSettings(st){
  el("payEveryDays").value = st.settings.payEveryDays;
  el("horizonDays").value = st.settings.horizonDays;
  el("rentDueDay").value = st.settings.rentDueDay;

  const root = el("peopleManage");
  if (!root) return;
  root.innerHTML = "";

  st.people.forEach(p=>{
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginTop = "12px";

    card.innerHTML = `
      <div class="section-title">
        <div class="h">${p.name}</div>
        <button class="btn danger" data-delperson="${p.id}">Delete</button>
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
        <button class="btn" data-adddebt="${p.id}">Add debt</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th style="width:90px;">Type</th>
            <th style="width:90px;">Due</th>
            <th style="width:100px;">APR%</th>
            <th style="width:140px;" class="right">Balance</th>
            <th style="width:140px;" class="right">Credit Limit</th>
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
      if (d.creditLimit == null) d.creditLimit = 0; // backward compatibility

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
        <td class="right"><button class="btn danger" data-deldebt="${p.id}:${d.id}" style="padding:8px 10px;">Delete</button></td>
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
      p2.debts.push({ id: crypto.randomUUID(), label:"New debt", type:"cc", dueDay:0, balance:0, apr:0, creditLimit:0 });
      save(st2);
      boot();
    });

    card.querySelector("button[data-delperson]").addEventListener("click", ()=>{
      const st2 = load() || defaultState();
      st2.people = st2.people.filter(x=>x.id!==p.id);
      save(st2);
      boot();
    });

    card.querySelector("button[data-delperson]").disabled = (st.people.length <= 1);
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
      debts: [{ id: crypto.randomUUID(), label:"Card 1", type:"cc", dueDay:0, balance:0, apr:0, creditLimit:0 }]
    });
    save(st2);
    boot();
  };
}

/* =========================================================
   Data binding (store on input)
   ========================================================= */
function attachInputHandlers(){
  document.body.addEventListener("input", (e)=>{
    const t = e.target;
    const st = load() || defaultState();

    // Shared fields
    if (t.id === "rentAmount") st.shared.rentAmount = Number(t.value||0);
    if (t.id === "cashBuffer") st.shared.cashBuffer = Number(t.value||0);
    if (t.id === "note") st.shared.note = t.value || "";

    // Settings fields
    if (t.id === "payEveryDays") st.settings.payEveryDays = Number(t.value||14);
    if (t.id === "horizonDays") st.settings.horizonDays = Number(t.value||90);
    if (t.id === "rentDueDay") st.settings.rentDueDay = Number(t.value||28);

    // People fields
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
   Core compute (truth engine)
   - Rent and each debt scheduled once (next due)
   - CC full payment
   - LOC minimum interest-only
   ========================================================= */
function compute(st){
  const today = new Date(); today.setHours(0,0,0,0);
  const every = st.settings.payEveryDays || 14;
  const horizon = st.settings.horizonDays || 90;

  const events = [];
  const warnings = [];

  let cashStart = Number(st.shared.cashBuffer || 0);
  st.people.forEach(p=> cashStart += Number(p.cash || 0));

  // Pay streams and per-pay obligations (if user uses them; not required)
  st.people.forEach(p=>{
    const lp = parseISO(p.lastPayDate);
    if (!lp) { warnings.push(`${p.name}: missing last pay date`); return; }

    let pay = nextPayFromLast(today, lp, every);
    while (pay <= addDays(today, horizon)){
      events.push({ date: toISO(pay), name: `${p.name} pay`, inflow: Number(p.payAmount||0), outflow: 0 });

      if ((p.perPayObligationAmount||0) > 0){
        events.push({
          date: toISO(pay),
          name: `${p.name}: ${p.perPayObligationLabel || "Per-pay obligation"}`,
          inflow: 0,
          outflow: Number(p.perPayObligationAmount||0)
        });
      }

      pay = addDays(pay, every);
    }
  });

  // Shared rent (next occurrence)
  const rentDue = nextDueByDay(today, st.settings.rentDueDay);
  if (rentDue && (st.shared.rentAmount||0) > 0){
    events.push({ date: toISO(rentDue), name: `Rent`, inflow: 0, outflow: Number(st.shared.rentAmount||0) });
  }

  // Debts due (next occurrence)
  st.people.forEach(p=>{
    (p.debts||[]).forEach(d=>{
      if (!d.dueDay || d.dueDay < 1) return;
      const due = nextDueByDay(today, d.dueDay);
      if (!due) return;

      const bal = Number(d.balance||0);
      if (bal <= 0) return;

      if (d.type === "cc"){
        // CC: full statement
        events.push({ date: toISO(due), name: `${p.name}: ${d.label} (CC full)`, inflow: 0, outflow: bal });
      } else {
        // LOC: minimum = interest-only
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

  // Sort events (date asc; inflow before outflow on same day)
  events.sort((a,b)=>{
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (b.inflow - a.inflow) || (a.outflow - b.outflow);
  });

  // Walk balance
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

  // Next household pay = earliest next pay among people
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

/* =========================================================
   Decision Maker (the output users need)
   - SAFE/UNSAFE
   - Blocking bill/date
   - Minimal borrowing recommendation based on LOC capacity
   - Justification: interest cost vs "nullifying" next pay (optional)
   ========================================================= */
function locCapacity(st){
  // Sum capacities across all LOC debts
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
      locs.push({ owner: p.name, label: d.label, avail, apr });
    });
  });

  // Choose best (lowest APR) LOC for recommendation
  locs.sort((a,b)=> (a.apr||999)-(b.apr||999));
  return { totalAvail, best: locs[0] || null, locs };
}

function estInterest(amount, aprPct, days){
  if (amount <= 0 || !aprPct || aprPct <= 0 || days <= 0) return 0;
  return amount * (aprPct/100) * (days/365);
}

function renderResults(st, model){
  /* ---------- DECISION ---------- */
  let verdict = "SAFE";
  let reason = "All required bills can be paid on time with current inputs.";
  let action = "Proceed normally.";

  // If failing at any event, find shortfall and propose the least-hurt bridge
  if (model.firstNegRow){
    verdict = "UNSAFE";
    const shortBy = Math.abs(model.firstNegRow.balance);

    reason = `Blocking event: ${model.firstNegRow.name} on ${model.firstNegRow.date}. Short by $${fmt(shortBy)}.`;

    // Compute bridge until next pay date (from blocking event date to next pay after it)
    const every = st.settings.payEveryDays || 14;
    const blockDate = parseISO(model.firstNegRow.date);
    const nextPayDate = parseISO(model.nextPay); // earliest next pay
    const daysToNextPay = Math.max(1, Math.floor((nextPayDate - blockDate)/(24*3600*1000)));

    const cap = locCapacity(st);

    if (cap.totalAvail > 0){
      const borrow = Math.min(shortBy, cap.totalAvail);

      // choose best LOC (lowest APR) if available
      const best = cap.best;
      const apr = best?.apr || 0;
      const iCost = estInterest(borrow, apr, daysToNextPay);

      // "nullification of paycheque": how much of next pay would be consumed if repaid immediately
      const nextPayInflow = model.rows
        .filter(r => r.date === model.nextPay && r.inflow > 0)
        .reduce((s,r)=>s+r.inflow, 0);

      const pctOfPay = nextPayInflow > 0 ? (borrow / nextPayInflow) * 100 : null;

      action =
        `Action: borrow $${fmt(borrow)} from LOC (lowest APR: ${best.owner} • ${best.label} @ ${apr || 0}%). ` +
        `Est. interest for ${daysToNextPay} days ≈ $${fmt(iCost)}. ` +
        (pctOfPay != null ? `If repaid next pay, it consumes ~${pctOfPay.toFixed(0)}% of that pay.` : "");

      if (borrow < shortBy){
        action += ` Remaining unfunded shortfall: $${fmt(shortBy - borrow)} (LOC limit insufficient).`;
      }

      // warn if best APR missing/0
      if (!apr || apr <= 0){
        action += ` (APR missing → interest estimate unreliable; set APR in Settings for LOC.)`;
      }

    } else {
      action =
        `Action: no LOC capacity recorded. Set LOC credit limit(s) in Settings to enable borrowing recommendation, ` +
        `or reduce/shift bills before ${model.firstNegRow.date}.`;
    }
  }

  el("decisionCard").innerHTML = `
    <div class="kpi" style="grid-column: span 3;">
      <div class="t">Decision</div>
      <div class="v ${verdict==="SAFE" ? "good" : "bad"}">${verdict}</div>
      <div class="small">${reason}</div>
      <div class="small">${action}</div>
    </div>
  `;

  /* ---------- KPIs (secondary) ---------- */
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

  /* ---------- Timeline (optional detail) ---------- */
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

/* =========================================================
   Export / Import
   ========================================================= */
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
  // migrate older data: ensure creditLimit exists
  (st.people||[]).forEach(p=>{
    (p.debts||[]).forEach(d=>{
      if (d.creditLimit == null) d.creditLimit = 0;
    });
  });
  save(st);
  boot();
}

/* =========================================================
   Buttons
   ========================================================= */
function wireButtons(){
  el("btnCompute").onclick = ()=>{
    const st = load() || defaultState();
    st.shared.rentAmount = Number(el("rentAmount").value||0);
    st.shared.cashBuffer = Number(el("cashBuffer").value||0);
    st.shared.note = el("note").value || "";
    save(st);

    const model = compute(st);
    renderResults(st, model);

    // jump to results
    showTab("results");
  };

  el("btnSave").onclick = ()=>{ /* saved on input */ };

  el("btnExport").onclick = exportJSON;

  el("importFile").addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    await importJSON(f);
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
}

/* =========================================================
   Boot
   ========================================================= */
function boot(){
  let st = load();
  if (!st) st = defaultState();

  // migrate creditLimit
  (st.people||[]).forEach(p=>{
    (p.debts||[]).forEach(d=>{
      if (d.creditLimit == null) d.creditLimit = 0;
    });
  });

  // theme
  document.documentElement.setAttribute("data-theme", st.theme || "dark");

  // settings inputs
  el("payEveryDays").value = st.settings.payEveryDays;
  el("horizonDays").value = st.settings.horizonDays;
  el("rentDueDay").value = st.settings.rentDueDay;

  // shared inputs
  el("rentAmount").value = st.shared.rentAmount || 0;
  el("cashBuffer").value = st.shared.cashBuffer || 0;
  el("note").value = st.shared.note || "";

  renderToday(st);
  renderFuture(st);
  renderSettings(st);

  // compute once (decision always visible)
  const model = compute(st);
  renderResults(st, model);

  // register SW
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");

  // default: show results (decision-first)
  showTab("results");
}

/* =========================================================
   Init
   ========================================================= */
(function init(){
  mountTabs();
  mountDrawer();

  let st = load();
  if (!st) st = defaultState();

  mountTheme(st);
  save(st);

  attachInputHandlers();
  wireButtons();
  boot();
})();