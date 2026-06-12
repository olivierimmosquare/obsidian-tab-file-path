import {
    debounce,
    Plugin,
    WorkspaceLeaf,
} from 'obsidian';

export default class TabFilePathPlugin extends Plugin {
    async onload() {
        // const workspaceEvents = [
        //     'active-leaf',
        //     'css-change',
        //     'editor-change',
        //     'editor-drop',
        //     'editor-menu',
        //     'editor-paste',
        //     'file-menu',
        //     'file-open',
        //     'files-menu',
        //     'layout-change',
        //     'quick-preview',
        //     'quit',
        //     'resize',
        //     'url-menu',
        //     'window-close',
        //     'window-open',
        // ];
        // workspaceEvents.forEach((event) => {
        //     this.registerEvent(this.app.workspace.on(event, () => console.log(`event: ${event}`)))
        // });

        const setTabTitlesDebounced = debounce(this.setTabTitles.bind(this), 100);

        // Modifying leaf.tabHeaderInnerTitleEl in response to a 'file-open'
        // event doesn't seem to cause the tab UI to refresh properly.
        // Inspecting the element in dev tools shows it's been modified, but the
        // Obsidian UI isn't refreshing to show it.  Reacting to 'layout-change'
        // seems to work though, but it happens more frequently, so we just
        // debounce it and move on with life.
        this.registerEvent(this.app.workspace.on('layout-change', setTabTitlesDebounced));

        // Renaming a folder causes this to fire for all contained files, so
        // debounce this callback as well.
        this.registerEvent(this.app.vault.on('rename', setTabTitlesDebounced));

        this.setTabTitles();
    }

    setTabTitles() {
        const leaves = this.app.workspace.getLeavesOfType('markdown');

        // Every tab shows at least its parent folder ("proxmox-ve/creer-une-vm").
        // Files at the vault root only have their own name.
        const shortNames = leaves.map(leaf => {
            const parts = this.getLeafName(leaf).split('/').filter(Boolean);
            return parts.slice(-2).join('/');
        });

        const shortNameCounts: Record<string, number> = {};
        for (const name of shortNames) {
            shortNameCounts[name] = (shortNameCounts[name] ?? 0) + 1;
        }

        // When two tabs still collide on "parent/name", fall back to the full path.
        leaves.forEach((leaf, ii) => {
            const title = shortNameCounts[shortNames[ii]] > 1 ? this.getLeafName(leaf) : shortNames[ii];
            this.setLeafTitle(leaf, title);
        });
    }

    getLeafName(leaf: WorkspaceLeaf): string {
        const filePath = (leaf.isDeferred) ? leaf.view.state.file : leaf.view.file.path;
        return filePath.toLowerCase().endsWith('.md') ? filePath.slice(0, -3) : filePath;
    }

    setLeafTitle(leaf: WorkspaceLeaf, title: string) {
        // Note to self about related properties available depending on
        // the state of leaf.isDeferred:
        //
        // leaf.tabHeaderEl
        // leaf.tabHeaderInnerTitleEl
        // if (leaf.isDeferred) {
        //     leaf.view.title
        //     leaf.view.state.file (string)
        // } else {
        //     leaf.view.file (TFile?)
        //     leaf.view.titleEl
        //     leaf.view.titleContainerEl
        // }
        leaf.tabHeaderEl.setAttribute('aria-label', title);
        leaf.tabHeaderInnerTitleEl.innerText = title;
        leaf.tabHeaderInnerTitleEl.classList.add('tab__title');
    }
}
