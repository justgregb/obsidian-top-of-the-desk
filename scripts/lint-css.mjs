import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const filename = new URL('../styles.css', import.meta.url);
const root = postcss.parse(await readFile(filename, 'utf8'), { from: filename.pathname });
const errors = [];
const report = (node, message) => errors.push(`styles.css:${node.source.start.line}: ${message}`);
root.walkDecls(declaration => {
  if (declaration.important) report(declaration, 'Use scoped selectors or CSS variables instead of !important.');
  if (['clip-path', 'column-gap'].includes(declaration.prop.toLowerCase())) {
    report(declaration, `Avoid ${declaration.prop}: it triggers Obsidian's compatibility checker. Use clip or grid gap.`);
  }
});
root.walkRules(rule => {
  selectorParser(selectors => selectors.walkPseudos(pseudo => {
    if (pseudo.value.toLowerCase() === ':has') report(rule, 'Use local state classes instead of relational :has selectors.');
  })).processSync(rule.selector);
});
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('CSS syntax and Obsidian review checks passed.');
