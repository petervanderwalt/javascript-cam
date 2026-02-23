// toolpath-manager.js
// Wraps toolpathworker.js with the EXACT message protocol the worker expects.
// Operation names, userData keys, and serialisation all match what the worker reads.

window.toolpathManager = (function () {

    const WORKER_PATH = 'workers/toolpath/worker/toolpathworker.js';

    // Worker uses THREE.ObjectLoader().parse() to deserialise — so we must use
    // THREE.ObjectLoader().toJSON() to serialise.
    const LOADER = new THREE.ObjectLoader();

    // Operation map: human label → worker string
    const OP_MAP = {
        'Outside': 'CNC: Vector (path outside)',
        'Inside': 'CNC: Vector (path inside)',
        'Pocket': 'CNC: Pocket',
        'Engrave': 'CNC: Vector (no offset)',
        'Drill': 'Drill: Peck (Centered)',
        'Fill': 'CNC: Vector (no offset)',
        'Laser': 'Laser: Vector (no path offset)'
    };

    const TP_COLORS = [
        0x3b82f6, 0x22c55e, 0xf59e0b, 0xef4444, 0xa855f7,
        0x06b6d4, 0xf97316, 0x10b981, 0x6366f1, 0xec4899
    ];
    let colorIdx = 0;

    let toolpaths = [];   // Array<ToolpathEntry>
    let activeId = null;

    // ── ToolpathEntry shape ───────────────────────────────
    // {
    //   id:          number,
    //   name:        string,
    //   color:       number (0xRRGGBB),
    //   group:       THREE.Group  (the source geometry + userData),
    //   previewObj:  THREE.Object3D | null  (inflated result from worker),
    //   worker:      Worker | null
    // }

    // ── Build a clean THREE.Group with all required userData ─
    function buildGroup(name, srcObjects, settings) {
        var group = new THREE.Group();
        group.name = name;

        // Copy geometry from selected doc lines
        srcObjects.forEach(function (obj) {
            obj.traverse(function (child) {
                if (child instanceof THREE.Line && child.geometry) {
                    var clone = child.clone();
                    clone.userData.camSourceId = child.uuid; // Tag with source ID
                    const baseColor = child.userData._origColor || 0x888888;
                    clone.userData._origColor = baseColor;
                    // Strip pick-highlight back to original colour
                    if (clone.material) {
                        clone.material = clone.material.clone();
                        clone.material.color.setHex(baseColor);
                    }

                    group.add(clone);
                }
            });
        });

        applySettings(group, settings);
        return group;
    }

    // ── Apply settings to group.userData (exact keys worker reads) ──
    function applySettings(group, s) {
        var ud = group.userData;
        ud.camOperation = OP_MAP[s.operation] || s.operation || 'CNC: Vector (path outside)';
        ud.camToolDia = s.toolDia || 3.175;
        ud.camZStart = 0;
        ud.camZStep = s.passDepth || 3;
        ud.camZDepth = s.depth || 18;
        ud.camStepover = s.stepover || 0.4;      // pocket stepover fraction
        ud.camOffset = s.offset || 0;
        ud.camFeed = s.feed || 800;
        ud.camPlunge = s.plunge || 400;
        ud.camSpindle = s.spindle || 18000;
        ud.camTabWidth = s.tabWidth || 0;
        ud.camTabDepth = s.tabDepth || 3;
        ud.camTabLocations = s.tabLocs || ud.camTabLocations || [];
        ud.camDirection = s.direction || 'conventional';
        ud.camUnion = false;
        ud.visible = true;
        ud.worker = false;   // sentinel the old manager used
    }

    // ── Add toolpath ──────────────────────────────────────
    function addFromSelection(selectedObjects, settings) {
        if (!selectedObjects || selectedObjects.length === 0) {
            toast.info('Select vectors first');
            return null;
        }

        var id = Date.now();
        var color = TP_COLORS[colorIdx++ % TP_COLORS.length];
        var name = 'Toolpath ' + (toolpaths.length + 1);

        var group = buildGroup(name, selectedObjects, settings || {
            operation: 'Outside',
            toolDia: 3.175, passDepth: 3, depth: 18,
            feed: 800, plunge: 400, spindle: 18000
        });

        var entry = { id, name, color, group, previewObj: null, worker: null };
        toolpaths.push(entry);
        activeId = id;

        sidebar.refreshToolpathList();
        sidebar.showSettings(id);
        toast.success(name + ' created');
        document.getElementById('btn-generate').disabled = false;
        return entry;
    }

    function addToToolpath(id, selectedObjects) {
        var entry = getById(id);
        if (!entry) return;
        if (!selectedObjects || selectedObjects.length === 0) {
            toast.info('Select vectors first');
            return;
        }

        var existingUuids = [];
        entry.group.children.forEach(function (child) {
            if (child.userData && child.userData.camSourceId) {
                existingUuids.push(child.userData.camSourceId);
            }
        });

        var addedCount = 0;
        selectedObjects.forEach(function (obj) {
            // Already there?
            if (existingUuids.includes(obj.uuid)) return;

            obj.traverse(function (child) {
                if (child instanceof THREE.Line && child.geometry) {
                    var clone = child.clone();
                    clone.userData.camSourceId = child.uuid;
                    const baseColor = 0x888888;
                    clone.userData._origColor = baseColor;
                    if (clone.material) {
                        clone.material = clone.material.clone();
                        clone.material.color.setHex(baseColor); // neutral grey for source
                    }
                    entry.group.add(clone);
                    addedCount++;
                }
            });
        });

        if (addedCount > 0) {
            cam3d.registerSelectable(entry.group); // Register new siblings
            entry.previewObj = null; // Selection changed, kill old preview
            _rebuildScene();
            toast.success('Added ' + addedCount + ' vectors to ' + entry.name);
            sidebar.refreshToolpathList();
        } else {
            toast.info('Selection already in toolpath');
        }
    }

    function removeFromToolpath(id, selectedObjects) {
        var entry = getById(id);
        if (!entry) return;

        // What are we looking for? 
        // Either the UUID of the master vector, or the camSourceId of a clone.
        var targetSourceIds = selectedObjects.map(function (o) {
            return o.userData.camSourceId || o.uuid;
        });

        var toRemove = [];
        entry.group.children.forEach(function (child) {
            if (child.userData && child.userData.camSourceId && targetSourceIds.includes(child.userData.camSourceId)) {
                toRemove.push(child);
            }
        });

        toRemove.forEach(function (child) {
            entry.group.remove(child);
        });

        if (toRemove.length > 0) {
            entry.previewObj = null; // Selection changed
            _rebuildScene();
            toast.success('Removed ' + toRemove.length + ' vectors from ' + entry.name);
            sidebar.refreshToolpathList();
        }
    }

    function getSelectionStatus(id, selectedObjects) {
        var entry = getById(id);
        if (!entry || !selectedObjects || selectedObjects.length === 0) return 'none';

        var existingUuids = [];
        entry.group.children.forEach(function (child) {
            if (child.userData && child.userData.camSourceId) {
                existingUuids.push(child.userData.camSourceId);
            }
        });

        var count = 0;
        selectedObjects.forEach(function (obj) {
            var sourceId = obj.userData.camSourceId || obj.uuid;
            if (existingUuids.includes(sourceId)) {
                count++;
            }
        });

        if (count === 0) return 'all_new';
        if (count === selectedObjects.length) return 'all_existing';
        return 'mixed';
    }

    // ── Update settings on existing toolpath ──────────────
    function updateSettings(id, s) {
        var entry = getById(id);
        if (!entry) return;
        applySettings(entry.group, s);
        entry.group.userData.camTabLocations = s.tabLocs || entry.group.userData.camTabLocations;
    }

    // ── Preview via worker ────────────────────────────────
    function preview(id) {
        var entry = getById(id);
        if (!entry) return;

        // Kill existing worker
        if (entry.worker) { entry.worker.terminate(); entry.worker = null; }

        var worker = new Worker(WORKER_PATH);
        entry.worker = worker;
        entry.group.userData.worker = worker;  // old compat

        toast.info('Computing ' + entry.name + '…');
        sidebar.setSpinner(id, true);

        worker.addEventListener('message', function (e) {
            var d = e.data;

            if (d.running !== undefined) {
                sidebar.setSpinner(id, d.running);
                if (!d.running && id === activeId) {
                    var pc = document.getElementById('tp-progress-container');
                    if (pc) pc.style.display = 'none';
                }
            }

            if (d.progress) {
                if (id === activeId) {
                    var pc = document.getElementById('tp-progress-container');
                    var pb = document.getElementById('tp-worker-progress');
                    if (pc && pb && d.pass !== undefined) {
                        pc.style.display = 'block';
                        // Max passes is unknown, so we spoof a satisfying progress by scaling gracefully up to 90%
                        var per = Math.min((d.pass + 1) * 10, 95);
                        pb.style.width = per + '%';
                    }
                }
            }

            if (d.toolpath) {
                try {
                    var parsed = LOADER.parse(JSON.parse(d.toolpath));

                    // Inflate nested serialised objects
                    if (parsed.userData.inflated) {
                        parsed.userData.inflated = LOADER.parse(parsed.userData.inflated);
                        if (parsed.userData.inflated.userData.pretty)
                            parsed.userData.inflated.userData.pretty =
                                LOADER.parse(parsed.userData.inflated.userData.pretty);
                    }

                    entry.previewObj = parsed;
                    _rebuildScene();
                } catch (err) {
                    console.error('Worker parse error', err);
                    toast.error('Preview failed: ' + err.message);
                }

                worker.terminate();
                entry.worker = null;
                entry.group.userData.worker = false;
                sidebar.setSpinner(id, false);

                if (id === activeId) {
                    var pc = document.getElementById('tp-progress-container');
                    if (pc) pc.style.display = 'none';
                }

                toast.success(entry.name + ' preview ready');
            }
        });

        // serialise with THREE.ObjectLoader
        var json = entry.group.toJSON ? entry.group.toJSON() : JSON.parse(JSON.stringify(entry.group));

        worker.postMessage({
            data: {
                toolpath: JSON.stringify(json),
                index: toolpaths.indexOf(entry),
                performanceLimit: false
            }
        });
    }

    // ── Delete toolpath ───────────────────────────────────
    function deleteToolpath(id) {
        var idx = toolpaths.findIndex(t => t.id === id);
        if (idx < 0) return;
        var entry = toolpaths[idx];
        if (entry.worker) entry.worker.terminate();
        toolpaths.splice(idx, 1);
        if (activeId === id) activeId = toolpaths[0] ? toolpaths[0].id : null;
        _rebuildScene();
        sidebar.refreshToolpathList();
        if (activeId) sidebar.showSettings(activeId);
        else sidebar.hideSettings();
        toast.info('Toolpath removed');
    }

    // ── Clear all toolpaths (workspace reset / reload) ────
    function clearAll() {
        toolpaths.forEach(tp => {
            if (tp.worker) tp.worker.terminate();
        });
        toolpaths.length = 0;
        activeId = null;
        colorIdx = 0;
        _rebuildScene();
        sidebar.refreshToolpathList();
        sidebar.hideSettings();
    }

    // ── Restore toolpath (workspace load) ─────────────────
    function restoreToolpath(entry) {
        // Strip out existing highlight overlays
        entry.group.traverse(function (child) {
            if (child.material && child.userData && child.userData._origColor) {
                child.material.color.setHex(child.userData._origColor);
            }
        });

        toolpaths.push(entry);
        activeId = entry.id; // Switch active to the last loaded one
        colorIdx++;

        _rebuildScene();
        sidebar.refreshToolpathList();
        sidebar.showSettings(activeId);
    }

    // ── Scene sync ────────────────────────────────────────
    function _rebuildScene() {
        cam3d.clearToolpaths();
        toolpaths.forEach(function (entry) {
            if (!entry.group) return;

            const isActive = (entry.id === activeId);

            // Set the "base" color of the group objects. 
            // Active toolpaths get their full color, inactive ones stay grey.
            const targetColor = isActive ? entry.color : 0x888888;
            entry.group.traverse(function (child) {
                if (child instanceof THREE.Line) {
                    child.userData._origColor = targetColor;
                }
            });

            if (entry.previewObj) {
                cam3d.addToolpathObject(entry.previewObj);
                if (entry.previewObj.userData.inflated)
                    cam3d.addToolpathObject(entry.previewObj.userData.inflated);
                if (entry.previewObj.userData.inflated &&
                    entry.previewObj.userData.inflated.userData.pretty)
                    cam3d.addToolpathObject(
                        entry.previewObj.userData.inflated.userData.pretty);

                // If active, we ALSO show the source geometry on top 
                // so you can see the selection even with a preview loaded.
                if (isActive) {
                    cam3d.addToolpathObject(entry.group);
                }
            } else {
                // No preview yet? Show the raw source geometry (colored if active)
                cam3d.addToolpathObject(entry.group);
            }
        });
        // Force highlight update to apply the new _origColor
        cam3d.updateSelectionHighlight();
    }

    // ── G-Code generation ─────────────────────────────────
    // Enumerates inflated geometry (what the worker produced) → G-code
    function generateGcode(safeZ, onProgress, onDone) {
        var visible = toolpaths.filter(function (t) { return t.group && t.group.userData.visible; });
        if (visible.length === 0) { toast.error('No toolpaths to export'); return; }

        var lines = [];
        lines.push('; Web CAM — generated ' + new Date().toISOString());
        lines.push('G21 ; mm mode');
        lines.push('G90 ; absolute');
        lines.push('G17 ; XY plane');
        lines.push('');

        visible.forEach(function (entry, i) {
            var ud = entry.group.userData;
            var feed = ud.camFeed || 800;
            var plunge = ud.camPlunge || 400;
            var safeZv = safeZ;

            lines.push('; ═══ ' + entry.name + ' ══════════════════');
            lines.push('; Operation : ' + ud.camOperation);
            lines.push('; Tool dia  : ' + ud.camToolDia + 'mm');
            lines.push('; Cut depth : ' + ud.camZDepth + 'mm');
            if (ud.camSpindle > 0) lines.push('M3 S' + ud.camSpindle);
            lines.push('G0 Z' + f(safeZv));
            lines.push('');

            // Walk inflated geometry (the actual toolpath produced by the worker)
            var src = (entry.previewObj && entry.previewObj.userData.inflated)
                ? entry.previewObj.userData.inflated
                : entry.group;

            src.traverse(function (child) {
                if (!(child instanceof THREE.Line)) return;
                // Calculate absolute world Z of this line (geometry Z + object Z)
                var verts = child.geometry.vertices;
                if (!verts || verts.length < 2) return;

                var worldPos = new THREE.Vector3();
                child.getWorldPosition(worldPos);
                var realZ = (verts[0].z || 0) + worldPos.z;

                lines.push('G0 X' + f(verts[0].x) + ' Y' + f(verts[0].y));
                lines.push('G1 Z' + f(realZ) + ' F' + plunge);
                for (var j = 1; j < verts.length; j++) {
                    lines.push('G1 X' + f(verts[j].x) + ' Y' + f(verts[j].y) + ' F' + feed);
                }
                lines.push('G0 Z' + f(safeZv));
                lines.push('');
            });

            lines.push('M5 ; spindle off');
            lines.push('G0 Z' + f(safeZv));
            lines.push('');
            onProgress && onProgress(Math.round((i + 1) / visible.length * 100));
        });

        lines.push('G0 X0 Y0');
        lines.push('M30');
        onDone && onDone(lines.join('\n'));
    }

    function f(n) { return parseFloat(n.toFixed(4)); }

    // ── Helpers ───────────────────────────────────────────
    function getById(id) { return toolpaths.find(function (t) { return t.id === id; }); }
    function getActive() { return toolpaths.find(t => t.id === activeId); }
    function setActive(id) { activeId = id; }
    function getAll() { return toolpaths; }
    function areWorkersBusy() { return toolpaths.some(function (t) { return t.worker; }); }

    return {
        addFromSelection,
        updateSettings,
        preview,
        deleteToolpath,
        clearAll,
        restoreToolpath,
        generateGcode,
        getAll,
        getActive,
        getById,
        setActive,
        addToToolpath,
        removeFromToolpath,
        getSelectionStatus,
        areWorkersBusy
    };
})();
