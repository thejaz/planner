import { App, MarkdownView, TFile, normalizePath } from 'obsidian';
import { Conflict, minimalDiff } from '../core/changes';
import type { FilePort } from './journal';

export class ObsidianPort implements FilePort {
  constructor(private app: App, readonly ownWrites: Set<string>) {}
  private editors(path: string): MarkdownView[] {
    return this.app.workspace.getLeavesOfType('markdown').map(l => l.view)
      .filter((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === path && v.getMode() === 'source');
  }
  async read(path: string): Promise<string | null> {
    const views = this.editors(path);
    if (views.length) {
      const current = views[0]!.editor.getValue();
      if (views.some(v => v.editor.getValue() !== current)) throw new Conflict('This note is open in two editors with different text. Close one of them, then try again.');
      return current;
    }
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.vault.read(file) : null;
  }
  async replace(path: string, expected: string | null, content: string): Promise<void> {
    const normalized = normalizePath(path);
    if (normalized !== path || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Use a vault-relative note path.');
    this.ownWrites.add(path);
    try {
      if (expected === null) {
        if (this.app.vault.getAbstractFileByPath(path)) throw new Conflict('This day already exists.');
        await this.app.vault.create(path, content); return;
      }
      const views = this.editors(path);
      if (views.length) {
        if (views.some(v => v.editor.getValue() !== expected)) throw new Conflict('The open note changed while saving, so nothing was written. Try again.');
        const view = views[0]!, editor = view.editor;
        const changes = minimalDiff(expected, content).map(p => ({ from: editor.offsetToPos(p.start), to: editor.offsetToPos(p.end), text: p.after }));
        editor.transaction({ changes }, 'thejaz-planner');
        await view.save();
        return;
      }
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Conflict('The note was removed or renamed.');
      await this.app.vault.process(file, current => {
        if (current !== expected) throw new Conflict('The note changed while saving, so nothing was written. Your text is kept; try again.');
        return content;
      });
    } finally { this.ownWrites.delete(path); }
  }
  async removeCreated(path: string, expected: string): Promise<void> {
    if (await this.read(path) !== expected) throw new Conflict('The new note was edited; undo will not remove it.');
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    this.ownWrites.add(path);
    try { await this.app.fileManager.trashFile(file); }
    finally { this.ownWrites.delete(path); }
  }
}
