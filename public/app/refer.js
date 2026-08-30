initApp().then(async (user) => {
  if (!user) return;
  const data = await api('/api/referrals');

  document.getElementById('subLine').textContent =
    'Membership: ' + user.plan.charAt(0).toUpperCase() + user.plan.slice(1) + ' · ' + statusBadge(user.status);
  document.getElementById('thresholdTxt').textContent = data.threshold;
  document.getElementById('bonusTxt').textContent = data.bonusDays + ' days';
  document.getElementById('countTxt').textContent = Math.min(data.confirmed, data.threshold);
  document.getElementById('confirmedTxt').textContent = data.confirmed;
  document.getElementById('bar').style.width = Math.min(100, (data.confirmed / data.threshold) * 100) + '%';

  const linkEl = document.getElementById('link');
  linkEl.value = data.link;
  document.getElementById('copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(data.link);
      document.getElementById('copied').textContent = 'Copied! Share it with your friends.';
    } catch (e) {
      linkEl.select();
      document.execCommand('copy');
      document.getElementById('copied').textContent = 'Copied! Share it with your friends.';
    }
  });

  const box = document.getElementById('listBox');
  if (!data.invited.length) {
    box.innerHTML = '<p class="empty">No invites yet — share your link above.</p>';
    return;
  }
  box.innerHTML = `
    <div style="overflow-x:auto">
    <table class="tbl">
      <tr><th>Email</th><th>Status</th></tr>
      ${data.invited.map((i) => `
        <tr>
          <td>${escapeHtml(i.email)}</td>
          <td>${i.paid ? '<span class="badge badge-active">PAID ✓</span>' : statusPillLocal(i.status)}</td>
        </tr>`).join('')}
    </table></div>`;
});

function statusPillLocal(s) {
  if (s === 'active' || s === 'trial') return '<span class="badge badge-trial">' + s.toUpperCase() + '</span>';
  return '<span class="badge badge-expired">NOT PAID</span>';
}