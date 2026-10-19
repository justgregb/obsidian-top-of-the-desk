(async () => {
  const marker = JSON.parse(await app.vault.adapter.read('.demo/marker.json'));
  if (marker.id !== 'top-of-the-desk-release-demo' || app.vault.getName() !== 'Top of the Desk Release QA') throw new Error('Run only in the isolated release QA vault.');
  const p = app.plugins.plugins['top-of-the-desk'];
  if (!p || !p.scratch.loaded || p.scratch.dirty) throw new Error('Plugin unavailable or scratchpad busy.');
  const checks = [], before = structuredClone(p.settings);
  const assert = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const wait = async (predicate, name) => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 40)); }
    throw new Error('Timed out: ' + name);
  };
  const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const undo = () => { const b = document.querySelector('.tod-undo-notice button'); if (!b) throw new Error('Undo button missing'); b.click(); };
  let folder = 'Release checks ' + Date.now(), dailyFile, dailyBefore;
  const started = performance.now();
  try {
    await app.vault.createFolder(folder);
    const a = await app.vault.create(folder + '/First.md', '---\ntitle: Keep metadata\n---\nFirst original text.');
    const b = await app.vault.create(folder + '/Second.md', 'Second original text.');
    const originals = new Map([[a, await app.vault.read(a)], [b, await app.vault.read(b)]]);
    const sources = [{kind:'note',path:a.path},{kind:'folder',path:folder}];
    for (const [kind,path] of [['base','Reading list.base'],['canvas','Ideas in progress.canvas'],['pdf','Media/Field guide.pdf'],['audio','Media/A moment of quiet.wav'],['image','Media/Coast study.svg']]) {
      const source = app.vault.getFileByPath(path); if (!source) throw new Error('Missing demo fixture: '+path);
      const copy = await app.vault.copy(source,folder+'/'+source.name); sources.push({kind,path:copy.path});
    }
    sources.push({kind:'web',path:'https://example.com/desk-release-check'});
    const ids = new Map();
    for (const source of sources) {
      const id = p.addSourceToDesk(source,false); assert(!!id,'Add '+source.kind);
      const snapshot = JSON.stringify(p.settings);
      assert(p.addSourceToDesk(source,false) === id && JSON.stringify(p.settings) === snapshot,'Duplicate '+source.kind+' reuses its item');
      ids.set(source.kind,id);
    }
    await p.openDesk(); await p.openDesk(); await settle();
    assert(app.workspace.getLeavesOfType('top-of-the-desk-home').length === 1,'Open desk reuses its tab');
    p.unpin(a.path); assert(!p.hasNote(a.path) && !!app.vault.getFileByPath(a.path),'Remove leaves original note intact');
    undo(); assert(p.hasNote(a.path),'Undo restores removed note');
    p.pin(b.path); assert(p.saveStackNotes([a.path,b.path],'Release check stack'),'Create note stack');
    const stack = p.settings.items.find(i => i.type==='stack' && i.paths.includes(a.path));
    p.moveStackNote(stack.id,b.path,0); assert(p.settings.items.find(i=>i.id===stack.id).paths[0]===b.path,'Reorder stack members');
    p.unstack(stack.id); assert(p.settings.items.some(i=>i.type==='note'&&i.path===a.path) && p.settings.items.some(i=>i.type==='note'&&i.path===b.path),'Unstack preserves both note references');
    for(const [file,text] of originals) assert(await app.vault.read(file)===text,'Desk operations preserve '+file.name+' contents');
    const image = ids.get('image');
    p.setWidgetSize(image,{columns:2,rows:8},4); assert(p.settings.widgets[image].columns===2 && p.settings.widgets[image].rows===8,'Resize image');
    p.moveWidgetTo(image,{column:2,row:30},4); assert(p.settings.widgets[image].positions[4].row===30,'Move image');
    for(const kind of ['pdf','canvas','audio','web']) { const id=ids.get(kind); p.setWidgetHeading(id,false); assert(p.settings.widgets[id].showHeading!==false,'Mandatory '+kind+' heading is retained'); }
    const widgets = p.stackWidgets([ids.get('pdf'),ids.get('canvas')]); assert(!!widgets,'Stack source items');
    p.selectStackWidget(widgets,ids.get('canvas')); assert(p.settings.widgets[widgets].activeMember===ids.get('canvas'),'Switch source stack member');
    p.takeWidgetOut(widgets); assert(!p.settings.widgets[widgets] && p.settings.widgets[ids.get('pdf')] && p.settings.widgets[ids.get('canvas')],'Unstack source items');
    await app.vault.rename(a,folder+'/Renamed.md'); assert(p.hasNote(a.path),'Renamed note remains on desk');
    p.recents.open(a.path); p.recordFolderOpen(folder); assert(p.recents.entries.some(e=>e.path===a.path) && p.recents.entries.some(e=>e.kind==='folder'&&e.path===folder),'File and folder opening times are recorded');
    const now=new Date(),oldest=new Date(now.getFullYear(),now.getMonth(),now.getDate()-6).getTime();
    assert(p.recents.group(oldest,now)?.key==='earlier' && p.recents.group(oldest-1,now)===null && p.recents.group(now.getTime()+1,now)===null,'History expires at seven local calendar days');
    await p.setScratchPath(folder+'/Scratch.md'); await wait(()=>p.scratch.loaded,'scratch load');
    assert(!app.vault.getFileByPath(p.settings.scratchPath),'Unused scratchpad does not create a file');
    p.scratch.edit('First draft\n\n[[A link]]'); await p.scratch.flush();
    let scratch=app.vault.getFileByPath(p.settings.scratchPath); assert(await app.vault.read(scratch)==='First draft\n\n[[A link]]','Scratchpad saves exact Markdown');
    p.scratch.edit('Pending local draft'); await app.vault.modify(scratch,'Newer external edit'); await p.scratch.flush();
    assert(p.scratch.conflict && await app.vault.read(scratch)==='Newer external edit','Scratchpad external edit is protected');
    await p.saveScratchCopy();
    const recovered=app.vault.getMarkdownFiles().find(f=>f.path.startsWith(folder+'/Scratch — recovered '));
    assert(recovered && await app.vault.read(recovered)==='Pending local draft' && p.scratch.text==='Newer external edit','Scratchpad conflict copy preserves both versions');
    p.scratch.edit('Draft before folder rename'); const next=folder+' moved';
    await app.vault.rename(app.vault.getAbstractFileByPath(folder),next); folder=next; await p.scratch.flush();
    scratch=app.vault.getFileByPath(folder+'/Scratch.md');
    assert(p.settings.scratchPath===scratch.path && p.hasNote(folder+'/Renamed.md') && await app.vault.read(scratch)==='Draft before folder rename','Folder rename preserves references and pending draft');
    await p.daily.sync(); dailyFile=await p.daily.ensure(); if(!dailyFile) throw new Error('Daily note creation unavailable: '+p.daily.error);
    dailyBefore=await app.vault.read(dailyFile); p.daily.store.edit(dailyBefore+'\nRelease daily draft'); await p.daily.flush();
    assert((await app.vault.read(dailyFile)).endsWith('Release daily draft'),'Daily note saves');
    p.daily.store.edit('Pending daily draft'); await app.vault.modify(dailyFile,'Newer daily external edit'); await p.daily.flush();
    assert(p.daily.store.conflict && await app.vault.read(dailyFile)==='Newer daily external edit','Daily note external edit is protected');
    await p.daily.saveCopy();
    const dailyCopy=app.vault.getMarkdownFiles().find(f=>f.path.startsWith(dailyFile.path.replace(/\.md$/,'')+' — recovered '));
    assert(dailyCopy && await app.vault.read(dailyCopy)==='Pending daily draft','Daily conflict recovery retains draft');
    if(dailyCopy) await app.vault.trash(dailyCopy,true);
    await app.vault.modify(dailyFile,dailyBefore); await p.daily.changed(dailyFile.path);
    await p.openDesk(); p.selectStackWidget('writing','scratchpad'); p.refreshViews(); await settle();
    const view=app.workspace.getLeavesOfType('top-of-the-desk-home')[0].view;
    await wait(()=>view.scratchEditor?.input?.native?.cm,'embedded editor');
    const cm=view.scratchEditor.input.native.cm;
    const day=new Date(); const dayKey=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    p.activity.flushAll(); const total=p.activity.total(dayKey);
    cm.dispatch({changes:{from:cm.state.doc.length,insert:' extra release words'},userEvent:'input.type'});
    await p.scratch.flush(); p.activity.flushAll();
    assert((await app.vault.read(scratch)).endsWith(' extra release words'),'Embedded editor writes through guarded scratch store');
    assert(p.activity.total(dayKey)-total===3,'Actual editor updates writing activity once');
    p.selectStackWidget('writing','daily'); await settle(); p.selectStackWidget('writing','scratchpad'); await settle();
    assert(view.scratchEditor.input.native.cm.state.doc.toString().endsWith(' extra release words'),'Switching writing tools retains saved editor text');
    const audioWidget=view.widgets.get(ids.get('audio')); audioWidget.el.scrollIntoView(); await settle();
    await wait(()=>audioWidget.el.querySelector('audio')?.readyState>=1,'audio metadata');
    const audio=audioWidget.el.querySelector('audio'), row=audioWidget.el.querySelector('.tod-audio-player');
    row.querySelector('button[aria-label="Mute audio"]').click(); await wait(()=>audio.muted,'audio mute');
    assert(audio.muted,'Mute control works');
    row.querySelector('button[aria-label="Play"]').click(); await wait(()=>!audio.paused && audio.currentTime>0,'audio playback'); assert(!audio.error,'Audio plays');
    const seek=row.querySelector('input[type=range]'); seek.value='5'; seek.dispatchEvent(new Event('input',{bubbles:true})); assert(audio.currentTime>=4.9,'Audio seek works');
    row.querySelector('button[aria-label="Pause"]').click(); assert(audio.paused,'Audio pause works');
    await p.whenSaved(); const disk=JSON.parse(await app.vault.adapter.read(app.vault.configDir+'/plugins/top-of-the-desk/data.json'));
    assert(JSON.stringify(disk)===JSON.stringify(p.settings),'All current settings persist to disk');
    return {passed:checks.length,checks,durationMs:Math.round(performance.now()-started),version:p.manifest.version};
  } catch(error) { return {passed:checks.length,checks,error:String(error),stack:error.stack}; }
  finally {
    if(dailyFile && dailyBefore!==undefined) await app.vault.modify(dailyFile,dailyBefore);
    await p.scratch.flush(); p.scratch.stop(); p.settings=before; p.setupScratch(); p.changed(); await p.whenSaved();
    p.clearUndo(); const f=app.vault.getAbstractFileByPath(folder); if(f) await app.vault.trash(f,true);
    await p.openDesk(); await app.vault.adapter.write('.demo/expected-reload.json',JSON.stringify(p.settings));
  }
})()
