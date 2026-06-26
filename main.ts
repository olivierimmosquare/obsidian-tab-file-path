import {
    debounce,
    Plugin,
    TFile,
    WorkspaceLeaf,
} from 'obsidian';

export default class TabFilePathPlugin extends Plugin {
    setTabTitlesDebounced = debounce(this.setTabTitles.bind(this), 100);
    setSearchFoldersDebounced = debounce(this.setSearchFolders.bind(this), 100);

    // Leaves whose 'pinned-change' event is already hooked, so repeated
    // setTabTitles() calls don't stack duplicate handlers on the same leaf.
    pinHookedLeaves = new WeakSet<WorkspaceLeaf>();

    // Search leaves already fitted with a MutationObserver, so we don't
    // attach a second one each time setSearchFolders() runs.
    searchObservedLeaves = new WeakSet<WorkspaceLeaf>();

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

        // Modifying leaf.tabHeaderInnerTitleEl in response to a 'file-open'
        // event doesn't seem to cause the tab UI to refresh properly.
        // Inspecting the element in dev tools shows it's been modified, but the
        // Obsidian UI isn't refreshing to show it.  Reacting to 'layout-change'
        // seems to work though, but it happens more frequently, so we just
        // debounce it and move on with life.
        this.registerEvent(this.app.workspace.on('layout-change', this.setTabTitlesDebounced));

        // Search results show only the file name by default; prepend the parent
        // folder so files that share a name stay distinguishable, mirroring the
        // tab titles.  'layout-change' fires when the search pane opens/closes.
        this.registerEvent(this.app.workspace.on('layout-change', this.setSearchFoldersDebounced));

        // Renaming a folder causes this to fire for all contained files, so
        // debounce this callback as well.
        this.registerEvent(this.app.vault.on('rename', this.setTabTitlesDebounced));
        this.registerEvent(this.app.vault.on('rename', this.setSearchFoldersDebounced));

        // Double-clicking a tab header toggles its pinned state.  This is
        // the main affordance for (un)pinning since the pin icon is hidden
        // by styles.css on pinned tabs.
        //
        // The tab bar doubles as the window title bar, where Obsidian maps
        // double-click to maximizing the window.  Listening in the capture
        // phase and stopping propagation keeps that behavior on the empty
        // bar area only, not on the tabs themselves.
        this.registerDomEvent(document, 'dblclick', (evt: MouseEvent) => {
            const headerEl = (evt.target as HTMLElement).closest('.mod-root .workspace-tab-header');
            if (!headerEl) {
                return;
            }
            evt.preventDefault();
            evt.stopPropagation();
            this.app.workspace.iterateAllLeaves((leaf) => {
                if (leaf.tabHeaderEl === headerEl) {
                    leaf.setPinned(!leaf.getViewState().pinned);
                }
            });
        }, { capture: true });

        this.setTabTitles();
        this.setSearchFolders();
    }

    setTabTitles() {
        const leaves = this.app.workspace.getLeavesOfType('markdown');

        // Every tab shows its full vault-relative path: folder path on top, file
        // name below.  Files at the vault root only have their own name.
        leaves.forEach((leaf) => {
            this.setLeafTitle(leaf, this.getLeafName(leaf));

            // (Un)pinning re-renders the tab header with the default plain-text
            // title, wiping the custom two-line markup — and it doesn't fire
            // 'layout-change', so the titles must be re-applied from the
            // leaf-level 'pinned-change' event.
            if (!this.pinHookedLeaves.has(leaf)) {
                this.pinHookedLeaves.add(leaf);
                this.registerEvent(leaf.on('pinned-change', this.setTabTitlesDebounced));
            }
        });
    }

    getLeafName(leaf: WorkspaceLeaf): string {
        const filePath = (leaf.isDeferred) ? leaf.view.state.file : leaf.view.file.path;
        return this.stripMarkdownExtension(filePath);
    }

    stripMarkdownExtension(filePath: string): string {
        return filePath.toLowerCase().endsWith('.md') ? filePath.slice(0, -3) : filePath;
    }

    // The vault-relative folder path of a file, empty for files at the root.
    folderPath(filePath: string): string {
        const parts = this.stripMarkdownExtension(filePath).split('/');
        parts.pop();
        return parts.join('/');
    }

    setSearchFolders() {
        // Obsidian renders search results lazily (the list is virtualized), so
        // rows come and go as the user types or scrolls.  A per-leaf
        // MutationObserver re-runs the decoration whenever the DOM changes, and
        // the work itself reads the result-to-file map exposed by the view.
        for (const leaf of this.app.workspace.getLeavesOfType('search')) {
            this.observeSearchLeaf(leaf);
            this.decorateSearchLeaf(leaf);
        }
    }

    observeSearchLeaf(leaf: WorkspaceLeaf) {
        if (this.searchObservedLeaves.has(leaf)) {
            return;
        }
        const containerEl = leaf.view?.containerEl as HTMLElement | undefined;
        if (!containerEl) {
            return;
        }
        this.searchObservedLeaves.add(leaf);
        const observer = new MutationObserver(() => this.setSearchFoldersDebounced());
        observer.observe(containerEl, { childList: true, subtree: true });
        this.register(() => observer.disconnect());
    }

    decorateSearchLeaf(leaf: WorkspaceLeaf) {
        // `dom.resultDomLookup` maps each matched TFile to its result row.  It's
        // an internal API, so guard against it disappearing rather than throwing
        // and breaking the search pane.
        const lookup = (leaf.view as any)?.dom?.resultDomLookup as Map<TFile, any> | undefined;
        if (!lookup) {
            return;
        }
        lookup.forEach((resultDom, file) => {
            const rowEl = (resultDom?.containerEl ?? resultDom?.el) as HTMLElement | undefined;
            const innerEl = rowEl?.querySelector('.tree-item-inner') as HTMLElement | null;
            if (innerEl) {
                this.setSearchFolder(innerEl, this.folderPath(file.path));
            }
        });
    }

    setSearchFolder(innerEl: HTMLElement, folder: string) {
        // The folder renders as a muted line above the file name.  Obsidian
        // rewrites .tree-item-inner on every result update (and reuses rows
        // across files when scrolling), so re-apply idempotently: skip when it's
        // already right, update stale text, and drop the line for root files.
        const firstChild = innerEl.firstElementChild;
        const existing = (firstChild?.classList.contains('search-result-file-folder'))
            ? firstChild as HTMLElement
            : null;

        if (!folder) {
            existing?.remove();
            return;
        }
        if (existing) {
            if (existing.textContent !== folder) {
                existing.textContent = folder;
            }
            return;
        }
        innerEl.prepend(createDiv({ cls: 'search-result-file-folder', text: folder }));
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

        // The tab title renders on two lines: folder path on top, file name
        // below.  Each line truncates at its end (ellipsis) so the start of
        // the text stays visible.  Files at the vault root only get the
        // file name line.
        const parts = title.split('/');
        const fileName = parts.pop() ?? title;
        const folderPath = parts.join('/');

        const titleEl = leaf.tabHeaderInnerTitleEl;
        titleEl.classList.add('tab__title');
        titleEl.empty();
        if (folderPath) {
            titleEl.createDiv({ cls: 'tab__title-folder', text: folderPath });
        }
        titleEl.createDiv({ cls: 'tab__title-name', text: fileName });
    }
}
