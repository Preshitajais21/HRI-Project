// ===== Helpers =====
function qp(name, def = null) {
  const u = new URL(location.href);
  return u.searchParams.get(name) ?? def;
}
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function setT(fn, ms) { const id = setTimeout(fn, ms); App.timers.push(id); return id; }
function clearTimers() { App.timers.forEach(clearTimeout); App.timers = []; }
function nowMs() { return Date.now(); }


const MODE = qp('mode', 'interactive');   // "interactive" or "silent"


function isPlaceholder(s) {
  return typeof s === "string" && s.indexOf("{") !== -1;
}


// ===== ID helper: single source of truth via sessionStorage =====
function getParticipantInfo() {
  // 1) Primary source: sessionStorage (set in demographics)
  var pid = sessionStorage.getItem("participant_id") || "";
  var wid = sessionStorage.getItem("worker_id") || "";
  var aid = sessionStorage.getItem("assignment_id") || "";
  var hid = sessionStorage.getItem("hit_id") || "";


  // 2) Fallback if somehow demographics was skipped
  if (!pid) {
    var params = new URLSearchParams(window.location.search);
    var workerId     = params.get("workerId")     || "";
    var assignmentId = params.get("assignmentId") || "";
    var hitId        = params.get("hitId")        || "";


    if (workerId && assignmentId && !isPlaceholder(workerId) && !isPlaceholder(assignmentId)) {
      pid = workerId + ":" + assignmentId;
      wid = workerId;
      aid = assignmentId;
      hid = hitId;
    } else if (typeof uniqueId !== "undefined" && uniqueId && !isPlaceholder(uniqueId)) {
      // Use PsiTurk's uniqueId if available
      pid = uniqueId;
    } else {
      // Last-resort local id
      pid = "LOCAL_" + Date.now();
    }


    sessionStorage.setItem("participant_id", pid);
    if (wid) sessionStorage.setItem("worker_id", wid);
    if (aid) sessionStorage.setItem("assignment_id", aid);
    if (hid) sessionStorage.setItem("hit_id", hid);
  }


  return {
    participant_id: pid,
    worker_id: wid,
    assignment_id: aid,
    hit_id: hid
  };
}


// ===== App state =====
const App = {
  mode: MODE,
  durSec: 150,       // 2.5 minutes
  startAt: null,
  timers: [],
  sessionOver: false,


  log: [],
  summary: { wl_answers: [], conditions: [], tasks: [], inventoryClicks: [] },


  inv: null,
  task: null,        // {id, req, prog, t0, clicksCount}
  plan: { tasksSpawned: 0, maxTasks: 6, nextTaskAt: null },


  condition: { active: false, mode: null, nextAllowedAt: 0 },
  queue: { counts: { interactive: 3, silent: 2 }, nextPlannedAt: 0 },


  robot: { collecting: false, feed: [] },


  wl: { firstAfter: 60_000, every: 60_000, t: null, choice: null, opened: 0 }
};


// Starting inventory for *each* experiment
const DEFAULT_INV = {
  "Gloves": 12,
  "Syringes": 12,
  "Cotton Rolls": 14,
  "IV Bags": 12,
  "Tape": 14,
  "Masks": 16
};


// Per-item collection duration (ms)
const PER_ITEM_MS = 1500;


// ===== Video helper =====
function playRobotVideo(on) {
  const v = document.getElementById('robotVideo');
  if (!v) return;
  if (on) {
    v.play().catch(() => { });
  } else {
    v.pause();
    v.currentTime = 0;
  }
}


// ===== State I/O =====
function saveState() {
  sessionStorage.setItem('exp_inventory', JSON.stringify(App.inv));
  sessionStorage.setItem('exp_log', JSON.stringify(App.log));
  sessionStorage.setItem('exp_summary', JSON.stringify(App.summary));
}


function loadState() {
  App.startAt = nowMs();


  App.inv = { ...DEFAULT_INV };


  App.log = [];
  App.summary = {
    wl_answers: [],
    conditions: [],
    tasks: [],
    inventoryClicks: [],
    mode: App.mode,
    phase: App.mode,
    startAt: App.startAt,
    durSec: App.durSec
  };


  App.plan.tasksSpawned = 0;
  App.plan.maxTasks = 6;
  App.plan.nextTaskAt = App.startAt;


  if (App.mode === 'interactive') {
    App.queue.counts = { interactive: 3, silent: 0 };
  } else {
    App.queue.counts = { interactive: 0, silent: 2 };
  }


  App.condition.nextAllowedAt = App.startAt;
  App.queue.nextPlannedAt = App.startAt + 25_000;


  saveState();
}


// ===== Logging & UI feed =====
function L(ev, data = {}) { App.log.push({ t: nowMs(), ev, ...data }); saveState(); }
function pushRobotFeed(msg) {
  const MAX = 6;
  const tStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  App.robot.feed.push({ t: tStr, msg });
  if (App.robot.feed.length > MAX) App.robot.feed.shift();
  document.getElementById('robotStatus').innerHTML =
    App.robot.feed.map(e => `<div><span class="muted">${e.t}</span> — ${e.msg}</div>`).join('') || 'Waiting for robot…';
  L('feed', { msg });
}


// ===== Inventory =====
function renderInventory() {
  const wrap = document.getElementById('inventoryList');
  wrap.innerHTML = '';
  Object.keys(App.inv).forEach(name => {
    const row = document.createElement('div');
    row.className = 'inv-row';
    row.setAttribute('data-item', name);
    row.innerHTML =
      `<strong>${name}<span class="badge rounded-pill bg-secondary ms-2 inv-count" data-count="${name}">${App.inv[name]}</span></strong>` +
      `<span class="muted">click to send</span>`;
    wrap.appendChild(row);
  });


  wrap.onclick = e => {
    if (App.sessionOver) return;
    const row = e.target.closest('[data-item]');
    if (!row || !App.task) return;
    const item = row.getAttribute('data-item');
    if (!(App.task.req[item] || 0)) return;
    if ((App.inv[item] ?? 0) <= 0) return;


    App.inv[item] -= 1;
    App.task.prog[item] = (App.task.prog[item] || 0) + 1;
    App.task.clicksCount = (App.task.clicksCount || 0) + 1;


    const badge = document.querySelector(`[data-count="${CSS.escape(item)}"]`);
    if (badge) badge.textContent = App.inv[item];


    App.summary.inventoryClicks.push({ t: nowMs(), item });
    L('inventory_click', { item });
    saveState();
    renderTask();
  };
}


// ===== Tasks =====
function renderTask() {
  var st = document.getElementById('taskStatus');
  var rq = document.getElementById('taskReq');


  if (!App.task) {
    var nextIn = 0;
    if (App.plan.nextTaskAt) {
      nextIn = Math.max(0, Math.ceil((App.plan.nextTaskAt - nowMs()) / 1000));
    }


    if (App.plan.tasksSpawned >= App.plan.maxTasks) {
      st.textContent = 'All tasks done.';
    } else if (App.plan.nextTaskAt) {
      st.textContent = 'Next task in ~' + nextIn + 's';
    } else {
      st.textContent = 'Waiting for task…';
    }


    rq.innerHTML = '';
    return;
  }


  var done = true;
  Object.keys(App.task.req).forEach(function (it) {
    var need = App.task.req[it];
    if ((App.task.prog[it] || 0) < need) {
      done = false;
    }
  });


  if (done) {
    st.textContent =
      'All requested items sent. You can click "Submit Task" whenever you are ready.';
  } else {
    st.textContent =
      'Click an item name to send 1 unit. You can click "Submit Task" at any time.';
  }


  var htmlParts = [];
  Object.keys(App.task.req).forEach(function (it) {
    var need = App.task.req[it];
    var have = App.task.prog[it] || 0;
    htmlParts.push(
      '<div>• ' + it + ': <strong>' + have + '/' + need + '</strong> sent</div>'
    );
  });
  rq.innerHTML = htmlParts.join('');
}


function maybeSpawnTask(now) {
  if (App.sessionOver) return;
  if (!App.task && App.plan.tasksSpawned < App.plan.maxTasks && now >= App.plan.nextTaskAt) {
    const items = Object.keys(App.inv);
    const k = rnd(2, 3);
    const pick = new Set();
    while (pick.size < k) pick.add(items[rnd(0, items.length - 1)]);
    const req = {}, prog = {};
    [...pick].forEach(it => { req[it] = rnd(2, 4); prog[it] = 0; });


    App.task = { id: 'T' + now, req, prog, t0: now, clicksCount: 0 };
    App.plan.tasksSpawned += 1;
    App.plan.nextTaskAt = Infinity;


    App.summary.tasks.push({ t: now, id: App.task.id, items: req });
    L('task_spawn', { id: App.task.id, items: req });
    saveState();
    renderTask();
  }
}


// ===== Right-panel interactive collector =====
function renderCollectorUI() {
  const b = document.getElementById('robotPrompt');
  const items = Object.keys(App.inv);
  const rows = items.map(it =>
    `<div class="collect-row d-flex align-items-center justify-content-between">
      <div><strong>${it}</strong><span class="badge rounded-pill bg-secondary ms-2" data-rcount="${it}">${App.inv[it]}</span></div>
      <input type="number" min="0" max="3" step="1" class="form-control" style="width:90px" data-collect="${it}" placeholder="0">
    </div>`
  ).join('');


  b.innerHTML =
    `<div class="alert alert-info">
      <div class="mb-2">Robot requests items. Enter how many to collect (max 3 each) and start collection.</div>
      <div class="d-flex flex-column gap-2">${rows}</div>
      <div class="text-end mt-3"><button id="startCollectBtn" class="btn btn-primary btn-sm">Start Collection</button></div>
    </div>`;
  b.style.display = 'block';


  document.getElementById('startCollectBtn').onclick = () => {
    if (App.robot.collecting) return;


    const payload = {};
    document.querySelectorAll('[data-collect]').forEach(inp => {
      const name = inp.getAttribute('data-collect');
      let n = parseInt(inp.value || '0', 10);
      if (isNaN(n)) n = 0;
      if (n > 3) n = 3;
      if (n > 0) payload[name] = n;
    });


    if (Object.keys(payload).length === 0) {
      pushRobotFeed('Enter amounts > 0 before starting (max 3 each).');
      return;
    }


    const totalUnits = Object.values(payload).reduce((acc, v) => acc + Number(v || 0), 0);
    let durationMs = totalUnits * PER_ITEM_MS;
    if (durationMs <= 0) durationMs = PER_ITEM_MS;


    App.robot.collecting = true;
    document.querySelectorAll('[data-collect]').forEach(inp => inp.disabled = true);
    document.getElementById('startCollectBtn').disabled = true;


    pushRobotFeed(`Collecting… (~${(durationMs / 1000).toFixed(1)}s)`);
    playRobotVideo(true);


    setT(() => {
      Object.entries(payload).forEach(([k, v]) => {
        App.inv[k] = (App.inv[k] ?? 0) + Number(v);
      });
      saveState();
      renderInventory();
      renderTask();
      Object.keys(payload).forEach(k => {
        const badge = document.querySelector(`[data-rcount="${CSS.escape(k)}"]`);
        if (badge) badge.textContent = App.inv[k];
      });
      pushRobotFeed('Collection finished.');
      App.summary.conditions.push({
        t: nowMs(),
        type: 'interactive',
        subtype: 'collect',
        duration_ms: durationMs,
        extra: { payload: payload, total_units: totalUnits }
      });
      L('interactive_collect_done', { payload, duration_ms: durationMs, total_units: totalUnits });
      clearRobotPrompt();
      App.robot.collecting = false;
      playRobotVideo(false);
      endConditionWithGap(20_000);
    }, durationMs);
  };
}


function clearRobotPrompt() {
  const b = document.getElementById('robotPrompt');
  b.innerHTML = '';
  b.style.display = 'none';
}


// ===== Conditions =====
function scheduleNextCondition(ms) {
  const t = nowMs() + ms;
  App.condition.nextAllowedAt = t;
  App.queue.nextPlannedAt = t;
}


function canLaunchCondition() {
  if (App.sessionOver) return false;
  const now = nowMs();
  return (!App.condition.active) &&
    now >= App.condition.nextAllowedAt &&
    now >= App.queue.nextPlannedAt;
}


function remainingTypes() {
  const left = [];
  if (App.mode === 'interactive' && App.queue.counts.interactive > 0) left.push('interactive');
  if (App.mode === 'silent' && App.queue.counts.silent > 0) left.push('silent');
  return left;
}


function launchCondition() {
  if (!canLaunchCondition()) return false;
  const choices = remainingTypes();
  if (choices.length === 0) return false;
  const mode = choice(choices);
  App.queue.counts[mode] -= 1;
  beginCondition(mode);
  return true;
}


function beginCondition(mode) {
  if (App.sessionOver) return;
  App.condition.active = true;
  App.condition.mode = mode;


  if (mode === 'interactive') {
    renderCollectorUI();
    pushRobotFeed('Requested human approval to collect supplies (interactive).');
  } else if (mode === 'silent') {
    const startT = nowMs();
    const numTypes = Object.keys(App.inv).length;
    const totalUnits = numTypes * 2;
    const durationMs = totalUnits * PER_ITEM_MS;


    pushRobotFeed(`(Silent) Restocking all items (+2 each, ~${(durationMs / 1000).toFixed(1)}s)…`);
    L('silent_restock_start', { all: true, total_units: totalUnits, duration_ms: durationMs });
    playRobotVideo(true);


    setT(() => {
      Object.keys(App.inv).forEach(k => {
        App.inv[k] = (App.inv[k] ?? 0) + 2;
      });
      saveState();
      renderInventory();
      renderTask();
      pushRobotFeed('Silent restock complete (+2 each item).');
      App.summary.conditions.push({
        t: startT,
        type: 'silent',
        subtype: 'restock_all',
        duration_ms: durationMs,
        extra: { delta: 2, total_units: totalUnits }
      });
      L('silent_restock_end', { all: true, delta: 2, total_units: totalUnits, duration_ms: durationMs });
      playRobotVideo(false);
      endConditionWithGap(20_000);
    }, durationMs);
  }
}


function endConditionWithGap(msGap) {
  App.condition.active = false;
  App.condition.mode = null;
  scheduleNextCondition(msGap);
  saveState();
}


function wireSkipTask() {
  var btn = document.getElementById('skipTaskBtn');
  if (!btn) return;


  btn.addEventListener('click', function () {
    if (!App.task || App.sessionOver) return;


    var done = true;
    Object.keys(App.task.req).forEach(function (it) {
      var need = App.task.req[it];
      if ((App.task.prog[it] || 0) < need) {
        done = false;
      }
    });


    var finishedAt = nowMs();
    var assignedAt = App.task.t0 || finishedAt;
    var completionMs = finishedAt - assignedAt;
    var numClicksThisTask = App.task.clicksCount || 0;


    App.summary.tasks.push({
      t: assignedAt,
      id: App.task.id,
      items: App.task.req,
      progress: Object.assign({}, App.task.prog || {}),
      completed_at: finishedAt,
      fully_met: done
    });


    L('task_submit', {
      id: App.task.id,
      fully_met: done,
      progress: Object.assign({}, App.task.prog || {})
    });


    // send per-task row
    try {
      var ids = getParticipantInfo();
      var payload = {
        participant_id: ids.participant_id,
        worker_id: ids.worker_id,
        assignment_id: ids.assignment_id,
        unique_id: ids.participant_id,


        mode: App.mode,
        task_id: App.task.id,
        task_assigned_ms: assignedAt,
        task_completed_ms: finishedAt,
        task_completion_ms: completionMs,
        task_accuracy: done ? 1 : 0,
        num_clicks_this_task: numClicksThisTask,
        recorded_at_iso: new Date().toISOString()
      };


      $.ajax({
        type: "POST",
        url: "/record_taskdata",
        data: { taskdata: JSON.stringify(payload) },
        async: true
      });
    } catch (errTask) {
      console.log("Error sending taskdata:", errTask);
    }


    App.task = null;
    App.plan.nextTaskAt = nowMs() + 30000;
    saveState();
    renderTask();
  });
}


// ===== Heartbeat =====
function mainHeartbeat() {
  const tick = () => {
    if (App.sessionOver) return;
    const now = nowMs();
    maybeSpawnTask(now);
    if (canLaunchCondition()) launchCondition();
    setT(tick, 1000);
  };
  setT(tick, 100);
}


// ===== Condition summary helper =====
function sendConditionSummary() {
  try {
    var ids = getParticipantInfo();


    var tasksDone = (App.summary.tasks || []).filter(function (t) {
      return t.completed_at != null;
    });


    var numTasks = tasksDone.length;
    var totalCompletion = 0;
    var totalAcc = 0;


    tasksDone.forEach(function (t) {
      var assignedAt = t.t || t.t0 || App.startAt;
      var completionMs = t.completed_at - assignedAt;
      if (completionMs < 0) completionMs = 0;
      totalCompletion += completionMs;
      totalAcc += (t.fully_met ? 1 : 0);
    });


    var meanCompletion = numTasks ? (totalCompletion / numTasks) : "";
    var meanAccuracy = numTasks ? (totalAcc / numTasks) : "";


    var totalClicks = (App.summary.inventoryClicks || []).length;
    var meanClicksPerTask = (numTasks && totalClicks !== "") ? (totalClicks / numTasks) : "";


    var conds = (App.summary.conditions || []).filter(function (c) {
      return c.type === App.mode;
    });
    var numRestocks = conds.length;
    var totalRestockUnits = 0;
    conds.forEach(function (c) {
      if (c.extra && typeof c.extra.total_units === "number") {
        totalRestockUnits += c.extra.total_units;
      }
    });


    var wlVals = (App.summary.wl_answers || []).filter(function (w) {
      return w.mode === App.mode && w.rating != null && w.rating !== "";
    }).map(function (w) { return Number(w.rating); });


    var meanWL = "";
    if (wlVals.length > 0) {
      var s = 0;
      wlVals.forEach(function (v) { s += v; });
      meanWL = s / wlVals.length;
    }


    var condPayload = {
      participant_id: ids.participant_id,
      worker_id: ids.worker_id,
      assignment_id: ids.assignment_id,
      unique_id: ids.participant_id,


      mode: App.mode,
      num_tasks: numTasks,
      mean_task_completion_ms: meanCompletion,
      mean_task_accuracy: meanAccuracy,
      total_item_clicks: totalClicks,
      mean_clicks_per_task: meanClicksPerTask,
      num_restocks: numRestocks,
      total_restock_units: totalRestockUnits,
      wl_answers_json: JSON.stringify(App.summary.wl_answers || []),
      mean_workload: meanWL,
      recorded_at_iso: new Date().toISOString()
    };


    $.ajax({
      type: "POST",
      url: "/record_conditiondata",
      data: { conditiondata: JSON.stringify(condPayload) },
      async: true
    });
  } catch (errCond) {
    console.log("Error sending conditiondata:", errCond);
  }
}


// ===== Finish modal + clock + WL =====
function showFinishModal() {
  App.sessionOver = true;
  clearTimers();
  clearRobotPrompt();
  document.getElementById('wlPopup').style.display = 'none';
  playRobotVideo(false);


  App.summary.endAt = nowMs();
  App.summary.finalInventory = App.inv;
  saveState();


  // send condition-level summary for this mode
  sendConditionSummary();


  // ===== NEW: also record participant_id into PsiTurk trialdata =====
  try {
    if (typeof psiturk !== "undefined") {
      var ids = getParticipantInfo();
      psiturk.recordTrialData({
        participant_id: ids.participant_id,
        mode: App.mode,
        summary: App.summary
      });
      psiturk.saveData({});
    }
  } catch (e) {
    console.error("psiturk error:", e);
  }


  const qs = window.location.search || "";
  const nextBase = (App.mode === "interactive")
      ? "/questionnaire_interactive"
      : "/questionnaire_silent";


  const nextUrl = nextBase + qs;
  const endUrl  = "/complete" + qs;


  let modal = document.getElementById('expDoneModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'expDoneModal';
    modal.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
    modal.innerHTML =
      `<div style="width:min(520px,92vw);background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
         <h5 class="mb-2">Session complete</h5>
         <div class="mb-3">Thanks! You can continue to a brief post-experiment survey.</div>
         <div class="d-flex gap-2 justify-content-end">
           <a class="btn btn-outline-secondary" id="btnEnd" href="${endUrl}">End Experiment</a>
           <a class="btn btn-primary" id="btnNext" href="${nextUrl}">Continue</a>
         </div>
       </div>`;
    document.body.appendChild(modal);
  } else {
    const next = document.getElementById('btnNext');
    const end = document.getElementById('btnEnd');
    if (next) next.href = nextUrl;
    if (end)  end.href  = endUrl;
    modal.style.display = 'flex';
  }
}


function startClock() {
  const el = document.getElementById('timer');
  const endAt = App.startAt + App.durSec * 1000;


  const tick = () => {
    if (App.sessionOver) return;
    const now = nowMs();
    const elapsed = now - App.startAt;
    const mm = String(Math.floor(elapsed / 60000)).padStart(2, '0');
    const ss = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
    el.textContent = `${mm}:${ss}`;


    const remain = endAt - now;
    if (remain <= 0) {
      document.getElementById('taskStatus').textContent = 'Session complete.';
      document.getElementById('robotStatus').textContent = 'Session complete.';
      L('session_complete', { mode: App.mode });
      showFinishModal();
      return;
    }
    setT(tick, 1000);
  };
  tick();
}


const Workload = (function () {
  function open() {
    if (App.sessionOver) return;
    App.wl.choice = null;
    App.wl.opened = performance.now();
    const d = document.getElementById('wlPopup');
    d.style.display = 'flex';
    document.querySelectorAll('#wlChoices [data-v]').forEach(b => b.classList.remove('sel'));
  }
  function schedule(first = false) {
    clearTimeout(App.wl.t);
    if (App.sessionOver) return;
    App.wl.t = setTimeout(open, first ? App.wl.firstAfter : App.wl.every);
  }
  function init() {
    document.getElementById('wlChoices').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      App.wl.choice = b.getAttribute('data-v');
      document.querySelectorAll('#wlChoices [data-v]').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
    });
    document.getElementById('wlSubmit').addEventListener('click', () => {
      if (App.sessionOver) return;
      const rt = Math.round(performance.now() - App.wl.opened);
      App.summary.wl_answers.push({ t: nowMs(), rating: App.wl.choice, rt_ms: rt, mode: App.mode });
      L('WL', { rating: App.wl.choice, rt_ms: rt, mode: App.mode });
      document.getElementById('wlPopup').style.display = 'none';
      schedule(false);
      document.getElementById('wlMini').textContent = `Last WL: ${App.wl.choice ?? '—'}`;
      saveState();
    });
    schedule(true);
  }
  return { init };
})();


// ===== Boot =====
window.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderInventory();
  renderTask();
  wireSkipTask();
  mainHeartbeat();
  startClock();
  Workload.init();
});





