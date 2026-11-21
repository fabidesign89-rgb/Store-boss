'use strict';
(async function boot() {
  try {
    const [cfg, me] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/auth/me')]);
    DF.config = cfg; DF.user = me.user;
    await refreshUnread();
  } catch (e) { render(`<div class="wrap page"><div class="alert err" role="alert">${esc(e.message)}</div></div>`); return; }
  await run();
})();
