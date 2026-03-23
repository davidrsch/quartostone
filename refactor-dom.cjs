const fs = require('fs');
const html = fs.readFileSync('src/client/index.html', 'utf8');

// The new unified actions toolbar will replace #editor-toolbar and the #tabset-panel wrapper.
// We extract the buttons from #tabset-panel's right flex div.

const branchPickerMatch = html.match(/<div id="branch-picker"[\s\S]*?<\/div>\s*<\/div>/);
const editModePickerMatch = html.match(/<div id="edit-mode-picker"[\s\S]*?<\/div>\s*<\/div>/);
const exportPickerMatch = html.match(/<div id="export-picker"[\s\S]*?<\/div>\s*<\/div>/);
const saveBtnMatch = html.match(/<button id="btn-save"[\s\S]*?<\/button>/);
const kbdBtnMatch = html.match(/<button id="btn-kbd"[\s\S]*?<\/button>/);

if (!branchPickerMatch || !editModePickerMatch || !exportPickerMatch || !saveBtnMatch || !kbdBtnMatch) {
  console.error("DOM EXTRACTION FAILED!");
  process.exit(1);
}

const splitBtnHTML = `
            <button id="btn-split" class="edit-mode-btn" title="Split editor (Ctrl+\\)" aria-label="Toggle split editor" aria-pressed="false">
              <!-- Square split vertically icon -->
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" d="M2.5 2h11A1.5 1.5 0 0 1 15 3.5v9A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9A1.5 1.5 0 0 1 2.5 2ZM2 3.5v9a.5.5 0 0 0 .5.5h5V3H2.5A.5.5 0 0 0 2 3.5ZM8.5 13h5a.5.5 0 0 0 .5-.5v-9A.5.5 0 0 0 13.5 3h-5v10Z" clip-rule="evenodd"></path>
              </svg>
            </button>
`.trim();

const newToolbar = `
        <!-- Unified Editor Toolbar -->
        <div id="editor-toolbar" style="display:flex; justify-content:flex-end; align-items:center; padding: 4px 8px; border-bottom: 1px solid var(--border); background: var(--bg-toolbar); gap: 4px;">
            <div style="flex:1;"></div>
            ${branchPickerMatch[0]}
            ${editModePickerMatch[0]}
            ${exportPickerMatch[0]}
            ${saveBtnMatch[0]}
            ${kbdBtnMatch[0]}
            ${splitBtnHTML}
        </div>
`;

// Remove #editor-toolbar
let newHtml = html.replace(/<div id="editor-toolbar">[\s\S]*?<\/div>\s*<\/div>/, newToolbar);

// Remove #tabset-panel entirely
newHtml = newHtml.replace(/<!-- Tab bar \(#112\) -->[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, '');

// Update editor-body
const oldEditorBody = `<div id="editor-body">
          <div id="editor-split">
            <div id="editor-pane-primary" class="editor-pane focused-pane">
              <div id="editor-mount"></div>
            </div>
            <div id="editor-pane-divider" class="hidden" aria-hidden="true" title="Drag to resize panes"></div>
            <div id="editor-pane-secondary" class="editor-pane">
              <div id="tab-bar-2"></div>
              <div id="editor-mount-2"></div>
            </div>

          </div>
        </div>`;

const newEditorBody = `<div id="editor-body">
          <div id="editor-split">
            <div id="editor-pane-primary" class="editor-pane focused-pane">
              <div class="pane-header">
                <div id="tab-bar" class="tab-bar"></div>
              </div>
              <div id="editor-mount"></div>
            </div>
            <div id="editor-pane-divider" class="hidden" aria-hidden="true" title="Drag to resize panes"></div>
            <div id="editor-pane-secondary" class="editor-pane">
              <div class="pane-header">
                <div id="tab-bar-2" class="tab-bar"></div>
              </div>
              <div id="editor-mount-2"></div>
            </div>
          </div>
        </div>`;

newHtml = newHtml.replace(oldEditorBody, newEditorBody);

fs.writeFileSync('src/client/index.html', newHtml, 'utf8');
console.log("DOM restructured successfully!");
