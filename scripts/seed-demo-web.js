(async () => {
  const marker = JSON.parse(await app.vault.adapter.read('.demo/marker.json'));
  if (marker.id !== 'top-of-the-desk-release-demo') throw new Error('This is not the release demo vault. Nothing was changed.');
  const fixture = JSON.parse(await app.vault.adapter.read('.demo/history.json'));
  const plugin = app.plugins.plugins['top-of-the-desk'];
  if (!plugin) throw new Error('Enable Top of the Desk in the demo vault first.');
  const now = new Date();
  // Synthetic presentation data only; do not write into Obsidian's browser database.
  // A real Web viewer navigation or plugin reload replaces these in-memory entries.
  plugin.webHistory.entries = fixture.web.map(entry => ({kind:'web',url:entry.url,title:entry.title,
    openedAt:Math.min(Date.now()-1000,new Date(now.getFullYear(),now.getMonth(),now.getDate()-entry.daysAgo,entry.hour).getTime())}));
  plugin.refreshViews({widgets:['recents']});
  return 'Synthetic website history applied in the isolated demo only.';
})()
