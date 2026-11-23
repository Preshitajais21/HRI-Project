(function(){
  function qp(name, def=null){ const u=new URL(location.href); return u.searchParams.get(name) ?? def; }
  const backUrl = qp('return','/exp');
  const back = document.getElementById('backBtn'); if (back) back.setAttribute('href', backUrl);
  const vid = document.getElementById('robotVideo'); vid?.play?.().catch(()=>{});
})();



