// workspace.js — handles saving and loading the CAM state (documents + toolpaths)
window.workspace = (function () {
    const STORAGE_KEY = 'cam.workspace';
    const LOADER = new THREE.ObjectLoader();

    // Custom replacer to not serialize the heavy output generated toolpaths or workers
    function replacer(key, value) {
        if (key === 'inflated' || key === 'pretty' || key === 'worker') return undefined; // Drop heavy data
        return value;
    }

    function save() {
        const payload = {
            docs: [],
            toolpaths: []
        };

        // Export documents
        const docGroup = cam3d.docGroup;
        if (docGroup) {
            docGroup.children.forEach(obj => {
                payload.docs.push(obj.toJSON());
            });
        }

        // Export toolpaths
        const tps = toolpathManager.getAll();
        tps.forEach(tp => {
            payload.toolpaths.push({
                id: tp.id,
                name: tp.name,
                color: tp.color,
                group: tp.group.toJSON()
            });
        });

        if (payload.docs.length === 0 && payload.toolpaths.length === 0) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }

        try {
            const data = JSON.stringify(payload, replacer);
            localStorage.setItem(STORAGE_KEY, data);
            console.log(`[Web CAM] Workspace autosaved (${payload.docs.length} docs, ${payload.toolpaths.length} tps)`);
        } catch (e) {
            console.error('[Web CAM] Failed to autosave workspace', e);
        }
    }

    function load() {
        const dataStr = localStorage.getItem(STORAGE_KEY);
        if (!dataStr) return false;

        try {
            const payload = JSON.parse(dataStr);
            if (!payload || (!payload.docs && !payload.toolpaths)) return false;

            let loadedAnything = false;

            // Restore documents
            if (payload.docs && payload.docs.length > 0) {
                cam3d.clearDocument();
                payload.docs.forEach(docJson => {
                    const obj = LOADER.parse(docJson);
                    cam3d.addDocObject(obj);
                });
                loadedAnything = true;
            }

            // Restore toolpaths
            if (payload.toolpaths && payload.toolpaths.length > 0) {
                toolpathManager.clearAll();
                payload.toolpaths.forEach(tpData => {
                    const group = LOADER.parse(tpData.group);
                    toolpathManager.restoreToolpath({
                        id: tpData.id,
                        name: tpData.name,
                        color: tpData.color,
                        group: group,
                        previewObj: null,
                        worker: null
                    });

                    // Immediately re-trigger worker so previews recalculate headless in background
                    toolpathManager.preview(tpData.id);
                });

                // Enable the Generate G-Code button since we have restored toolpaths
                document.getElementById('btn-generate').disabled = false;

                loadedAnything = true;
            }

            if (loadedAnything) {
                console.log('[Web CAM] Workspace restored from autosave');
            }
            return loadedAnything;

        } catch (e) {
            console.error('[Web CAM] Failed to load workspace', e);
            return false;
        }
    }

    function reset() {
        if (!confirm('Are you sure you want to reset the entire workspace? This will delete all vectors and toolpaths.')) return;

        localStorage.removeItem(STORAGE_KEY);
        cam3d.clearDocument();
        toolpathManager.clearAll();

        // Reset G-code if any
        const gcodeArea = document.getElementById('gcode-output');
        if (gcodeArea) gcodeArea.value = '';

        const btnGen = document.getElementById('btn-generate');
        if (btnGen) btnGen.disabled = true;

        toast.success('Workspace reset');
        cam3d.resetView();
    }

    function init() {
        // Attempt to load previous state automatically
        load();

        // Autosave identical to the original OpenBuilds CAM behavior
        window.addEventListener('beforeunload', save);
    }

    return { init, save, load, reset };
})();
