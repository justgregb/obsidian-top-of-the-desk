(async () => {
  const marker = JSON.parse(await app.vault.adapter.read('.demo/marker.json'));
  if (marker.id !== 'top-of-the-desk-release-demo' || app.vault.getName() !== 'Top of the Desk Release QA') throw new Error('Use the isolated QA vault.');
  const p = app.plugins.plugins['top-of-the-desk'], before = structuredClone(p.settings), checks = [];
  const assert = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const shown = el => !!el && el.getClientRects().length > 0;
  let temporaryLeaf;
  try {
    app.setting.close(); await p.openDesk(); await settle();
    const view = app.workspace.getLeavesOfType('top-of-the-desk-home')[0].view;
    assert(document.body.hasClass('tod-desk-active'), 'Desk hides the status bar through local window state');
    temporaryLeaf = app.workspace.getLeaf('tab');
    await temporaryLeaf.openFile(app.vault.getFileByPath('Projects/A quieter morning.md')); await settle();
    assert(!document.body.hasClass('tod-desk-active'), 'Opening another view restores the status bar');
    await p.openDesk(); temporaryLeaf.detach(); temporaryLeaf = null; await settle();
    assert(document.body.hasClass('tod-desk-active'), 'Returning to the desk restores its status-bar state');
    const stackId = Object.entries(p.settings.widgets).find(([,w])=>w.type==='widget-stack' && w.members.includes('daily') && w.members.includes('scratchpad'))[0];
    const positions = [];
    for (const id of ['daily','scratchpad','daily','scratchpad']) {
      p.selectStackWidget(stackId,id); await settle();
      const el = view.widgets.get(id).el, parent = el.getBoundingClientRect();
      const heading = el.querySelector('.tod-section-heading').getBoundingClientRect(), editor = el.querySelector('.tod-note-editor').getBoundingClientRect();
      positions.push([heading.top-parent.top,heading.height,editor.top-parent.top,editor.height]);
      assert(!Array.from(view.contentEl.querySelectorAll('[hidden]')).some(shown), `Hidden elements stay hidden with ${id} selected`);
      assert(getComputedStyle(el.querySelector('.cm-content')).paddingTop==='9px', `${id} retains its editor inset without important overrides`);
    }
    assert(positions.every(p=>p.every((n,i)=>Math.abs(n-positions[0][i])<1)), 'Daily note and Scratchpad retain identical heading and editor geometry');
    for (const [id,config] of Object.entries(p.settings.widgets)) {
      if (!config.enabled || !['pdf','canvas','audio','web'].includes(config.type)) continue;
      const el = view.widgets.get(id).el, body = el.querySelector('.tod-widget-body');
      const visible = Array.from(body.children).some(child=>!child.hidden);
      assert(body.hasClass('has-content')===visible, `${config.type} tracks its compact content state`);
    }
    const widget = view.widgets.get('item-morning'), size = widget.el.querySelector('button[aria-label=Resize]');
    size.click(); await settle();
    assert(widget.el.querySelector('.tod-widget-controls').hasClass('has-expanded-control'), 'Resize keeps its floating controls visible');
    p.sizePicker.close();
    assert(!widget.el.querySelector('.tod-widget-controls').hasClass('has-expanded-control'), 'Closing Resize clears the expanded-control state');
    const baseHost = view.contentEl.querySelector('.tod-base-host');
    const markerRow = baseHost.createDiv('bases-list-item');
    const properties = markerRow.createDiv('bases-list-item-properties'), property = properties.createDiv('bases-list-property');
    property.createSpan('list-bullet'); await settle();
    assert(markerRow.hasClass('tod-bulleted') && !markerRow.hasClass('tod-numbered'), 'Base list markers gain their local bullet gutter');
    property.empty(); property.createSpan('list-number'); await settle();
    assert(markerRow.hasClass('tod-numbered') && !markerRow.hasClass('tod-bulleted'), 'Base list markers update when the marker type changes');
    property.empty(); await settle();
    assert(!markerRow.hasClass('tod-numbered') && !markerRow.hasClass('tod-bulleted'), 'Removing a Base list marker clears its gutter state');
    markerRow.remove();
    p.openSettings(p.manifest.id); await settle();
    const tab = app.setting.activeTab, definitions = tab.getSettingDefinitions();
    assert(definitions.some(g=>g.heading==='Toolbar') && definitions.flatMap(g=>g.items).some(i=>i.aliases?.includes('Scratchpad note path')), 'Settings expose searchable definitions');
    assert(tab.containerEl.querySelectorAll('input').length===10, 'Native settings render startup, toolbar, and scratchpad inputs');
    const toggle = tab.containerEl.querySelector('input[type=checkbox]');
    toggle.click(); await p.whenSaved();
    assert(p.settings.openOnStartup!==before.openOnStartup, 'Declarative preference changes persist through the existing save queue');
    return {passed:checks.length,checks,editorGeometry:positions};
  } catch (error) { return {passed:checks.length,checks,error:String(error),stack:error.stack}; }
  finally {
    app.setting.close(); temporaryLeaf?.detach(); p.sizePicker.close(); p.settings=before; p.changed(); await p.whenSaved(); await p.openDesk();
  }
})()
