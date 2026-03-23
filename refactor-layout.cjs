// VSCode-style DOM layout restructure script
// Before: tabset-panel has [tab-bar][buttons] in the same row → secondary pane is 30px lower
// After: global-actions-bar[buttons] on top, then editor-split with each pane having its own tab bar

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync('src/client/index.html', 'utf8');

// 1. Capture the entire #tabset-panel block (including all buttons) - strip the wrapper and tab-bar, keep buttons
const tabsetMatch = html.match(/<div id="tabset-panel"[^>]*>([\s\S]*?)<\/div>\s*\n\s*\n/);
if (!tabsetMatch) {
  console.error('Could not find tabset-panel');
  process.exit(1);
}

// Extract just the right-side buttons div (everything after the first #tab-bar div)
const tabsetContent = tabsetMatch[1];
const tabBarEndTag = '</div>'; // end of the #tab-bar div
const tabBarIdx = tabsetContent.indexOf('<div id="tab-bar"');
const afterTabBar = tabsetContent.indexOf(tabBarEndTag, tabBarIdx) + tabBarEndTag.length;
const buttonsContent = tabsetContent.slice(afterTabBar).trim();

// Remove the outer wrapper div (the second div that wrapped the buttons)
// It looks like: <div style="display:flex; align-items:center; padding-right: 8px; gap: 4px;">
const innerButtonsMatch = buttonsContent.match(/<div style="display:flex;[^"]*">([\s\S]*)<\/div>\s*$/);
const buttonsInner = innerButtonsMatch ? innerButtonsMatch[1].trim() : buttonsContent;

const newHTML = html.replace(
  // Match the whole tabset-panel and all its content 
  /<div id="tabset-panel"[\s\S]*?<\/div>\s*\n\s*\n/,
  `
        <!-- Global actions bar (no tab bar here — tab bars live inside each pane) -->
        <div id="global-actions-bar">
          ${buttonsInner}
        </div>

`
);

// 2. Now update the editor-pane-primary to have a tab bar header
const newHTML2 = newHTML.replace(
  /<div id="editor-pane-primary" class="editor-pane focused-pane">\s*<div id="editor-mount"><\/div>/,
  `<div id="editor-pane-primary" class="editor-pane focused-pane">
              <div class="pane-header"><div id="tab-bar" class="tab-bar"></div></div>
              <div id="editor-mount"></div>`
);

fs.writeFileSync('src/client/index.html', newHTML2, 'utf8');
console.log('Done! New layout:');
console.log('  - #global-actions-bar (just buttons at the top)');
console.log('  - #editor-split > #editor-pane-primary > .pane-header > #tab-bar (same level)');
console.log('  - #editor-split > #editor-pane-secondary > .pane-header > #tab-bar-2 (same level)');
