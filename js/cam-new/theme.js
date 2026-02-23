// theme.js — same switcher logic as webserial-grblhal
window.themeManager = {
    STORAGE_KEY: 'cam.theme',

    init() {
        // Apply saved theme
        const saved = localStorage.getItem(this.STORAGE_KEY) || 'dark';
        this.apply(saved);

        // Wire buttons
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => this.apply(btn.dataset.theme));
        });
    },

    apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(this.STORAGE_KEY, theme);

        // Highlight active button
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });

        // Update 3D viewer background if ready
        if (window.cam3d && window.cam3d.scene) window.cam3d.applyTheme(theme);
    }
};
