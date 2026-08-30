initApp().then(async (user) => {
  if (!user) return;
  const data = await api('/api/referrals');

  document.getElementById('subLine').textContent =
    'Membership: ' + user.plan.charAt(0).toUpperCase() + user.plan.slice(1) + ' · ' + statusBadge(user.status);
  document.getElementById('thresholdTxt').textContent = data.threshold;
  document.getElementById('bonusTxt').textContent = data.bonusDays + ' days';
  document.getElementById('countTxt').textContent = Math.min(data.confirmed, data.threshold);
  document.getElementById('countTxt2').textContent = data.nextAtPaid;
  document.getElementById('confirmedTxt').textContent = data.confirmed;
  document.getElementById('bar').style.width = Math.min(100, (data.confirmed / data.threshold) * 100) + '%';
  document.getElementById('earnedTxt').textContent = data.earnedBonuses > 0 ? ('Bonus earned ' + (data.earnedBonuses * data.bonusDays) + ' days so far 🎉') : 'Pay confirmed invites to unlock free days.';

  const board = document.getElementById('leaderboard');
  if (!(data.leaderboard || []).length) {
    board.innerHTML = '<p class="empty">Be the first inviter to appear here — share your link and get friends signed up.</p>';
  } else {
    board.innerHTML = `
      <div style="overflow-x:auto">
      <table class="tbl">
        <tr><th>#</th><th>Inviter</th><th>Invites</th><th>Paid</th></tr>
        ${data.leaderboard.map((l, i) => `
          <tr>
            <td>${i + 1 <= 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
            <td>${escapeHtml(l.name)}</td>
            <td>${l.invites}</td>
            <td>${l.paid}</td>
          </tr>`).join('')}
      </table></div>
      <p class="small" style="margin-top:10px">Names are masked. Ranked by paid invites first.</p>`;
  }

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