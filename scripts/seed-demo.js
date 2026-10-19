(async () => {
  const marker = JSON.parse(await app.vault.adapter.read('.demo/marker.json'));
  if (marker.id !== 'top-of-the-desk-release-demo') throw new Error('This is not the release demo vault. Nothing was changed.');
  const fixture = JSON.parse(await app.vault.adapter.read('.demo/history.json'));
  const now = new Date(), pad = n => String(n).padStart(2,'0');
  const day = date => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  const time = entry => Math.min(Date.now()-1000, new Date(now.getFullYear(),now.getMonth(),now.getDate()-entry.daysAgo,entry.hour).getTime());
  const recents = fixture.recents.map(({kind,path,...relative}) => ({kind,path,openedAt:time(relative)}));
  app.saveLocalStorage('top-of-the-desk:recents',recents);
  app.saveLocalStorage('top-of-the-desk:last-worked',fixture.lastWorked);
  const days = {}, pattern = [0,240,110,480,0,680,350,120,0,420,280,750,160,0];
  for(let ago=89;ago>=0;ago--) {
    const date = new Date(now.getFullYear(),now.getMonth(),now.getDate()-ago,12);
    days[day(date)] = ago===0 ? 428 : pattern[ago % pattern.length];
  }
  app.saveLocalStorage('top-of-the-desk:writing-activity',{version:1,startedOn:day(new Date(now.getFullYear(),now.getMonth(),now.getDate()-89,12)),days});
  return 'Synthetic demo history saved. Reload Top of the Desk, then apply demo web history.';
})()
