export function renderAppPageHtml(): string {
  return `
    <section id="app-panel" hidden>

      <!-- ── Header ── -->
      <header class="app-header">
        <div class="app-header-top">
          <div class="app-brand-row">
            <button class="bookmark-btn" id="bookmark-anim" aria-label="BNKR home" type="button">
              <span class="material-symbols-rounded bookmark-icon" aria-hidden="true">security</span>
              <span class="bookmark-ring" aria-hidden="true"></span>
            </button>
            <div class="app-greeting-wrap">
              <p class="app-greeting" id="app-greeting">Hello!</p>
              <p class="app-subgreeting">Secure. Local. Yours.</p>
            </div>
          </div>
          <button id="logout-btn" type="button" class="app-icon-btn app-icon-btn--logout" aria-label="Logout">
            <span class="material-symbols-rounded" aria-hidden="true">logout</span>
          </button>
        </div>

        <div class="app-header-pills">
          <div id="sync-status" class="status-pill" data-status="synced">Local vault</div>
          <button id="device-id-btn" type="button" class="status-pill device-id-pill" aria-label="Device pairing code" title="Your device pairing code">
            <span class="material-symbols-rounded" aria-hidden="true" style="font-size:14px;vertical-align:middle">devices</span>
            <span id="device-pairing-code">····</span>
          </button>
          <button id="install-btn" type="button" class="app-icon-btn" hidden aria-label="Install app">
            <span class="material-symbols-rounded" aria-hidden="true">download</span>
          </button>
        </div>

        <div class="app-stats" id="app-stats">
          <div class="app-stat">
            <span class="material-symbols-rounded" aria-hidden="true">link</span>
            <span><strong id="stat-links">0</strong> links</span>
          </div>
          <div class="app-stat">
            <span class="material-symbols-rounded" aria-hidden="true">folder_open</span>
            <span><strong id="stat-groups">0</strong> groups</span>
          </div>
          <div class="app-stat">
            <span class="material-symbols-rounded" aria-hidden="true">sell</span>
            <span><strong id="stat-tags">0</strong> tags</span>
          </div>
        </div>
      </header>

      <!-- ── Quick Actions — 3 compact trigger buttons ── -->
      <div class="quick-actions">
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
                    <input id="link-group" type="text" class="action-input" placeholder="e.g. Work" />
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

      <!-- ── My Collections ── -->
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

        <select id="view-mode" aria-hidden="true" style="display:none">
          <option value="group">View: Groups</option>
          <option value="tag">View: Tags</option>
        </select>

        <div id="link-board" class="board"></div>
      </section>

      <!-- ── Quotes ── -->
      <footer class="quotes-band" aria-label="Quote of the moment">
        <span class="material-symbols-rounded quotes-icon" aria-hidden="true">format_quote</span>
        <p class="rotating-quote" id="rotating-quote">Stop digging — you have hit bottom.</p>
      </footer>

    </section>
  `
}
