/* =========================================================
   Cashflow Decision Maker — Quiz setup + decisive output
   Requirements implemented:
   - Remove per-pay obligation questions (still exists in settings; not in quiz)
   - LOC questions conditional (APR/balance/creditLimit asked only if LOC)
   - LOC credit limit stored and used to recommend minimal borrowing
   - Future expenses prompt: Yes -> go Future tab; No -> go Results
   ========================================================= */

const LS = "cashflow_quiz_v3";

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
    mode: "setup",
    quizStep: 0,
    settings: { payEveryDays: 14, horizonDays: 90, rentDueDay: 28 },
    shared: { rentAmount: 0, cashBuffer: 0, note: "", wantsFuture: false },
    people: [
      {
        id: crypto.randomUUID(),
        name: "Person 1",
        lastPayDate: fallback,
        payAmount: 0,
        cash: 0,
        debts: [
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
        debts: [
          { id: crypto.randomUUID(), label: "Card 1", type: "cc", dueDay: 5, balance: 0, apr: 0, creditLimit: 0 }
        ]
      }
    ],
    future: []
  };
}

function showTab(tab){
  qsa(".seg button").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  ["setup","today","future","results","settings"].forEach(t=>{
    const sec = el("tab-"+t);
    if (sec) sec.classList.toggle("hidden", t !== tab);
  });
}

/* ---------- Drawer + theme ---------- */
function mountDrawer(){
  const open = ()=>{ el("drawer").classList.remove("hidden"); el("backdrop").classList.remove("hidden"); };
  const close = ()=>{ el("drawer").classList.add("hidden"); el("backdrop").classList.add("hidden"); };
  el("btnSidebar").addEventListener("click", open);
  el("btnCloseDrawer").addEventListener("click", close);
  el("backdrop").addEventListener("click", close);
}
function mountTheme(){
  el("btnTheme").addEventListener("click", ()=>{
    const st = load() || defaultState();
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = (cur === "dark") ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    st.theme = next;
    save(st);
  });
}

/* =========================================================
   QUIZ (33-ish, but conditional LOC steps skip automatically)
   You requested:
   - remove per-pay obligation questions
   - conditional LOC steps
   - add LOC credit limit
   - future expenses yes/no at end
   ========================================================= */

function buildQuiz(st){
  const steps = [
    { key:"people.0.name", type:"text", q:"What is Person 1 name?", reason:"Labels reduce friction; math stays the same." },
    { key:"people.1.name", type:"text", q:"What is Person 2 name?", reason:"Same system; 2nd income stream." },

    { key:"settings.payEveryDays", type:"number", q:"Pay cycle in days?", reason:"Inflow rhythm.", min:1, preset:14 },
    { key:"settings.horizonDays", type:"number", q:"Projection horizon in days?", reason:"How far ahead to check risk.", min:14, preset:90 },

    { key:"shared.rentAmount", type:"money", q:"Rent amount?", reason:"Largest fixed constraint." },
    { key:"settings.rentDueDay", type:"number", q:"Rent due day (1–31)?", reason:"Used to schedule next rent event.", min:1, max:31, preset:28 },

    { key:"people.0.lastPayDate", type:"date", q:"Person 1 last pay date?", reason:"Derives next pay dates." },
    { key:"people.0.payAmount", type:"money", q:"Person 1 pay amount (per pay)?", reason:"Primary inflow." },
    { key:"people.0.cash", type:"money", q:"Person 1 cash on hand (optional)?", reason:"Starting cash improves accuracy.", optional:true, preset:0 },

    // Person 1 Debt #1
    { key:"people.0.debts.0.label", type:"text", q:"Person 1 Card #1 name?", reason:"Example: AMEX / Scotia / CIBC.", preset:"AMEX" },
    { key:"people.0.debts.0.type", type:"select", q:"Person 1 Card #1 type?", reason:"CC = pay full; LOC = minimum interest.", options:["cc","loc"], preset:"cc" },
    { key:"people.0.debts.0.dueDay", type:"number", q:"Person 1 Card #1 due day (1–31)?", reason:"Schedules next due event.", min:1, max:31, preset:16 },
    { key:"people.0.debts.0.apr", type:"number", q:"APR% (only if LOC)", reason:"Needed only for LOC minimum.", preset:0,
      showIf:(s)=> s.people[0].debts[0].type==="loc" },
    { key:"people.0.debts.0.creditLimit", type:"money", q:"Credit limit (only if LOC)", reason:"Used to compute borrowing capacity.", preset:0,
      showIf:(s)=> s.people[0].debts[0].type==="loc" },
    { key:"people.0.debts.0.balance", type:"money", q:"Statement balance (CC) or balance (LOC)?", reason:"The amount due/owed.", preset:0 },

    // Person 1 Debt #2
    { key:"people.0.debts.1.label", type:"text", q:"Person 1 Debt #2 name?", reason:"Example: LOC.", preset:"LOC" },
    { key:"people.0.debts.1.type", type:"select", q:"Person 1 Debt #2 type?", reason:"LOC enables bridging.", options:["cc","loc"], preset:"loc" },
    { key:"people.0.debts.1.dueDay", type:"number", q:"Person 1 Debt #2 due day (1–31)?", reason:"Schedules next due event.", min:1, max:31, preset:8 },
    { key:"people.0.debts.1.apr", type:"number", q:"APR% for LOC?", reason:"Required for LOC minimum payment.", preset:9,
      showIf:(s)=> s.people[0].debts[1].type==="loc" },
    { key:"people.0.debts.1.creditLimit", type:"money", q:"LOC credit limit?", reason:"Borrowing capacity = limit − balance.", preset:0,
      showIf:(s)=> s.people[0].debts[1].type==="loc" },
    { key:"people.0.debts.1.balance", type:"money", q:"LOC balance?", reason:"Used to compute minimum interest.", preset:0,
      showIf:(s)=> s.people[0].debts[1].type==="loc" },

    // Person 2
    { key:"people.1.lastPayDate", type:"date", q:"Person 2 last pay date?", reason:"Second inflow stream." },
    { key:"people.1.payAmount", type:"money", q:"Person 2 pay amount (per pay)?", reason:"Second inflow stream." },
    { key:"people.1.cash", type:"money", q:"Person 2 cash on hand (optional)?", reason:"Starting cash improves accuracy.", optional:true, preset:0 },

    // Person 2 Debt #1
    { key:"people.1.debts.0.label", type:"text", q:"Person 2 Card #1 name?", reason:"Example: CIBC / Scotia.", preset:"CIBC" },
    { key:"people.1.debts.0.type", type:"select", q:"Person 2 Card #1 type?", reason:"CC = pay full; LOC = minimum interest.", options:["cc","loc"], preset:"cc" },
    { key:"people.1.debts.0.dueDay", type:"number", q:"Person 2 Card #1 due day (1–31)?", reason:"Schedules next due event.", min:1, max:31, preset:5 },
    { key:"people.1.debts.0.apr", type:"number", q:"APR% (only if LOC)", reason:"Needed only for LOC minimum.", preset:0,
      showIf:(s)=> s.people[1].debts[0].type==="loc" },
    { key:"people.1.debts.0.creditLimit", type:"money", q:"Credit limit (only if LOC)", reason:"Borrowing capacity = limit − balance.", preset:0,
      showIf:(s)=> s.people[1].debts[0].type==="loc" },
    { key:"people.1.debts.0.balance", type:"money", q:"Statement balance (CC) or balance (LOC)?", reason:"The amount due/owed.", preset:0 },

    { key:"shared.cashBuffer", type:"money", q:"House cash buffer (optional)?", reason:"If you want strict, keep 0.", optional:true, preset:0 },
    { key:"shared.note", type:"text", q:"Optional note?", reason:"For your own context.", optional:true, preset:"" },

    { key:"shared.wantsFuture", type:"select", q:"Do you have future expenses to add now?", reason:"Yes → Future page. No → Decision.", options:["no","yes"], preset:"no" }
  ];

  return steps;
}

function getByPath(obj, path){
  return path.split(".").reduce((acc, k)=> (acc==null ? acc : acc[k]), obj);
}
function setByPath(obj, path, value){
  const parts = path.split(".");
  let cur = obj;
  for (let i=0;i<parts.length-1;i++){
    const k = parts[i];
    if (cur[k] == null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length-1]] = value;
}

function stepVisible(step, st){
  return !step.showIf || step.showIf(st);
}
function findNextVisibleIndex(st, steps, start, dir){
  let i = start;
  while (i >= 0 && i < steps.length && !stepVisible(steps[i], st)) i += dir;
  return i;
}

function renderQuiz(st){
  const steps = buildQuiz(st);

  // land on a visible step
  let i = Math.max(0, Math.min(st.quizStep || 0, steps.length-1));
  i = findNextVisibleIndex(st, steps, i, +1);
  st.quizStep = i;
  save(st);

  const step = steps[i];

  el("quizProgress").textContent = `Step ${i+1} of ${steps.length}`;
  el("quizProgressFill").style.width = `${Math.round(((i+1)/steps.length)*100)}%`;
  el("quizQuestion").textContent = step.q;
  el("quizReason").textContent = step.reason || "";
  el("quizNote").textContent = "";

  const inputWrap = el("quizInput");
  inputWrap.innerHTML = "";

  let curVal = getByPath(st, step.key);
  if (step.key === "shared.wantsFuture" && typeof curVal === "boolean") curVal = curVal ? "yes" : "no";
  const preset = (curVal === "" || curVal == null) ? (step.preset ?? "") : curVal;

  let inputEl;
  if (step.type === "select"){
    inputEl = document.createElement("select");
    inputEl.innerHTML = step.options.map(o=>`<option value="${o}">${o.toUpperCase()}</option>`).join("");
    inputEl.value = preset || step.options[0];
  } else {
    inputEl = document.createElement("input");
    inputEl.type = (step.type === "date") ? "date" : (step.type === "text" ? "text" : "number");
    if (step.type === "money") inputEl.step = "0.01";
    if (step.type === "number") inputEl.step = "1";
    if (step.min != null) inputEl.min = String(step.min);
    if (step.max != null) inputEl.max = String(step.max);
    inputEl.value = (preset ?? "");
  }

  // not too wide
  inputEl.style.width = "100%";
  inputEl.style.maxWidth = "420px";
  inputEl.style.margin = "0 auto";
  inputEl.style.display = "block";
  inputEl.style.padding = "11px 12px";
  inputEl.style.borderRadius = "14px";
  inputEl.style.border = "1px solid var(--stroke)";
  inputEl.style.background = "rgba(0,0,0,.12)";
  inputEl.style.color = "var(--text)";

  inputWrap.appendChild(inputEl);

  el("quizBack").disabled = (i===0);
  el("quizNext").textContent = (i===steps.length-1) ? "Finish" : "Next";
}

function commitQuizAnswer(st){
  const steps = buildQuiz(st);
  const step = steps[st.quizStep || 0];
  const control = el("quizInput").querySelector("input, select");
  if (!control) return true;

  let val = control.value;

  if (step.key === "shared.wantsFuture") val = (val === "yes");

  if (step.type === "money" || step.type === "number") val = Number(val || 0);

  if (!step.optional){
    if (step.type === "text" && String(val).trim()===""){ el("quizNote").textContent = "Required."; return false; }
    if (step.type === "date" && String(val).trim()===""){ el("quizNote").textContent = "Pick a date."; return false; }
  }

  setByPath(st, step.key, val);
  save(st);
  return true;
}

function finishQuiz(st){
  st.mode = "run";
  st.quizStep = 0;
  save(st);

  // render screens using final state
  boot();

  // route
  if (st.shared.wantsFuture) showTab("future");
  else showTab("results");
}

/* =========================================================
   Today/Future/Settings render (simplified)
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
      const st2 = load() || defaultState();
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
        const st2 = load() || defaultState();
        const p2 = st2.people.find(x=>x.id===pid);
        p2.debts = p2.debts.filter(x=>x.id!==did);
        save(st2);
        boot();
        showTab("settings");
      });
    });

    card.querySelector("button[data-adddebt]").addEventListener("click", ()=>{
      const st2 = load() || defaultState();
      const p2 = st2.people.find(x=>x.id===p.id);
      p2.debts.push({ id: crypto.randomUUID(), label:"New debt", type:"cc", dueDay:0, balance:0, apr:0, creditLimit:0 });
      save(st2);
      boot();
      showTab("settings");
    });

    card.querySelector("button[data-delperson]").addEventListener("click", ()=>{
      const st2 = load() || defaultState();
      st2.people = st2.people.filter(x=>x.id!==p.id);
      save(st2);
      boot();
      showTab("settings");
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
      debts: [{ id: crypto.randomUUID(), label:"Card 1", type:"cc", dueDay:0, balance:0, apr:0, creditLimit:0 }]
    });
    save(st2);
    boot();
    showTab("settings");
  };
}

/* ---------- input save ---------- */
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
        if (k === "creditLimit") d.creditLimit = Number(t.value||0);
      } else {
        if (k === "name") p.name = t.value || "";
        if (k === "lastPayDate") p.lastPayDate = t.value || "";
        if (k === "payAmount") p.payAmount = Number(t.value||0);
        if (k === "cash") p.cash = Number(t.value||0);
      }
    }

    save(st);
  });
}

/* =========================================================
   Compute + Decision maker (bridge recommendation)
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

  // pay streams
  st.people.forEach(p=>{
    const lp = parseISO(p.lastPayDate);
    if (!lp) { warnings.push(`${p.name}: missing last pay date`); return; }
    let pay = nextPayFromLast(today, lp, every);
    while (pay <= addDays(today, horizon)){
      events.push({ date: toISO(pay), name: `${p.name} pay`, inflow: Number(p.payAmount||0), outflow: 0 });
      pay = addDays(pay, every);
    }
  });

  // rent once
  const rentDue = nextDueByDay(today, st.settings.rentDueDay);
  if (rentDue && (st.shared.rentAmount||0) > 0){
    events.push({ date: toISO(rentDue), name: `Rent`, inflow: 0, outflow: Number(st.shared.rentAmount||0) });
  }

  // debts once: CC full; LOC minimum interest-only
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

  // future expenses
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
  let verdict = "SAFE";
  let reason = "All required bills fit.";
  let action = "Proceed.";

  if (model.firstNegRow){
    verdict = "UNSAFE";
    const shortBy = Math.abs(model.firstNegRow.balance);
    reason = `Blocking: ${model.firstNegRow.name} on ${model.firstNegRow.date}. Short by $${fmt(shortBy)}.`;

    const cap = locCapacity(st);
    if (cap.totalAvail > 0){
      const borrow = Math.min(shortBy, cap.totalAvail);
      const best = cap.best;
      const apr = best?.apr || 0;

      const blockDate = parseISO(model.firstNegRow.date);
      const nextPayDate = parseISO(model.nextPay);
      const days = Math.max(1, Math.floor((nextPayDate - blockDate)/(24*3600*1000)));
      const iCost = estInterest(borrow, apr, days);

      action = `Borrow $${fmt(borrow)} from LOC (lowest APR: ${best.owner} • ${best.label} @ ${apr||0}%). Est. interest ≈ $${fmt(iCost)} for ${days} days.`;
      if (borrow < shortBy) action += ` Remaining unfunded: $${fmt(shortBy-borrow)}.`;
      if (!apr || apr<=0) action += ` (APR missing → set APR for accurate cost.)`;
    } else {
      action = `No LOC capacity recorded. Set LOC credit limit(s) to enable borrowing decision.`;
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

  const surplus1 = (model.cashStart + model.inflow1) - model.out1;
  const surplus2 = (model.cashStart + model.inflow2) - model.out2;

  el("kpiGrid").innerHTML = `
    <div class="kpi"><div class="t">Today</div><div class="v">${model.today}</div><div class="small muted">Start: ${fmt(model.cashStart)}</div></div>
    <div class="kpi"><div class="t">Next pay</div><div class="v">${model.nextPay}</div><div class="small muted">Earliest pay</div></div>
    <div class="kpi"><div class="t">By next pay</div><div class="v ${surplus1>=0?"good":"bad"}">${surplus1>=0?"+":""}${fmt(surplus1)}</div><div class="small muted">Out ≤ next pay: ${fmt(model.out1)}</div></div>
    <div class="kpi"><div class="t">By 2nd pay</div><div class="v ${surplus2>=0?"good":"bad"}">${surplus2>=0?"+":""}${fmt(surplus2)}</div><div class="small muted">Out ≤ 2nd: ${fmt(model.out2)}</div></div>
    <div class="kpi"><div class="t">Minimum</div><div class="v ${model.minBal>=0?"good":"bad"}">${fmt(model.minBal)}</div><div class="small muted">${model.firstNeg ? "First neg: "+model.firstNeg : "No neg in horizon"}</div></div>
    <div class="kpi"><div class="t">Horizon</div><div class="v">${st.settings.horizonDays}d</div><div class="small muted">Cycle: ${st.settings.payEveryDays}d</div></div>
  `;

  const tbody = el("eventsTbody");
  tbody.innerHTML = "";
  model.rows.forEach(r=>{
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

  el("warnings").innerHTML = model.warnings.length
    ? `<b>Warnings:</b><br>${model.warnings.map(w=>"- "+w).join("<br>")}`
    : "";
}

/* ---------- Export/Import ---------- */
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
  // migrate missing fields
  st.shared = st.shared || { rentAmount:0,cashBuffer:0,note:"",wantsFuture:false };
  if (st.shared.wantsFuture == null) st.shared.wantsFuture = false;
  (st.people||[]).forEach(p=>{
    (p.debts||[]).forEach(d=>{
      if (d.creditLimit == null) d.creditLimit = 0;
    });
  });
  save(st);
  boot();
}

/* ---------- Buttons + wiring ---------- */
function wireButtons(){
  // Quiz
  el("quizBack").onclick = ()=>{
    const st = load() || defaultState();
    const steps = buildQuiz(st);
    let i = (st.quizStep||0) - 1;
    i = findNextVisibleIndex(st, steps, i, -1);
    st.quizStep = Math.max(0, i);
    save(st);
    renderQuiz(st);
  };

  el("quizNext").onclick = ()=>{
    const st = load() || defaultState();
    if (!commitQuizAnswer(st)) return;

    const steps = buildQuiz(st);
    let i = (st.quizStep||0) + 1;
    i = findNextVisibleIndex(st, steps, i, +1);

    if (i >= steps.length){
      finishQuiz(st);
      return;
    }
    st.quizStep = i;
    save(st);
    renderQuiz(st);
  };

  // Today compute
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

  // Future add
  el("btnAddFuture").onclick = ()=>{
    const st = load() || defaultState();
    const d = el("fDate").value;
    const a = Number(el("fAmount").value||0);
    const l = el("fLabel").value || "";
    if (!d || !a) return;
    st.future.push({ date:d, amount:a, label:l });
    save(st);
    el("fDate").value=""; el("fAmount").value=""; el("fLabel").value="";
    boot(); showTab("future");
  };

  // toggle timeline
  el("btnToggleTable").onclick = ()=> el("timelineWrap").classList.toggle("hidden");

  // export/import/reset
  el("btnExport").onclick = exportJSON;
  el("importFile").addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    await importJSON(f);
    e.target.value = "";
  });
  el("btnResetAll").onclick = ()=>{
    if (!confirm("Delete local data on this device?")) return;
    localStorage.removeItem(LS);
    location.reload();
  };
}

/* ---------- Tab buttons (safe) ---------- */
function mountTabs(){
  qsa(".seg button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      showTab(btn.dataset.tab);
    });
  });
}

/* ---------- Save on input ---------- */
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
        if (k === "balance") d.balance = Number(t.value||0);
      } else {
        if (k === "lastPayDate") p.lastPayDate = t.value || "";
        if (k === "payAmount") p.payAmount = Number(t.value||0);
        if (k === "cash") p.cash = Number(t.value||0);
      }
    }

    save(st);
  });
}

/* ---------- Boot ---------- */
function boot(){
  let st = load();
  if (!st) st = defaultState();

  // theme
  document.documentElement.setAttribute("data-theme", st.theme || "dark");

  // render
  renderToday(st);
  renderFuture(st);
  renderSettings(st);

  // compute
  const model = compute(st);
  renderResults(st, model);

  // mode routing
  if (st.mode === "setup"){
    // lock other tabs
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
    showTab("results");
  }

  // SW
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
}

/* ---------- init ---------- */
(function init(){
  mountTabs();
  mountDrawer();
  mountTheme();
  attachInputHandlers();
  wireButtons();

  const st = load() || defaultState();
  save(st);
  boot();
})();