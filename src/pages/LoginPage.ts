export function renderLoginPageHtml(): string {
  return `
    <section class="login-page" id="auth-panel">
      <div class="login-hero">
        <div class="login-brand">
          <span class="material-symbols-rounded login-brand-icon" aria-hidden="true">security</span>
          <span class="login-brand-name">BNKR</span>
        </div>
        <h1 class="login-headline">Your links.<br>Your bunker.</h1>
        <p class="login-tagline">Encrypted, local-first, and always ready — even when the internet isn't.</p>
        <ul class="login-features" aria-label="Features">
          <li class="login-feature">
            <span class="material-symbols-rounded" aria-hidden="true">shield_lock</span>
            <span>AES-256 encrypted vault</span>
          </li>
          <li class="login-feature">
            <span class="material-symbols-rounded" aria-hidden="true">devices</span>
            <span>P2P sync across devices</span>
          </li>
          <li class="login-feature">
            <span class="material-symbols-rounded" aria-hidden="true">wifi_off</span>
            <span>Fully offline capable</span>
          </li>
        </ul>

        <div class="login-install-panel">
          <div class="login-install-header">
            <div class="login-install-icon-wrap">
              <span class="material-symbols-rounded" aria-hidden="true">download</span>
            </div>
            <div>
              <p class="login-install-title">Install BNKR</p>
              <p class="login-install-copy">Add BNKR to your home screen for quick access and offline use.</p>
            </div>
          </div>

          <button id="landing-install-btn" type="button" class="login-install-btn" hidden>
            Add to Home Screen
          </button>

          <div class="login-install-grid">
            <div class="login-install-step">
              <span class="material-symbols-rounded" aria-hidden="true">phone_android</span>
              <div>
                <strong>Android</strong>
                <p>Best experience in <strong>Chrome</strong>: open the browser menu and choose <strong>Add to Home screen</strong>.</p>
              </div>
            </div>
            <div class="login-install-step">
              <span class="material-symbols-rounded" aria-hidden="true">phone_iphone</span>
              <div>
                <strong>iOS</strong>
                <p>Open the Share menu and tap <strong>Add to Home Screen</strong>.</p>
              </div>
            </div>
            <div class="login-install-step">
              <span class="material-symbols-rounded" aria-hidden="true">share</span>
              <div>
                <strong>Share links</strong>
                <p>Share from your browser and open BNKR to save links directly.</p>
              </div>
            </div>
          </div>
        </div>
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
