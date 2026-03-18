export function renderLoginPageHtml(): string {
  return `
    <section class="login-page" id="auth-panel">
      <div class="login-hero">
        <div class="login-brand">
          <span class="material-symbols-rounded login-brand-icon" aria-hidden="true">lock_open</span>
          <span class="login-brand-name">LinkLocker</span>
        </div>
        <h1 class="login-headline">Save now,<br>sort later.</h1>
        <p class="login-tagline">Your personal link board — groups, tags, and ready offline.</p>
        <ul class="login-features" aria-label="Features">
          <li class="login-feature">
            <span class="material-symbols-rounded" aria-hidden="true">bookmarks</span>
            <span>Organize with groups &amp; tags</span>
          </li>
          <li class="login-feature">
            <span class="material-symbols-rounded" aria-hidden="true">cloud_sync</span>
            <span>Sync across all your devices</span>
          </li>
          <li class="login-feature">
            <span class="material-symbols-rounded" aria-hidden="true">wifi_off</span>
            <span>Works fully offline too</span>
          </li>
        </ul>
      </div>

      <div class="login-card">
        <div class="login-tabs" role="tablist" aria-label="Authentication mode">
          <button type="button" class="login-tab login-tab--active" id="tab-login" role="tab" aria-selected="true">Sign In</button>
          <button type="button" class="login-tab" id="tab-register" role="tab" aria-selected="false">Register</button>
        </div>

        <form id="auth-form" class="login-form">
          <div class="login-field">
            <label class="login-label" for="username">
              <span class="material-symbols-rounded" aria-hidden="true">person</span>
              Username
            </label>
            <input
              id="username"
              type="text"
              class="login-input"
              placeholder="Enter your username"
              autocomplete="username"
              required
            />
          </div>

          <div class="login-field">
            <label class="login-label" for="password">
              <span class="material-symbols-rounded" aria-hidden="true">lock</span>
              Password
            </label>
            <div class="login-input-group">
              <input
                id="password"
                type="password"
                class="login-input"
                placeholder="Minimum 6 characters"
                autocomplete="current-password"
                required
                minlength="6"
              />
              <button
                type="button"
                class="login-eye-btn"
                id="toggle-password"
                aria-label="Show password"
              >
                <span class="material-symbols-rounded" id="eye-icon" aria-hidden="true">visibility</span>
              </button>
            </div>
          </div>

          <p id="auth-message" class="login-message" aria-live="polite"></p>

          <button id="login-btn" type="submit" class="login-submit-btn">
            <span class="material-symbols-rounded" aria-hidden="true">login</span>
            <span class="login-btn-label">Sign In</span>
          </button>

          <button id="register-btn" type="button" class="login-submit-btn" hidden>
            <span class="material-symbols-rounded" aria-hidden="true">person_add</span>
            <span class="login-btn-label">Create Account</span>
          </button>
        </form>

        <div class="login-divider" aria-hidden="true"><span>or</span></div>

        <button id="offline-mode-btn" type="button" class="login-offline-btn">
          <span class="material-symbols-rounded" aria-hidden="true">wifi_off</span>
          Continue without account
        </button>
      </div>
    </section>
  `
}
