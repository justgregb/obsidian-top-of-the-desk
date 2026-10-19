import { Component } from 'obsidian';

/** Native Bases own their rows. Observe only changed rows in this one embed. */
export function trackBaseListMarkers(host: HTMLElement, component: Component): void {
  const mark = (row: Element) => {
    row.toggleClass('tod-bulleted', !!row.querySelector(':scope > .bases-list-item-properties > .bases-list-property:first-child > .list-bullet'));
    row.toggleClass('tod-numbered', !!row.querySelector(':scope > .bases-list-item-properties > .bases-list-property:first-child > .list-number'));
  };
  const observer = new MutationObserver(records => {
    const rows = new Set<Element>();
    const collect = (node: Node) => {
      const element = node.instanceOf(Element) ? node : node.parentElement;
      if (!element) return;
      const row = element.closest('.bases-list-item');
      if (row && host.contains(row)) rows.add(row);
      for (const child of element.querySelectorAll('.bases-list-item')) rows.add(child);
    };
    for (const record of records) {
      // The target captures removed markers; added nodes capture newly mounted rows.
      const row = record.target.parentElement?.closest('.bases-list-item');
      if (row) rows.add(row);
      if (record.target.instanceOf(Element) && record.target.matches('.bases-list-item')) rows.add(record.target);
      for (const node of record.addedNodes) collect(node);
    }
    for (const row of rows) if (host.contains(row)) mark(row);
  });
  observer.observe(host, { childList: true, subtree: true });
  component.register(() => observer.disconnect());
}
