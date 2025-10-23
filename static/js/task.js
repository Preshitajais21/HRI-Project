// Hospital Robot Inventory Supervision — MAIN PAGE (BUILD v3)
// Conditions via ?cond=silent|interactive|yn
// Duration via ?dur=SECONDS (e.g., 60 or 480). Optional &fast=1 to compress long intervals for demos.
(function(){
  const $ = s => document.querySelector(s);

  // ---------- SessionStorage Keys ----------
  const SS = {
    startAt: 'hr_start_ms',
    inventory: 'hr_inventory_json',
    activeTask: 'hr_active_task_json',
    nextTaskAt: 'hr_next_task_ms',

    cond: 'hr_condition',

    currentQ: 'hr_currentQ',
    qAnswered: 'hr_currentQ_ans',

    restockPayload: 'hr_restock_payload_json',  // {items:{}, applied:"0"/"1"}
    robotBusyUntil: 'hr_robot_busy_until_ms',   // timestamp while robot runs
    robotBusyLabel: 'hr_robot_busy_label'       // e.g., "Restocking Cotton (+3)"
  };

  // ---------- URL Params ----------
  const qs = new URLSearchParams(location.search);
  const COND = (qs.get('cond') || sessionStorage.getItem(SS.cond) || 'interactive').toLowerCase();
  sessionStorage.setItem(SS.cond, COND);

  let TOTAL_RUN_MS = (parseInt(qs.get('dur'), 10) || 60) * 1000; // default 1 minute
  if (!isFinite(TOTAL_RUN_MS) || TOTAL_RUN_MS < 0) TOTAL_RUN_MS = 60 * 1000;

  const FAST = qs.get('fast') === '1';
  const scale = FAST ? 0.2 : 1.0;

  // ---------- Timing knobs ----------
  const WORKLOAD_RATING_EVERY_MS = 40_000 * scale;  // ← per request
  const SA_EVERY_MS               = 50_000 * scale;  // ← per request
  const NEXT_TASK_DELAY_MS        = 30_000 * scale;  // exactly 30s after completion
  const YN_QUESTION_EVERY_MS      = 25_000 * scale;
  const INTERACTIVE_Q_EVERY_MS    = 25_000 * scale;
  const SILENT_RESTOCK_EVERY_MS   = (60_000 + Math.floor(Math.random()*30_000)) * scale; // 60–90s
  const ROBOT_RUN_DURATION_MS     = (20_000 + Math.floor(Math.random()*10_000)); // 20–30s

  // ---------- Logger (psiTurk-friendly) ----------
  const Log = (() => {
    const key = 'hr_log_events';
    function now(){ return new Date().toISOString(); }
    function pushLocal(evt){
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      arr.push(evt);
      localStorage.setItem(key, JSON.stringify(arr));
    }
    function record(type, payload){
      const row = { t: now(), type, ...payload };
      if (window.psiTurk && typeof window.psiTurk.recordTrialData === 'function') {
        const flat = {};
        for (const [k,v] of Object.entries(row)){
          flat[k] = (typeof v === 'object') ? JSON.stringify(v) : v;
        }
        try { window.psiTurk.recordTrialData(flat); } catch(e){ pushLocal(row); }
      } else {
        pushLocal(row);
        if (console && console.log) console.log('[LOG]', row);
      }
    }
    function flush(){
      if (window.psiTurk && typeof window.psiTurk.saveData === 'function') {
        try { window.psiTurk.saveData({success:()=>console.log('psiTurk saved')}); } catch(e){}
      } else {
        console.log('Local log (no psiTurk):', JSON.parse(localStorage.getItem(key) || '[]'));
      }
    }
    return { record, flush };
  })();

  // ---------- Inventory Model ----------
  const INITIAL_INV = {
    Cotton: 12,
    Syringe: 14,
    Gloves: 10,
    Gauze: 10,
    Tape: 8,
    'IV Bags': 6,
    Mask: 12
  };
  let INV = loadJSON(SS.inventory) || { ...INITIAL_INV };
  const ITEM_LIST = Object.keys(INV);

  // ---------- Active Task (exactly one) ----------
  let activeTask = loadJSON(SS.activeTask) || null;
  let nextTaskAt = parseInt(sessionStorage.getItem(SS.nextTaskAt) || '0', 10) || 0;
  let taskCountdownId = null;

  // ---------- Timer Persistence ----------
  function ensureStart(){
    let start = sessionStorage.getItem(SS.startAt);
    if (!start) {
      start = String(Date.now());
      sessionStorage.setItem(SS.startAt, start);
    }
    return parseInt(start, 10);
  }
  function fmtTime(ms){
    const s = Math.max(0, Math.floor(ms/1000));
    const mm = String(Math.floor(s/60)).padStart(2,'0');
    const ss = String(s%60).padStart(2,'0');
    return `${mm}:${ss}`;
  }

  // ---------- Utils ----------
  function saveJSON(key, obj){ sessionStorage.setItem(key, JSON.stringify(obj)); }
  function loadJSON(key){ try{ return JSON.parse(sessionStorage.getItem(key)); } catch(e){ return null; } }
  function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

  function randomTask(){
    // pick 2–3 distinct items with random small quantities (1–4)
    const count = randInt(2,3);
    const shuffled = [...ITEM_LIST].sort(()=>Math.random()-0.5);
    const choose = shuffled.slice(0, count);
    const need = {};
    choose.forEach(it => need[it] = randInt(1,4));
    return { id:`T${Date.now()}`, need, fulfilled:{} };
  }
  function taskRemaining(t){
    const rem = {};
    for (const k of Object.keys(t.need)){
      const got = t.fulfilled[k] || 0;
      rem[k] = Math.max(0, t.need[k]-got);
    }
    return rem;
  }
  function isTaskComplete(t){
    return Object.values(taskRemaining(t)).every(v => v===0);
  }

  // ---------- Render Inventory ----------
  function renderInventory(){
    const grid = $('#invGrid');
    grid.innerHTML = '';
    for (const item of ITEM_LIST){
      const div = document.createElement('div');
      div.className = 'invItem';
      div.title = 'Click to allocate to the active task';
      const label = document.createElement('span'); label.textContent = item;
      const val = document.createElement('strong'); val.textContent = INV[item];
      div.appendChild(label); div.appendChild(val);
      div.addEventListener('click', ()=> useItemForTask(item));
      grid.appendChild(div);
    }
  }

  function useItemForTask(item){
    if (!activeTask) return;
    const rem = taskRemaining(activeTask);
    if ((rem[item]||0) > 0 && INV[item] > 0){
      const before = INV[item];
      INV[item] -= 1;
      activeTask.fulfilled[item] = (activeTask.fulfilled[item]||0) + 1;
      saveJSON(SS.inventory, INV);
      saveJSON(SS.activeTask, activeTask);
      renderInventory();
      renderTask();

      Log.record('inventory_click', {
        task_id: activeTask.id,
        item,
        before_qty: before,
        after_qty: INV[item]
      });

      if (isTaskComplete(activeTask)){
        $('#taskStatus').textContent = 'Task complete ✅';
        Log.record('task_complete', {
          task_id: activeTask.id,
          need: activeTask.need,
          fulfilled: activeTask.fulfilled
        });
        activeTask = null; saveJSON(SS.activeTask, activeTask);
        scheduleNextTaskAfterCompletion();
      }
    } else {
      $('#taskStatus').textContent = 'Cannot use this item now.';
    }
  }

  // ---------- Task Scheduling & UI ----------
  function renderTask(){
    const text = $('#taskText');
    const needDiv = $('#taskNeed');
    if (!activeTask){
      text.textContent = 'No active task. Waiting for the next task…';
      needDiv.innerHTML = '';
      return;
    }
    const rem = taskRemaining(activeTask);
    text.textContent = 'Fulfil the request by clicking inventory items:';
    needDiv.innerHTML = '';
    for (const [k,v] of Object.entries(rem)){
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `${k}: ${v} remaining`;
      needDiv.appendChild(chip);
    }
  }

  function showNextTaskCountdown(){
    clearInterval(taskCountdownId);
    taskCountdownId = setInterval(()=>{
      if (!nextTaskAt){ $('#taskTimer').textContent = ''; return; }
      const remain = Math.max(0, nextTaskAt - Date.now());
      if (remain <= 0){
        $('#taskTimer').textContent = '';
        clearInterval(taskCountdownId);
        return;
      }
      $('#taskTimer').textContent = `Next task in ${fmtTime(remain)}`;
    }, 250);
  }

  function scheduleNextTaskAfterCompletion(){
    const now = Date.now();
    nextTaskAt = now + NEXT_TASK_DELAY_MS;
    sessionStorage.setItem(SS.nextTaskAt, String(nextTaskAt));
    $('#taskTimer').textContent = `Next task in ${fmtTime(NEXT_TASK_DELAY_MS)}`;
    showNextTaskCountdown();
  }

  function spawnTaskNow(){
    activeTask = randomTask();
    saveJSON(SS.activeTask, activeTask);
    renderTask();
    $('#taskStatus').textContent = 'New task appeared.';
    Log.record('task_spawn', { task_id: activeTask.id, need: activeTask.need });
    // Clear nextTaskAt since we just spawned
    nextTaskAt = 0;
    sessionStorage.setItem(SS.nextTaskAt, '0');
    $('#taskTimer').textContent = '';
    clearInterval(taskCountdownId);
  }

  function maybeSpawnTask(){
    if (activeTask) return; // only one task at a time
    if (nextTaskAt && Date.now() >= nextTaskAt){
      spawnTaskNow();
    }
  }

  // ---------- Workload Popup (every 40s) ----------
  const Workload = (() => {
    const POPUP_MS = WORKLOAD_RATING_EVERY_MS;
    let timer = null;
    let selected = null;
    let popupOpenAt = 0;

    function open(){
      selected = null;
      popupOpenAt = performance.now();
      const dlg = $('#wlPopup'); if (!dlg) return;
      dlg.style.display = 'flex';
      document.querySelectorAll('#wlChoices [data-v]').forEach(btn=>{
        btn.classList.remove('sel');
        btn.onclick = () => {
          document.querySelectorAll('#wlChoices [data-v]').forEach(b=>b.classList.remove('sel'));
          btn.classList.add('sel');
          selected = btn.getAttribute('data-v');
        };
      });
    }
    function close(){ const dlg = $('#wlPopup'); if (dlg) dlg.style.display = 'none'; }
    function submit(){
      const rt_ms = Math.round(performance.now() - popupOpenAt);
      Log.record('workload_rating', { rating: selected ? Number(selected) : null, rt_ms });
      close(); schedule();
    }
    function schedule(){ clearTimeout(timer); timer = setTimeout(open, POPUP_MS); }
    function init(){ const btn = $('#wlSubmit'); if (btn) btn.onclick = submit; }
    return { init, schedule };
  })();

  // ---------- SA Popup (every 50s) ----------
  const SA = (() => {
    const POPUP_MS = SA_EVERY_MS;
    let timer = null;
    let openAt = 0;
    let current = null;

    function robotState(){
      const until = parseInt(sessionStorage.getItem(SS.robotBusyUntil) || '0', 10);
      const label = sessionStorage.getItem(SS.robotBusyLabel) || '';
      const stocking = (until && Date.now() < until);
      let item = null;
      const m = /Restocking\s+([^(\+]+)/i.exec(label);
      if (m) item = m[1].trim();
      return { stocking, item, label };
    }

    function open(){
      const dlg = $('#saPopup'); if (!dlg) return;
      openAt = performance.now();
      const gt = robotState();
      const prompt = $('#saPrompt');
      const choices = $('#saChoices'); choices.innerHTML = '';

      if (Math.random() < 0.5){
        current = { kind: 'state', prompt: 'Is the robot currently stocking or idle?', options: ['Stocking','Idle'],
                    correct: gt.stocking ? 'Stocking' : 'Idle' };
      } else {
        const inv = JSON.parse(sessionStorage.getItem(SS.inventory) || '{}');
        const keys = Object.keys(inv).length ? Object.keys(inv) : ['Cotton','Syringe','Gloves','Gauze','Tape','IV Bags','Mask'];
        current = { kind: 'activity', prompt: 'Which item is the robot focused on (if any)?',
                    options: ['None', ...keys], correct: gt.item || 'None' };
      }

      prompt.textContent = current.prompt;
      let selected = null;
      current.options.forEach(o=>{
        const b = document.createElement('button'); b.className='btn'; b.textContent=o;
        b.onclick = ()=>{
          document.querySelectorAll('#saChoices .btn').forEach(x=>x.style.outline='');
          b.style.outline = '2px solid #2563eb';
          selected = o;
        };
        choices.appendChild(b);
      });

      const submit = $('#saSubmit');
      submit.onclick = ()=>{
        const rt_ms = Math.round(performance.now() - openAt);
        const is_correct = (selected != null) ? (selected === current.correct) : null;
        Log.record('sa_response', {
          kind: current.kind,
          prompt: current.prompt,
          selected: selected || null,
          correct: current.correct,
          is_correct,
          rt_ms
        });
        dlg.style.display = 'none';
        schedule();
      };

      dlg.style.display = 'flex';
    }

    function schedule(){ clearTimeout(timer); timer = setTimeout(open, POPUP_MS); }
    return { schedule };
  })();

  // ---------- Robot Questions (YN or Interactive) ----------
  let qTimerId=null;

  function askYNQuestion(){
    const item = ITEM_LIST[randInt(0, ITEM_LIST.length-1)];
    const threshold = randInt(3, 8);
    const text = `Do we have at least ${threshold} ${item}?`;
    const correct = (INV[item] >= threshold) ? 'Yes' : 'No';
    showQuestion({ id:`YN_${Date.now()}`, text, options:['Yes','No'], correct });
  }

  function askInteractiveQuestion(){
    const text = `Robot ready: specify items to collect (use "Show Robot").`;
    showQuestion({ id:`INT_${Date.now()}`, text, options:['OK'], correct:'OK' });
  }

  function showQuestion(q){
    sessionStorage.setItem(SS.currentQ, q.id);
    sessionStorage.setItem(SS.qAnswered, '0');
    $('#qText').textContent = q.text;
    const box = $('#qOptions'); box.innerHTML='';
    q.options.forEach(opt=>{
      const b = document.createElement('button'); b.className='btn'; b.textContent = opt;
      b.onclick = ()=>{
        const correct = (opt === q.correct);
        $('#robotStatus').textContent = `Answered: ${opt} (${correct ? 'correct' : 'received'})`;
        Log.record('robot_question_answer', { qid:q.id, text:q.text, answer:opt, correct });
        sessionStorage.setItem(SS.qAnswered, '1');
        scheduleNextQuestion();
      };
      box.appendChild(b);
    });
  }

  function restoreQuestionIfAny(){
    const qid = sessionStorage.getItem(SS.currentQ) || '';
    const ans = sessionStorage.getItem(SS.qAnswered) === '1';
    if (qid && !ans){
      if (qid.startsWith('YN_')){
        $('#qText').textContent = 'YN question pending — please answer.';
        const box = $('#qOptions'); box.innerHTML='';
        ['Yes','No'].forEach(opt=>{
          const b = document.createElement('button'); b.className='btn'; b.textContent=opt;
          b.onclick = ()=>{
            $('#robotStatus').textContent = `Answered: ${opt}`;
            Log.record('robot_question_answer', { qid, text:'YN (restored)', answer:opt, correct:null });
            sessionStorage.setItem(SS.qAnswered, '1');
            scheduleNextQuestion();
          };
          box.appendChild(b);
        });
      } else {
        $('#qText').textContent = 'Robot awaiting collection input (use "Show Robot").';
        const box = $('#qOptions'); box.innerHTML='';
        const b = document.createElement('button'); b.className='btn'; b.textContent='OK';
        b.onclick = ()=>{
          Log.record('robot_question_answer', { qid, text:'INT (restored)', answer:'OK', correct:true });
          sessionStorage.setItem(SS.qAnswered,'1');
          scheduleNextQuestion();
        };
        box.appendChild(b);
      }
      return true;
    }
    return false;
  }

  function scheduleNextQuestion(){
    clearTimeout(qTimerId);
    if (COND === 'yn'){
      qTimerId = setTimeout(askYNQuestion, YN_QUESTION_EVERY_MS);
    } else if (COND === 'interactive'){
      qTimerId = setTimeout(askInteractiveQuestion, INTERACTIVE_Q_EVERY_MS);
    } else {
      $('#qText').textContent = 'Robot is operating silently.';
      $('#qOptions').innerHTML = '';
    }
  }

  // ---------- Silent Restock (background autonomous) ----------
  let silentTimerId=null, silentBusyTimerId=null;
  function scheduleSilentRestock(){
    if (COND !== 'silent') return;
    clearTimeout(silentTimerId);
    const wait = SILENT_RESTOCK_EVERY_MS;
    silentTimerId = setTimeout(runSilentRestock, wait);
  }

  function runSilentRestock(){
    if (COND !== 'silent') return;
    // pick lowest-count item
    let minItem = null, minVal = Infinity;
    for (const [k,v] of Object.entries(INV)){
      if (v < minVal){ minVal=v; minItem=k; }
    }
    const amount = randInt(2,5);
    const until = Date.now() + ROBOT_RUN_DURATION_MS;
    sessionStorage.setItem(SS.robotBusyUntil, String(until));
    sessionStorage.setItem(SS.robotBusyLabel, `Restocking ${minItem} (+${amount})`);
    $('#silentStatus').textContent = `Silent: ${sessionStorage.getItem(SS.robotBusyLabel)}…`;
    Log.record('robot_silent_run_start', { item:minItem, amount });

    clearTimeout(silentBusyTimerId);
    silentBusyTimerId = setTimeout(()=>{
      INV[minItem] = (INV[minItem]||0) + amount;
      saveJSON(SS.inventory, INV);
      renderInventory();
      $('#silentStatus').textContent = `Silent: completed restock of ${minItem} (+${amount}).`;
      Log.record('robot_silent_run_end', { item:minItem, amount });
      scheduleSilentRestock();
      sessionStorage.removeItem(SS.robotBusyUntil);
      sessionStorage.removeItem(SS.robotBusyLabel);
    }, ROBOT_RUN_DURATION_MS);
  }

  // ---------- Apply pending interactive restock from robot page ----------
  function applyPendingRestockIfAny(){
    const payload = loadJSON(SS.restockPayload);
    if (!payload || payload.applied === '1') return;
    const until = parseInt(sessionStorage.getItem(SS.robotBusyUntil) || '0', 10);
    if (until && Date.now() < until) return; // still busy; try later

    for (const [k,v] of Object.entries(payload.items||{})){
      INV[k] = (INV[k]||0) + v;
    }
    saveJSON(SS.inventory, INV);
    renderInventory();
    payload.applied = '1';
    saveJSON(SS.restockPayload, payload);
    $('#robotStatus').textContent = 'Restock from robot applied.';
    Log.record('robot_restock_applied', { items: payload.items || {} });
  }

  // ---------- Timer & Stop ----------
  let rafId=null, stopId=null;
  function startTimer(){
    const startAt = ensureStart();
    function tick(){
      const elapsed = Date.now() - startAt;
      $('#timer').textContent = fmtTime(elapsed);
      if (isFinite(TOTAL_RUN_MS) && TOTAL_RUN_MS>0 && elapsed >= TOTAL_RUN_MS){
        stopExperiment();
        return;
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    if (isFinite(TOTAL_RUN_MS) && TOTAL_RUN_MS>0){
      const remain = Math.max(0, TOTAL_RUN_MS - (Date.now()-startAt));
      stopId = setTimeout(stopExperiment, remain);
    }
  }
  function stopExperiment(){
    if (rafId) cancelAnimationFrame(rafId);
    clearTimeout(stopId);
    clearTimeout(qTimerId);
    clearTimeout(silentTimerId);
    clearTimeout(silentBusyTimerId);
    clearInterval(taskCountdownId);
    $('#robotStatus').textContent = 'Session complete.';
    Log.flush();
  }

  // ---------- Show Robot ----------
  function showRobot(){
    // If interactive, mark busy window so main page won't apply early
    if (COND === 'interactive'){
      const until = Date.now() + ROBOT_RUN_DURATION_MS;
      sessionStorage.setItem(SS.robotBusyUntil, String(until));
      sessionStorage.setItem(SS.robotBusyLabel, 'Collecting (per user input)…');
    }
    const url = `/static/robot/index.html?cond=${encodeURIComponent(COND)}`;
    location.href = url;
  }

  // ---------- Wire & Boot ----------
  function wire(){
    const condTag = $('#conditionTag'); if (condTag) condTag.textContent = `Cond: ${COND.toUpperCase()}`;
    $('#showRobotBtn')?.addEventListener('click', showRobot);
    $('#skipTaskBtn')?.addEventListener('click', ()=>{
      if (activeTask){
        Log.record('task_skipped', { task_id: activeTask.id, need: activeTask.need, fulfilled: activeTask.fulfilled });
        activeTask = null; saveJSON(SS.activeTask, activeTask);
        $('#taskStatus').textContent = 'Task skipped.';
        renderTask();
        scheduleNextTaskAfterCompletion();
      }
    });

    // Init/plan popups
    Workload.init();
    Workload.schedule();
    SA.schedule();

    // Persist logs on exit
    window.addEventListener('beforeunload', ()=> Log.flush());
  }

  function boot(){
    renderInventory();
    applyPendingRestockIfAny();

    // First task policy: if nothing active and no 'nextTaskAt', spawn immediately
    if (!activeTask && !nextTaskAt){
      spawnTaskNow();
    } else {
      renderTask();
      showNextTaskCountdown();
    }

    if (!restoreQuestionIfAny()) scheduleNextQuestion();
    if (COND === 'silent') scheduleSilentRestock();

    // 1s heartbeat: task spawn + pending restock
    setInterval(()=>{ maybeSpawnTask(); applyPendingRestockIfAny(); }, 1000);

    startTimer();
  }

  window.addEventListener('DOMContentLoaded', ()=>{
    // Optional: show build tag if present in HTML
    const buildTag = $('#buildTag'); if (buildTag) buildTag.textContent = 'BUILD v3';
    wire();
    boot();
  });

})();



