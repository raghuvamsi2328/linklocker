export function renderAppPageHtml(): string {
  return `
    <section id="app-panel" hidden>

      <!-- Compact Header -->
      <header class="app-header">
        <div class="app-header-top">
          <div class="app-brand-row">
            <div class="app-greeting-wrap">
              <p class="app-greeting" id="app-greeting">Good morning</p>
              <p class="app-subgreeting">Secure. Local. Yours.</p>
            </div>
          </div>
          <button id="logout-btn" type="button" class="app-icon-btn app-icon-btn--logout" aria-label="Logout">
            <span class="material-symbols-rounded" aria-hidden="true">logout</span>
          </button>
        </div>
      </header>

      <section class="tab-panel is-active" data-tab-panel="home">
        <section id="home-empty-state" class="home-empty" hidden>
          <span class="material-symbols-rounded home-empty-icon" aria-hidden="true">travel_explore</span>
          <h3 class="home-empty-title">Start your vault</h3>
          <p class="home-empty-copy">Save your first link, create a group, and keep everything in one place.</p>
          <div class="home-empty-actions">
            <button type="button" class="home-empty-btn home-empty-btn--primary" data-home-add>
              <span class="material-symbols-rounded" aria-hidden="true">add_link</span>
              Add first link
            </button>
            <button type="button" class="home-empty-btn" data-home-group>
              <span class="material-symbols-rounded" aria-hidden="true">create_new_folder</span>
              Create group
            </button>
          </div>
        </section>

        <div class="quick-actions quick-actions--dense" id="home-quick-actions">
          <button type="button" class="action-card" id="composer-card" data-opens-panel="link">
            <span class="action-toggle-icon">
              <span class="material-symbols-rounded" aria-hidden="true">add_link</span>
            </span>
            <span class="action-toggle-label">Add Link</span>
          </button>

          <button type="button" class="action-card" id="backup-card" data-opens-panel="backup">
            <span class="action-toggle-icon action-toggle-icon--sky">
              <span class="material-symbols-rounded" aria-hidden="true">cloud_download</span>
            </span>
            <span class="action-toggle-label">Backup</span>
          </button>

          <button type="button" class="action-card" id="group-card" data-opens-panel="group">
            <span class="action-toggle-icon action-toggle-icon--purple">
              <span class="material-symbols-rounded" aria-hidden="true">create_new_folder</span>
            </span>
            <span class="action-toggle-label">New Group</span>
          </button>
        </div>

        <section class="home-preview" id="home-preview" hidden>
          <article class="home-preview-card">
            <div class="home-preview-head">
              <h3 class="home-preview-title">Continue Reading</h3>
            </div>
            <div id="home-recent-visited-preview"></div>
          </article>

          <article class="home-preview-card">
            <div class="home-preview-head">
              <h3 class="home-preview-title">Groups</h3>
              <button type="button" class="home-preview-link" data-home-open-collections>Open all</button>
            </div>
            <div id="home-groups-preview"></div>
          </article>

          <article class="home-preview-card">
            <div class="home-preview-head">
              <h3 class="home-preview-title">Recent Links</h3>
            </div>
            <div id="home-recent-preview"></div>
          </article>
        </section>

        <footer class="quotes-band" id="home-quote" aria-label="Quote of the moment">
          <span class="material-symbols-rounded quotes-icon" aria-hidden="true">format_quote</span>
          <p class="rotating-quote" id="rotating-quote">Stop digging — you have hit bottom.</p>
        </footer>
      </section>

      <section class="tab-panel" data-tab-panel="search">
        <section class="collections-section">
          <div class="collections-hd">
            <div class="collections-title-row">
              <h2 class="collections-title">
                <span class="material-symbols-rounded" aria-hidden="true">search</span>
                Search
              </h2>
            </div>
            <div class="collections-filters">
              <div class="coll-search-wrap">
                <span class="material-symbols-rounded" aria-hidden="true">search</span>
                <input id="filter-tag" type="search" class="coll-search" placeholder="Search links…" />
              </div>
              <select id="filter-group" class="coll-group-select">
                <option value="">All groups</option>
              </select>
              <button id="clear-filters" type="button" class="coll-clear-btn" aria-label="Clear filters">
                <span class="material-symbols-rounded" aria-hidden="true">filter_alt_off</span>
              </button>
            </div>
          </div>
        </section>
      </section>

      <section class="tab-panel" data-tab-panel="add">
        <div class="quick-actions quick-actions--stacked">
          <button type="button" class="action-card action-card--wide" data-opens-panel="link">
            <span class="action-toggle-icon"><span class="material-symbols-rounded" aria-hidden="true">add_link</span></span>
            <span class="action-toggle-label">Add Link</span>
          </button>
          <button type="button" class="action-card action-card--wide" data-opens-panel="group">
            <span class="action-toggle-icon action-toggle-icon--purple"><span class="material-symbols-rounded" aria-hidden="true">create_new_folder</span></span>
            <span class="action-toggle-label">Create Group</span>
          </button>
        </div>
      </section>

      <section class="tab-panel" data-tab-panel="collections">
        <section class="collections-section">
          <div class="collections-hd">
            <div class="collections-title-row">
              <h2 class="collections-title">
                <span class="material-symbols-rounded" aria-hidden="true">collections_bookmark</span>
                My Collections
              </h2>
              <div class="coll-view-tabs" role="group" aria-label="View by">
                <button type="button" class="coll-view-tab coll-view-tab--active" id="view-group-btn">
                  <span class="material-symbols-rounded" aria-hidden="true">folder_open</span>
                  Groups
                </button>
                <button type="button" class="coll-view-tab" id="view-tag-btn">
                  <span class="material-symbols-rounded" aria-hidden="true">tag</span>
                  Tags
                </button>
              </div>
            </div>
          </div>

          <select id="view-mode" aria-hidden="true" style="display:none">
            <option value="group">View: Groups</option>
            <option value="tag">View: Tags</option>
          </select>

          <div id="link-board" class="board"></div>
        </section>
      </section>

      <section class="tab-panel" data-tab-panel="settings">
        <div class="settings-card">
          <h3 class="settings-title">Install & Device</h3>
          <p class="settings-copy">Use the install button for Android Chrome. On iOS, use Share -> Add to Home Screen.</p>
          <button id="device-id-btn" type="button" class="action-btn action-btn--ghost action-btn--full device-id-btn" aria-label="Device pairing code" title="Your device pairing code">
            <span class="material-symbols-rounded" aria-hidden="true">devices</span>
            Pairing Code: <span id="device-pairing-code">····</span>
          </button>
          <button id="settings-install-btn" type="button" class="action-btn action-btn--ghost action-btn--full" hidden>
            <span class="material-symbols-rounded" aria-hidden="true">download</span>
            Install App
          </button>
        </div>
      </section>

      <!-- ── Action Modal ── -->
      <div class="action-modal-overlay" id="action-modal" hidden>
        <div class="action-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="action-modal-head">
            <h2 class="action-modal-title" id="modal-title">Add Link</h2>
            <button class="action-modal-close" id="modal-close" aria-label="Close" type="button">
              <span class="material-symbols-rounded" aria-hidden="true">close</span>
            </button>
          </div>

          <div class="action-modal-body">

            <!-- Add Link panel -->
            <div id="modal-link-panel" class="modal-panel">
              <form id="link-form" class="action-form">
                <div class="action-field">
                  <label class="action-label" for="link-url">
                    <span class="material-symbols-rounded" aria-hidden="true">link</span>URL
                  </label>
                  <input id="link-url" type="url" class="action-input" placeholder="https://example.com" required />
                </div>
                <div class="action-field">
                  <label class="action-label" for="link-title">
                    <span class="material-symbols-rounded" aria-hidden="true">title</span>Title
                  </label>
                  <input id="link-title" type="text" class="action-input" placeholder="Optional title" />
                </div>
                <div class="action-field-row">
                  <div class="action-field">
                    <label class="action-label" for="link-group">
                      <span class="material-symbols-rounded" aria-hidden="true">folder</span>Group
                    </label>
                    <select id="link-group" class="action-input" aria-label="Group">
                      <option value="">No Group</option>
                    </select>
                  </div>
                  <div class="action-field">
                    <label class="action-label" for="link-tags">
                      <span class="material-symbols-rounded" aria-hidden="true">tag</span>Tags
                    </label>
                    <input id="link-tags" type="text" class="action-input" placeholder="comma separated" />
                  </div>
                </div>
                <div class="action-footer">
                  <button id="metadata-btn" type="button" class="action-btn action-btn--ghost">
                    <span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
                    Auto Fill
                  </button>
                  <button type="submit" class="action-btn action-btn--primary">
                    <span class="material-symbols-rounded" aria-hidden="true">save</span>
                    Save Link
                  </button>
                </div>
                <p id="save-message" class="action-message" aria-live="polite"></p>
              </form>
            </div>

            <!-- Backup panel -->
            <div id="modal-backup-panel" class="modal-panel" hidden>
              <div class="action-footer action-footer--col">
                <button id="export-btn" type="button" class="action-btn action-btn--ghost action-btn--full">
                  <span class="material-symbols-rounded" aria-hidden="true">download</span>
                  Export JSON
                </button>
                <label class="action-btn action-btn--ghost action-btn--full" style="cursor:pointer">
                  <span class="material-symbols-rounded" aria-hidden="true">upload</span>
                  Import JSON
                  <input id="import-file" type="file" accept=".json" style="display:none">
                </label>
              </div>
              <p id="backup-message" class="action-message" aria-live="polite"></p>
            </div>

            <!-- New Group panel -->
            <div id="modal-group-panel" class="modal-panel" hidden>
              <form id="group-form" class="action-form">
                <div class="action-field">
                  <label class="action-label" for="group-name">
                    <span class="material-symbols-rounded" aria-hidden="true">folder</span>Group Name
                  </label>
                  <input id="group-name" type="text" class="action-input" placeholder="e.g. Reading List, Design Refs…" required />
                </div>
                <div class="action-footer">
                  <button type="submit" class="action-btn action-btn--primary action-btn--full">
                    <span class="material-symbols-rounded" aria-hidden="true">create_new_folder</span>
                    Create Group
                  </button>
                </div>
                <p id="group-message" class="action-message" aria-live="polite"></p>
              </form>
            </div>

          </div>
        </div>
      </div>

      <nav class="bottom-nav" id="bottom-nav" aria-label="Primary">
        <button class="bottom-nav-tab is-active" data-tab="home" type="button" aria-label="Home">
          <span class="material-symbols-rounded" aria-hidden="true">home</span>
          <span>Home</span>
        </button>
        <button class="bottom-nav-tab" data-tab="search" type="button" aria-label="Search">
          <span class="material-symbols-rounded" aria-hidden="true">search</span>
          <span>Search</span>
        </button>
        <button class="bottom-nav-tab" data-tab="add" type="button" aria-label="Add">
          <span class="material-symbols-rounded" aria-hidden="true">add_circle</span>
          <span>Add</span>
        </button>
        <button class="bottom-nav-tab" data-tab="collections" type="button" aria-label="Collections">
          <span class="material-symbols-rounded" aria-hidden="true">collections_bookmark</span>
          <span>Collections</span>
        </button>
        <button class="bottom-nav-tab" data-tab="settings" type="button" aria-label="Settings">
          <span class="material-symbols-rounded" aria-hidden="true">settings</span>
          <span>Settings</span>
        </button>
      </nav>

    </section>
  `
}
