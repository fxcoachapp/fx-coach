initApp().then((user) => {
  if (!user) return;
  if (user.admin) { showVip(user); return; }
  if (user.status === 'active') { showVip(user); return; }
  document.getElementById('wall').classList.remove('hidden');
  document.getElementById('vipWrap').classList.add('hidden');
});

function showVip(user) {
  document.getElementById('vipWrap').classList.remove('hidden');
  document.getElementById('wall').classList.add('hidden');
  document.getElementById('nameTxt').textContent = user.name;
  const until = user.planEnds || user.trialEnds;
  document.getElementById('untilTxt').textContent = until ? new Date(until).toLocaleDateString() : '—';
}