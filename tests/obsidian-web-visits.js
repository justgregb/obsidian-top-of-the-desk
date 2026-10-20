(async () => {
  const marker = JSON.parse(await app.vault.adapter.read('.demo/marker.json'));
  if (app.vault.getName() !== 'Top of the Desk Release QA' || marker.id !== 'top-of-the-desk-release-demo') throw new Error('Use the disposable demo vault.');
  const url = LOCAL_TEST_URL, id = 'top-of-the-desk', storage = 'top-of-the-desk:web-visits';
  const saved = app.loadLocalStorage(storage), coreWasEnabled = !!app.internalPlugins.getEnabledPluginById('webviewer');
  const checks = [], plugin = () => app.plugins.plugins[id], entry = () => plugin().webHistory.entries.find(page => page.url === url);
  const assert = (ok, text) => { if (!ok) throw new Error(text); checks.push(text); };
  const wait = async (predicate, label) => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
    throw new Error('Timed out: ' + label);
  };
  const showDesk = async () => {
    await plugin().openDesk();
    app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('top-of-the-desk-home')[0], { focus: true });
  };
  let leaf, store;
  try {
    if (!coreWasEnabled) await app.internalPlugins.plugins.webviewer.enable();
    await wait(() => app.internalPlugins.getEnabledPluginById('webviewer')?.db?.db, 'Web viewer database');
    store = app.internalPlugins.getEnabledPluginById('webviewer').db;
    await showDesk();
    const yesterday = Date.now() - 86400000;
    await store.db.put('history', { url, title: 'Web revisit check', accessTs: yesterday });
    app.workspace.trigger('webviewer:update-history');
    await wait(() => entry()?.openedAt === yesterday, 'Yesterday’s native visit');
    assert(plugin().recents.group(entry().openedAt).key === 'earlier', 'An untouched page from yesterday begins in Earlier');
    leaf = app.workspace.getLeaf('tab');
    const started = Date.now();
    await leaf.setViewState({ type: 'webviewer', active: true, state: { url, navigate: true } });
    await wait(() => entry()?.openedAt >= started, 'Visible Web viewer visit');
    assert(plugin().recents.group(entry().openedAt).key === 'today', 'Viewing the existing URL moves it into Today');
    await wait(() => leaf.getViewState().state.url === url, 'Web viewer state');
    await showDesk();
    await new Promise(resolve => setTimeout(resolve, 150));
    const viewedAt = entry().openedAt;
    await app.plugins.disablePlugin(id); await app.plugins.enablePlugin(id);
    await wait(() => entry()?.openedAt >= viewedAt, 'Persisted revisit');
    assert(entry().openedAt >= viewedAt, 'A revisit survives a real plugin reload');
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await wait(() => entry()?.openedAt > viewedAt, 'Return to existing tab');
    assert(entry().openedAt > viewedAt, 'Switching back to an existing tab renews its timestamp');
    await showDesk();
    await wait(() => !plugin().webHistory.active && !plugin().webHistory.timer && !plugin().webHistory.loading, 'Settled background tab');
    const beforeClose = entry().openedAt;
    leaf.detach(); leaf = null;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert(entry().openedAt === beforeClose, 'Closing the background tab does not renew it');
    for (const record of await store.getHistoryItems()) if (record.url === url) await store.removeHistoryItem(record);
    await wait(() => !entry(), 'Deleted history');
    assert(!(app.loadLocalStorage(storage) || []).some(page => page.url === url), 'Deleting the native visit removes its local revisit record');
    return { passed: checks.length, checks };
  } catch (error) { return { passed: checks.length, checks, error: String(error), stack: error.stack }; }
  finally {
    leaf?.detach();
    if (store) for (const record of await store.getHistoryItems()) if (record.url === url) await store.removeHistoryItem(record);
    if (!coreWasEnabled) app.internalPlugins.plugins.webviewer.disable();
    await app.plugins.disablePlugin(id);
    app.saveLocalStorage(storage, saved ?? null);
    await app.plugins.enablePlugin(id); await showDesk();
  }
})()
