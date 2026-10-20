(async () => {
  const marker = JSON.parse(await app.vault.adapter.read('.demo/marker.json'));
  if (marker.id !== 'top-of-the-desk-release-demo' || app.vault.getName() !== 'Top of the Desk Release QA') throw new Error('Use the isolated QA vault.');
  const p = app.plugins.plugins['top-of-the-desk'], before = structuredClone(p.settings), checks = [], performanceChecks = {};
  const assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const closeDialogs = () => { for (const dialog of [...p.widgetDialogs]) dialog.close(); };
  const modal = () => [...p.widgetDialogs].at(-1);
  const action = label => [...modal().contentEl.querySelectorAll('button')].find(button => button.textContent === label);
  const toolbar = (view, id) => [...view.widgets.get(id).arrangement.el.querySelectorAll('button')].filter(button => !button.hidden).map(button => button.getAttribute('aria-label'));
  const keys = ['move','resize','addNotes','heading','baseToolbar','unstack','remove'];
  const defaultOrder = ['move','resize','edit','addNotes','heading','baseToolbar','unstack','remove'];
  let originalSave, originalRefresh;
  try {
    app.setting.close(); closeDialogs(); await p.openDesk(); await settle();
    const view = app.workspace.getLeavesOfType('top-of-the-desk-home')[0].view;
    p.selectStackWidget('writing','scratchpad'); await settle();
    const editor = view.scratchEditor.input, audio = view.widgets.get('audio').body.querySelector('audio'), base = view.widgets.get('reading').body.querySelector('.tod-base-host');
    p.setToolbarOrder(defaultOrder); p.setToolbarActions(keys); await p.whenSaved(); await settle();
    {
      const counts = { sources:0, switchers:0, quickActions:0, choices:0, layout:0, saves:0, refreshes:0 };
      const restore = [], observer = new MutationObserver(() => {});
      const watch = (object, key, counter) => {
        const original = object[key];
        object[key] = function(...args) { counts[counter]++; return original.apply(this,args); };
        restore.push(() => { object[key] = original; });
      };
      try {
        watch(p,'saveData','saves'); watch(p,'refreshViews','refreshes'); watch(p,'choiceSignature','choices');
        for (const leaf of app.workspace.getLeavesOfType('top-of-the-desk-home')) {
          const desk = leaf.view;
          if (!desk.widgets) continue; // Obsidian may retain deferred desk tabs.
          watch(desk,'refreshQuickActions','quickActions'); watch(desk.widgetGrid,'render','layout');
          for (const widget of desk.widgets.values()) {
            if (widget.source) watch(widget.source,'render','sources');
            if (widget.switcher) watch(widget.switcher,'render','switchers');
            observer.observe(widget.arrangement.el,{attributes:true,childList:true,subtree:true});
          }
        }
        p.batchEdit(() => { p.setToolbarActions([...keys,'edit']); p.setToolbarOrder([...defaultOrder].reverse()); });
        await p.whenSaved();
        performanceChecks.toolbarBatch = {...counts};
        assert(counts.sources===0 && counts.switchers===0 && counts.quickActions===0 && counts.choices===0 && counts.layout===0,
          'Toolbar preferences do not refresh sources, switchers, quick actions, search choices, or layout');
        assert(counts.saves===1 && counts.refreshes===1,'A toolbar preference batch saves and refreshes once');
        observer.takeRecords();
        for (let i=0;i<5;i++) view.update({widgets:p.settings.widgetOrder,content:false});
        performanceChecks.unchangedToolbarMutations = observer.takeRecords().length;
        assert(performanceChecks.unchangedToolbarMutations===0,'Unchanged background updates do not mutate toolbar controls');
      } finally {
        observer.disconnect(); restore.reverse().forEach(fn=>fn());
        p.setToolbarOrder(defaultOrder); p.setToolbarActions(keys); await p.whenSaved();
      }
      const heading = p.settings.widgets.reading.showHeading;
      p.batchEdit(() => { p.setToolbarActions([...keys,'edit']); p.setWidgetHeading('reading',false); });
      assert(view.widgets.get('reading').heading.hidden && view.widgets.get('reading').arrangement.controls.actions.heading.getAttribute('aria-pressed')==='true',
        'A batch combining toolbar and content preferences still updates the item');
      p.batchEdit(() => { p.setWidgetHeading('reading',heading!==false); p.setToolbarActions(keys); });
      assert(view.widgets.get('reading').heading.hidden===(heading===false),'Mixed batches work in either update order');
      await p.whenSaved(); await settle();
    }
    assert(toolbar(view,'item-morning').join('|') === 'Move|Resize|Hide heading|Remove from desk','Notes omit redundant Edit when all actions are visible');
    p.setToolbarActions([...keys,'edit']); await p.whenSaved(); await settle();
    assert(toolbar(view,'item-morning').join('|')==='Move|Resize|Edit|Hide heading|Remove from desk','Selected Edit appears alongside the other note shortcuts');
    assert((await p.loadData()).toolbarActions.includes('edit'),'The explicit Edit preference is saved');
    p.setToolbarActions(keys); await settle();
    assert(!toolbar(view,'item-morning').includes('Edit'),'Deselecting Edit hides it');
    for(const id of ['writing','recents','activity']) assert(!toolbar(view,id).includes('Edit'),`${id} omits redundant Edit`);
    for(const id of ['reading','item-field-notes','item-observations','coast']) assert(!toolbar(view,id).includes('Edit'),`${id} respects the disabled Edit toggle`);
    for (const id of ['guide','audio','ideas','website']) assert(toolbar(view,id).join('|') === 'Move|Remove from desk',`${id} excludes resize and heading controls`);
    assert(toolbar(view,'reading').includes('Hide Base toolbar'),'Base toolbar visibility is available for Bases');
    assert(toolbar(view,'item-observations').includes('Add notes') && toolbar(view,'item-observations').includes('Unstack'),'Note stacks expose Add notes and Unstack');
    p.setToolbarActions(['resize','heading','remove']); await settle();
    assert(toolbar(view,'item-morning').join('|')==='Resize|Hide heading|Remove from desk','A hidden Move shortcut does not leave Edit on regular notes');
    for(const id of ['recents','activity']) assert(!toolbar(view,id).includes('Edit'),`${id} also omits Edit when only Move is hidden`);
    assert(!toolbar(view,'reading').includes('Edit') && !toolbar(view,'writing').includes('Edit'),'Additional fields and hidden Unstack do not override the Edit toggle');
    p.setToolbarActions([...keys,'edit']); await settle();
    const noteControls=view.widgets.get('item-morning').arrangement.controls;
    assert(toolbar(view,'item-morning').includes('Edit'),'Selecting Edit makes it available');
    view.widgets.get('item-morning').el.focus(); noteControls.editButton.focus();
    p.setToolbarActions(keys); await settle();
    assert(noteControls.editButton.hidden && document.activeElement===noteControls.gripButton,'Hiding redundant Edit transfers focus to a visible control');
    noteControls.actions.heading.focus();
    p.setToolbarActions(keys.filter(key=>key!=='heading')); await settle();
    assert(noteControls.editButton.hidden && document.activeElement===noteControls.gripButton,'Hiding a focused shortcut transfers focus to a visible control');
    p.setToolbarActions([...keys,'edit']); await settle();
    const reversed = [...defaultOrder].reverse();
    p.setToolbarOrder(reversed); await p.whenSaved(); await settle();
    assert(toolbar(view,'reading').join('|')==='Remove from desk|Hide Base toolbar|Hide heading|Edit|Resize|Move','Saved ordering applies to the floating toolbar, including Edit');
    assert(toolbar(view,'guide').join('|')==='Remove from desk|Edit|Move','Inapplicable actions do not disturb the chosen order');
    assert(JSON.stringify((await p.loadData()).toolbarOrder)===JSON.stringify(reversed),'Custom order persists independently of visibility');
    assert(view.scratchEditor.input===editor && view.widgets.get('audio').body.querySelector('audio')===audio && view.widgets.get('reading').body.querySelector('.tod-base-host')===base,'Reordering preserves editors, playback, and Base previews');
    p.configureWidget('reading'); await settle();
    assert([...modal().contentEl.querySelectorAll('.tod-edit-actions button')].map(button=>button.textContent).join('|')==='Remove from desk|Hide Base toolbar|Hide heading|Resize|Move','Edit keeps visibility controls in the same chosen order as the toolbar');
    closeDialogs();
    p.setToolbarOrder(defaultOrder); await settle();
    p.setBaseControls('reading',true);
    const baseToggle = view.widgets.get('reading').arrangement.controls.actions.baseToolbar;
    baseToggle.click(); await settle();
    assert(p.settings.widgets.reading.showBaseControls === false && baseToggle.getAttribute('aria-pressed') === 'true','Base toolbar shortcut applies and reflects hidden state');
    baseToggle.click(); await settle();
    view.widgets.get('item-morning').el.focus();
    noteControls.editButton.focus();
    view.widgets.get('item-morning').toolsToggle.click();
    p.setToolbarActions([]); await p.whenSaved(); await settle();
    assert([...view.widgets].every(([id,w]) => !p.settings.widgets[id]?.enabled || toolbar(view,id).length === 0),'Deselecting everything hides every control on every item');
    assert([...view.widgets.values()].every(w=>w.arrangement.el.hidden && w.arrangement.el.getClientRects().length===0 && w.toolsToggle.hidden),'Empty toolbars and their touch toggles leave no visible capsule');
    assert([...view.contentEl.querySelectorAll('.tod-widget-controls button[hidden]')].every(button=>button.getClientRects().length===0),'Hidden toolbar shortcuts are absent from the rendered layout');
    assert(JSON.stringify((await p.loadData()).toolbarActions) === '[]','The hidden toolbar is saved as an explicit empty selection');
    assert(view.scratchEditor.input === editor && view.widgets.get('audio').body.querySelector('audio') === audio && view.widgets.get('reading').body.querySelector('.tod-base-host') === base,'Toolbar preferences retain editors, audio, and Base previews');
    const note=view.widgets.get('item-morning');
    assert(document.activeElement===note.el && !note.el.hasClass('is-controls-open'),'Turning off the last control restores focus to the item and closes its toolbar');
    const noteHeading=note.el.querySelector('.tod-card-heading') || note.heading;
    noteHeading.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:160}));
    await settle();
    const menuEdit=[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='Edit');
    assert(!!view.itemMenu && !!menuEdit,'Right-clicking the heading keeps Edit reachable with the toolbar hidden');
    menuEdit.click(); await settle();
    assert(p.widgetDialogs.size===1 && !view.itemMenu,'The context menu opens Edit');
    action('Cancel').click(); await settle();
    assert(document.activeElement===note.el,'Closing Edit restores focus when no toolbar control exists');
    note.el.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));
    assert(!!view.itemMenu,'Shift+F10 opens the same context menu');
    view.itemMenu.hide();
    for(const target of [view.scratchEditor.input.el.querySelector('.cm-content'),audio,base]) {
      assert(!!target,'The embedded interaction target exists');
      target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      assert(!view.itemMenu,'Embedded editor, audio, and Base context menus are preserved');
    }

    p.configureWidget('item-morning'); await settle();
    const originalRow = view.widgetGrid.layout.get('item-morning').row;
    action('Move').click(); await settle();
    const anchor = view.widgets.get('item-morning').el;
    assert(!modal() && view.widgets.get('item-morning').el.hasClass('is-placing') && document.activeElement === anchor,'Move from Edit enters placement with keyboard focus');
    for (let i=0; i<2; i++) anchor.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    assert(view.widgetGrid.layout.get('item-morning').row === originalRow+2,'Repeated keyboard movement works with all toolbar controls hidden');
    anchor.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert(!view.widgets.get('item-morning').el.hasClass('is-placing'),'Escape exits placement without reopening Edit');

    p.configureWidget('reading'); await settle();
    let form = modal(), name = form.contentEl.querySelector('input[maxlength="100"]');
    const initialHeading=p.settings.widgets.reading.showHeading, initialBaseControls=p.settings.widgets.reading.showBaseControls;
    const headingButton=action('Hide heading'), baseButton=action('Hide Base toolbar');
    const initialPressed=headingButton.getAttribute('aria-pressed');
    headingButton.focus(); headingButton.click();
    assert(headingButton.getAttribute('aria-pressed')!==initialPressed && document.activeElement===headingButton && !action('Save').disabled,'Heading button reflects a pending change and keeps focus');
    assert(p.settings.widgets.reading.showHeading===initialHeading && action('Move').getAttribute('aria-disabled')==='true','Heading remains a draft and protects it from navigation');
    headingButton.click();
    assert(headingButton.getAttribute('aria-pressed')===initialPressed && action('Save').disabled && action('Move').getAttribute('aria-disabled')==='false','Toggling back clears the draft and restores actions');
    headingButton.click(); baseButton.click();
    const footer=form.contentEl.querySelector('.tod-dialog-actions');
    assert(footer===footer.parentElement.lastElementChild,'Save and Cancel are the final row in Edit');
    assert(form.modalEl.getBoundingClientRect().height < 430,'Base Edit uses a compact layout');
    const modalHeight=form.modalEl.getBoundingClientRect().height;
    name.value='Reading test'; name.dispatchEvent(new Event('input',{bubbles:true}));
    assert(action('Move').getAttribute('aria-disabled')==='true' && action('Remove from desk').getAttribute('aria-disabled')==='true','Unsaved source edits cannot be silently discarded by navigation actions');
    action('Remove from desk').click();
    assert(modal()===form && p.settings.widgets.reading.enabled,'Disabled actions preserve the Edit draft');
    assert(form.modalEl.getBoundingClientRect().height===modalHeight,'Typing does not shift the dialog height');
    const oldSize = [p.settings.widgets.reading.columns,p.settings.widgets.reading.rows];
    action('Resize').click(); await settle();
    let picker = form.contentEl.querySelector('.tod-size-picker');
    assert(!!picker && picker.contains(document.activeElement),'Resize stays inside the Edit focus boundary');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert(modal() === form && !form.contentEl.querySelector('.tod-size-picker'),'Escape closes Resize while retaining Edit and its draft');
    action('Resize').click(); await settle();
    picker = form.contentEl.querySelector('.tod-size-picker');
    picker.querySelector('button[aria-label="1 column · half height"]').click();
    assert(JSON.stringify([p.settings.widgets.reading.columns,p.settings.widgets.reading.rows]) === JSON.stringify(oldSize),'Resize in Edit remains a draft until Save');
    action('Cancel').click(); await settle();
    assert(p.settings.widgets.reading.title !== 'Reading test' && JSON.stringify([p.settings.widgets.reading.columns,p.settings.widgets.reading.rows]) === JSON.stringify(oldSize),'Cancel discards both appearance and resize drafts');
    assert(p.settings.widgets.reading.showHeading===initialHeading && p.settings.widgets.reading.showBaseControls===initialBaseControls,'Cancel preserves heading and Base toolbar visibility');

    p.configureWidget('reading'); await settle();
    form=modal(); name=form.contentEl.querySelector('input[maxlength="100"]');
    name.value='Reading test'; name.dispatchEvent(new Event('input',{bubbles:true}));
    action('Hide heading').click(); action('Hide Base toolbar').click();
    action('Resize').click(); await settle();
    form.contentEl.querySelector('button[aria-label="1 column · half height"]').click();
    await p.whenSaved();
    let saves=0, refreshes=0;
    originalSave=p.saveData; originalRefresh=p.refreshViews;
    p.saveData=async function(...args){saves++;return originalSave.apply(this,args);};
    p.refreshViews=function(...args){refreshes++;return originalRefresh.apply(this,args);};
    action('Save').click(); await p.whenSaved(); await settle();
    p.saveData=originalSave; p.refreshViews=originalRefresh; originalSave=originalRefresh=null;
    assert(saves===1 && refreshes===1,'One Edit save commits source, resize, and visibility with one save and refresh');
    assert(p.settings.widgets.reading.title==='Reading test' && p.settings.widgets.reading.columns===1 && p.settings.widgets.reading.rows===2,'Edit applies the selected name and size');
    assert(p.settings.widgets.reading.showHeading===(initialHeading===false) && p.settings.widgets.reading.showBaseControls===(initialBaseControls===false),'Save applies both visibility buttons');
    p.configureWidget('reading'); await settle();
    assert(action('Hide heading').getAttribute('aria-pressed')===String(p.settings.widgets.reading.showHeading===false) && action('Hide Base toolbar').getAttribute('aria-pressed')===String(p.settings.widgets.reading.showBaseControls===false),'Reopening Edit restores the saved button states');
    closeDialogs(); p.setWidgetHeading('reading',true);

    p.configureWidget('item-observations'); await settle();
    form=modal(); name=form.contentEl.querySelector('input[maxlength="80"]');
    name.value='Stack draft'; name.dispatchEvent(new Event('input',{bubbles:true}));
    action('Add notes').click(); await settle();
    assert(p.widgetDialogs.size===2 && form.contentEl.contains(name),'Add notes retains the underlying Edit draft');
    modal().close(); await settle();
    assert(modal()===form && name.value==='Stack draft','Returning from Add notes preserves unsaved text');
    closeDialogs();

    const switching=p.stackWidgets(['activity','coast']);
    p.setToolbarActions([...keys,'edit']); p.selectStackWidget(switching,'activity'); await settle();
    assert(toolbar(view,switching).includes('Edit'),'Selected Edit appears on a writing activity stack member');
    p.selectStackWidget(switching,'coast'); await settle();
    assert(toolbar(view,switching).includes('Edit'),'Switching to an image reveals its extra settings');
    view.widgets.get(switching).el.focus(); view.widgets.get(switching).arrangement.controls.editButton.focus();
    p.setToolbarActions(keys); p.selectStackWidget(switching,'activity'); await settle();
    assert(!toolbar(view,switching).includes('Edit') && document.activeElement===view.widgets.get(switching).arrangement.controls.gripButton,'Deselecting Edit while switching members preserves keyboard focus');
    p.takeWidgetOut(switching); await settle();

    const group=p.stackWidgets(['reading','guide']);
    p.selectStackWidget(group,'guide'); p.setToolbarActions(keys); await settle();
    assert(toolbar(view,group).includes('Hide heading') && !toolbar(view,group).includes('Hide Base toolbar'),'Mixed stack keeps stack-wide headings while a PDF is active');
    p.configureWidget(group); await settle();
    assert(!!action('Hide headings') && !action('Hide Base toolbar'),'Edit and toolbar agree on mixed-stack heading availability');
    closeDialogs(); p.selectStackWidget(group,'reading'); await settle();
    view.widgets.get('reading').heading.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:160}));
    await settle();
    [...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='Edit').click(); await settle();
    assert(!!action('Hide headings') && !!action('Hide Base toolbar'),'A member heading opens Edit for the whole stack and active Base');
    closeDialogs();
    assert(toolbar(view,group).includes('Hide Base toolbar'),'Switching the active member updates source-specific toolbar controls');
    view.widgets.get(group).arrangement.controls.actions.unstack.click(); await settle();
    assert(!p.settings.widgets[group] && p.settings.widgets.reading.enabled && p.settings.widgets.guide.enabled,'Toolbar Unstack releases the whole mixed stack');
    document.querySelector('.tod-undo-popup button').click(); await settle();
    assert(!!p.settings.widgets[group],'Undo restores the stack after the toolbar action');
    p.configureWidget('website'); await settle();
    action('Remove from desk').click(); await settle();
    assert(!p.settings.widgets.website.enabled && p.widgetDialogs.size===0,'Remove from Edit closes the dialog and removes only the desk reference');
    document.querySelector('.tod-undo-popup button').click(); await settle();
    assert(p.settings.widgets.website.enabled,'Undo restores an item removed from Edit');

    p.openSettings(p.manifest.id); await settle();
    const tab=app.setting.activeTab, findButton=label=>[...tab.containerEl.querySelectorAll('button')].find(b=>b.textContent===label);
    assert(!findButton('Edit only'),'There is no separate Edit-only preset');
    for(const button of tab.containerEl.querySelectorAll('.tod-toolbar-choice[aria-pressed="true"]'))button.click();
    await p.whenSaved(); await settle();
    assert(p.settings.toolbarActions.length===0,'Every shortcut can be deselected in the same strip');
    const choice=id=>tab.containerEl.querySelector(`[data-toolbar-control="${id}"]`);
    const resizeSetting=choice('resize');
    assert(tab.containerEl.querySelectorAll('.tod-toolbar-choice').length===8 && !tab.containerEl.querySelector('.tod-toolbar-options'),'One interactive strip replaces the separate list');
    assert(resizeSetting.getAttribute('aria-pressed')==='false','Hidden controls stay available as unpressed buttons');
    const settingsObserver=new MutationObserver(()=>{});
    settingsObserver.observe(resizeSetting.parentElement,{attributes:true,childList:true,subtree:true});
    resizeSetting.click();
    const settingsMutations=settingsObserver.takeRecords(); settingsObserver.disconnect();
    assert(settingsMutations.length>0 && settingsMutations.every(record=>record.target===resizeSetting),
      'Toggling an icon changes only that icon in the settings strip');
    await p.whenSaved();
    assert(p.settings.toolbarActions.join(',')==='resize' && resizeSetting.getAttribute('aria-pressed')==='true','Clicking the preview enables a toolbar control');
    resizeSetting.click(); await p.whenSaved();
    assert(p.settings.toolbarActions.length===0 && resizeSetting.getAttribute('aria-pressed')==='false','Clicking again hides the control');
    resizeSetting.click(); await p.whenSaved();
    const editButton=choice('edit'), win=editButton.ownerDocument.defaultView, settingsDoc=editButton.ownerDocument;
    editButton.click();
    await p.whenSaved(); await settle();
    assert(p.settings.toolbarActions.join(',')==='resize,edit' && editButton.getAttribute('aria-pressed')==='true','Edit can be selected alongside Resize');
    assert(editButton.dataset.todTooltip.includes('Click to hide'),'Edit uses the same tooltip behavior as the other toggles');
    resizeSetting.click(); await p.whenSaved(); await settle();
    assert(p.settings.toolbarActions.join(',')==='edit' && toolbar(view,'item-morning').join('|')==='Edit','Selecting only Edit keeps all actions under Edit');
    editButton.click(); resizeSetting.click(); await p.whenSaved(); await settle();
    assert(p.settings.toolbarActions.join(',')==='resize' && editButton.getAttribute('aria-pressed')==='false','Edit can be hidden without changing the other shortcuts');
    assert(editButton.dataset.todTooltip.includes('Click to show') && !toolbar(view,'item-morning').includes('Edit'),'Unselected Edit stays hidden');
    const addButton=choice('addNotes');
    addButton.focus();
    assert(addButton.getAttribute('aria-description').includes('Note stacks only') && choice('unstack').getAttribute('aria-description').includes('Stacks only'),'Scope hints remain available to assistive technology');
    // The separate settings window is unfocused during CLI runs. Exercise the
    // keyboard-focus branch without depending on Chromium's input-modality state.
    const originalMatches=addButton.matches;
    addButton.matches=function(selector){return selector===':focus-visible'||originalMatches.call(this,selector);};
    try {addButton.dispatchEvent(new win.FocusEvent('focusin',{bubbles:true}));}
    finally {delete addButton.matches;}
    assert(settingsDoc.querySelector('.tod-tooltip:not([hidden])')?.textContent.includes('Note stacks only'),'Focusing an icon shows its name and scope in a tooltip');
    editButton.focus(); editButton.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
    await p.whenSaved(); await settle();
    assert(p.settings.toolbarOrder.slice(0,3).join(',')==='move,edit,resize','Icons support left and right keyboard reordering');
    assert(settingsDoc.activeElement===editButton,'Keyboard reordering retains focus');
    editButton.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
    editButton.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
    assert(p.settings.toolbarOrder[0]==='edit' && settingsDoc.activeElement===editButton,'Repeated keyboard movement stops at the first position');
    editButton.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    assert(p.settings.toolbarOrder[1]==='edit','The same icon moves right with the keyboard');
    editButton.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
    const pointerDrag=(source,destination,cancel=false)=>{
      const original=Object.getOwnPropertyDescriptor(source,'setPointerCapture');
      Object.defineProperty(source,'setPointerCapture',{configurable:true,value:()=>{}});
      try {
        const from=source.getBoundingClientRect(),to=destination.getBoundingClientRect();
        const emit=(target,type,x,y)=>target.dispatchEvent(new win.PointerEvent(type,{pointerId:71,isPrimary:true,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
        emit(source,'pointerdown',from.left+from.width/2,from.top+from.height/2);
        emit(settingsDoc,'pointermove',to.left+2,to.top+to.height/2);
        if(cancel)settingsDoc.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        else emit(settingsDoc,'pointerup',to.left+2,to.top+to.height/2);
        source.dispatchEvent(new win.MouseEvent('click',{detail:1,bubbles:true,cancelable:true}));
      } finally {if(original)Object.defineProperty(source,'setPointerCapture',original);else delete source.setPointerCapture;}
    };
    const removeButton=choice('remove'), actionsBefore=JSON.stringify(p.settings.toolbarActions);
    pointerDrag(removeButton,editButton);
    assert(p.settings.toolbarOrder[0]==='remove','Dragging an icon reorders the toolbar');
    assert(JSON.stringify(p.settings.toolbarActions)===actionsBefore,'Dragging does not toggle the dragged icon');
    assert(settingsDoc.activeElement===removeButton && !settingsDoc.querySelector('.tod-drag-preview'),'Drop restores focus and removes the drag preview');
    const savedOrder=JSON.stringify(p.settings.toolbarOrder);
    pointerDrag(resizeSetting,removeButton,true);
    assert(JSON.stringify(p.settings.toolbarOrder)===savedOrder && JSON.stringify(p.settings.toolbarActions)===actionsBefore,'Escape cancels reordering without changing order or visibility');
    const strip=tab.containerEl.querySelector('.tod-toolbar-preview');
    assert([...strip.children].map(el=>el.dataset.toolbarControl).join(',')===p.settings.toolbarOrder.join(','),'The interactive preview follows the saved order');
    assert([...strip.querySelectorAll('[aria-pressed="true"]')].map(el=>el.getAttribute('aria-label')).join(',')==='Resize','The preview highlights only enabled shortcuts');
    findButton('Reset').click(); await p.whenSaved();
    assert(p.settings.toolbarActions.join(',')==='resize,edit,addNotes' && p.settings.toolbarOrder.join(',')===defaultOrder.join(','),'Reset restores default shortcuts and order');
    app.setting.close(); await settle();
    const children=p._children.length;
    for(let i=0;i<3;i++){p.openSettings(p.manifest.id);await settle();app.setting.close();await settle();}
    assert(p._children.length===children,'Repeated settings visits release their tooltip and drag components');
    return {passed:checks.length,checks,performance:performanceChecks};
  } catch(error) { return {passed:checks.length,checks,performance:performanceChecks,error:String(error),stack:error.stack}; }
  finally {
    if(originalSave)p.saveData=originalSave;
    if(originalRefresh)p.refreshViews=originalRefresh;
    app.setting.close(); closeDialogs(); p.sizePicker.close(); p.settings=before; p.clearUndo(); p.changed(); await p.whenSaved(); await p.openDesk();
  }
})()
