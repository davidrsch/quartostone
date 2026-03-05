// src/client/state/editorState.ts
// Shared mutable state for the quartostone editor.
// Only state that is consumed by multiple sub-modules lives here.

export let activePath: string | null = null;
export let isDirty = false;
export type EditorMode = 'source' | 'visual';
export let editorMode: EditorMode = 'source';

export function setActivePath(p: string | null): void { activePath = p; }
export function setIsDirty(d: boolean): void { isDirty = d; }
export function setEditorMode(m: EditorMode): void { editorMode = m; }
