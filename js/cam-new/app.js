// app.js — bootstrap entry point for index.html
(function () {
    'use strict';

    function boot() {
        // 1. Theme (before rendering anything)
        themeManager.init();

        // 2. 3D Viewer
        cam3d.init('viewport');

        // 3. File loader
        fileLoader.init();

        // 4. Sidebar
        sidebar.init();

        // 5. Workspace persistence (auto load)
        workspace.init();

        // 6. Initial reset view (after small delay for layout to settle)
        setTimeout(() => cam3d.resetView(), 300);

        console.log('[Web CAM] Ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
