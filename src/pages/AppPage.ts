export function renderAppPageHtml(): string {
  return `
    <section id="app-panel" hidden>

      <!-- ── Hello Banner ── -->
      <header class="app-header">
        <div class="app-header-top">
          <div class="app-brand-row">
            <button class="bookmark-btn" id="bookmark-anim" aria-label="LinkLocker home" type="button">
              <span class="material-symbols-rounded bookmark-icon" aria-hidden="true">bookmark</span>
              <span class="bookmark-ring" aria-hidden="true"></span>
            </button>
            <div class="app-greeting-wrap">
              <p class="app-greeting" id="app-greeting">Hello!</p>
              <p class="app-subgreeting">Your personal link space</p>
            </div>
          </div>

          <div class="app-header-actions">
            <div id="sync-status" class="status-pill">Checking…</div>
            <select id="mode-switch" class="app-mode-select" aria-label="App mode">
              <option value="account">Account Sync</option>
              <option value="offline">Offline Local</option>
            </select>
            <button id="install-btn" type="button" class="app-icon-btn" hidden aria-label="Install app">
              <span class="material-symbols-rounded" aria-hidden="true">download</span>
            </button>
            <button id="logout-btn" type="button" class="app-icon-btn app-icon-btn--logout" aria-label="Logout">
              <span class="material-symbols-rounded" aria-hidden="true">logout</span>
            </button>
          </div>
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

      <!-- ── Quick Actions ── -->
      <div class="quick-actions">

        <!-- Add Link -->
        <section class="action-card" id="composer-card">
          <button type="button" class="action-toggle" data-card-toggle aria-expanded="false">
            <span class="action-toggle-icon">
              <span class="material-symbols-rounded" aria-hidden="true">add_link</span>
            </span>
            <span class="action-toggle-text">
              <span class="action-toggle-label">Add Link</span>
              <span class="action-toggle-hint">Save a URL to your collection</span>
            </span>
            <span class="material-symbols-rounded action-toggle-chevron" aria-hidden="true">expand_more</span>
          </button>

          <div class="action-body" data-card-body hidden>
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
        </section>

        <!-- New Group -->
        <section class="action-card" id="group-card">
          <button type="button" class="action-toggle" data-action-toggle aria-expanded="false">
            <span class="action-toggle-icon action-toggle-icon--purple">
              <span class="material-symbols-rounded" aria-hidden="true">create_new_folder</span>
            </span>
            <span class="action-toggle-text">
              <span class="action-toggle-label">New Group</span>
              <span class="action-toggle-hint">Create a named collection</span>
            </span>
            <span class="material-symbols-rounded action-toggle-chevron" aria-hidden="true">expand_more</span>
          </button>

          <div class="action-body" data-action-body hidden>
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
        </section>

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
              <input id="filter-tag" type="search" class="coll-search" placeholder="Search by tag…" />
            </div>
            <select id="filter-group" class="coll-group-select">
              <option value="">All groups</option>
            </select>
            <button id="clear-filters" type="button" class="coll-clear-btn" aria-label="Clear filters">
              <span class="material-symbols-rounded" aria-hidden="true">filter_alt_off</span>
            </button>
          </div>
        </div>

        <!-- hidden select kept for existing view-mode logic -->
        <select id="view-mode" aria-hidden="true" style="display:none">
          <option value="group">View: Groups</option>
          <option value="tag">View: Tags</option>
        </select>

        <div id="link-board" class="board"></div>
      </section>

    </section>
  `
}
