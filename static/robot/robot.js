// Robot View — single video (moxi.webm), per-item inputs, 20s run, then "Go to Main Page".
(function(){
  const $ = s => document.querySelector(s);
  const SS = {
    restockPayload: 'hr_restock_payload_json', // {items:{}, applied:'0'|'1'}
    robotBusyUntil: 'hr_robot_busy_until_ms',
    robotBusyLabel: 'hr_robot_busy_label',
    inventory: 'hr_inventory_json'             // used only to generate item list
  };

  const RUN_MS = 20_000; // fixed 20s

  // 1) Point the video to YOUR file: moxi.webm
  function setVideo(){
    const src = `/static/robot/videos/moxi1.webm`;
    $('#srcWebm').src = src;
    const v = $('#robotClip');
    v.load();
  }

  // 2) Build inputs from current inventory keys (or a default list)
  function buildInputs(){
    const inv = loadJSON(SS.inventory) || {};
    const items = Object.keys(inv).length ? Object.keys(inv)
                 : ['Cotton','Syringe','Gloves','Gauze','Tape','IV Bags','Mask'];
    const inputs = $('#inputs'); inputs.innerHTML = '';
    items.forEach(it=>{
      const box = document.createElement('div'); box.className='box';
      const label = document.createElement('div'); label.textContent = it;
      const row = document.createElement('div'); row.className='row';
      const num = document.createElement('input'); num.type='number'; num.min='0'; num.step='1'; num.value='0'; num.dataset.item=it;
      row.appendChild(num);
      box.appendChild(label); box.appendChild(row);
      inputs.appendChild(box);
    });
  }

  // 3) Start collection: play video, set busy window, after 20s save payload, show popup
  function startRun(){
    // Build payload from inputs NOW (what user *wants to be collected*)
    const payload = { items:{}, applied:'0' };
    [...document.querySelectorAll('#inputs input[type=number]')].forEach(inp=>{
      const n = Math.max(0, parseInt(inp.value||'0',10));
      if (n>0) payload.items[inp.dataset.item] = (payload.items[inp.dataset.item]||0) + n;
    });

    // Mark busy window so main page won't apply early
    const until = Date.now() + RUN_MS;
    sessionStorage.setItem(SS.robotBusyUntil, String(until));
    sessionStorage.setItem(SS.robotBusyLabel, 'Collecting…');
    $('#runStatus').textContent = `Collecting for ${Math.round(RUN_MS/1000)}s…`;

    // Try to play video
    const vid = $('#robotClip');
    try { vid.currentTime = 0; vid.play().catch(()=>{}); } catch(e){}

    // After 20s, finalize and show "Go to Main Page"
    setTimeout(()=>{
      saveJSON(SS.restockPayload, payload);
      // clear busy
      sessionStorage.removeItem(SS.robotBusyUntil);
      sessionStorage.setItem(SS.robotBusyLabel, 'Restock ready');
      $('#runStatus').innerHTML = '<span class="good">Ready to apply on main page.</span>';
      // Show popup
      $('#donePopup').style.display = 'flex';
    }, RUN_MS);
  }

  // 4) Return to main page (prefer referrer; fallback to /exp)
  function goMain(){
    if (document.referrer) {
      location.href = document.referrer;
    } else {
      // If your main page route is different, change this path accordingly:
      location.href = '/exp';
    }
  }

  // helpers
  function loadJSON(k){ try{ return JSON.parse(sessionStorage.getItem(k)); } catch{ return null; } }
  function saveJSON(k,v){ sessionStorage.setItem(k, JSON.stringify(v)); }

  // wire + boot
  window.addEventListener('DOMContentLoaded', ()=>{
    setVideo();
    buildInputs();
    $('#startRunBtn').addEventListener('click', startRun);
    $('#goMainBtn').addEventListener('click', goMain);
    $('#backBtn').addEventListener('click', goMain);
  });
})();



