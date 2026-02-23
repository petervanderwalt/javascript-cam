// viewer3d.js — port of webserial-grblhal 3dview.js adapted for CAM
// Uses old Three.js API (global THREE) that the existing CAM already loads.

window.cam3d = (function () {

    // ── Theme backgrounds ─────────────────────────────────
    const BG = {
        'dark': 0x1a1a1a,
        'ooznest': 0xf3f5f6,
        'solar-yellow': 0xedf2f7
    };

    const GRID_MAJOR = {
        'dark': 0x334155,
        'ooznest': 0x94a3b8,
        'solar-yellow': 0xb0b8c4
    };
    const GRID_MINOR = {
        'dark': 0x1e293b,
        'ooznest': 0xdde3ec,
        'solar-yellow': 0xd1d9e3
    };

    const HIGHLIGHT = {
        'dark': 0xFFD949,       // Yellow
        'ooznest': 0x3b82f6,    // Blue
        'solar-yellow': 0xd32f2f // Dark Red
    };

    const HOVER = {
        'dark': 0x3b82f6,       // Blue
        'ooznest': 0x1e293b,    // Darker
        'solar-yellow': 0x3b82f6
    };

    // ── State ─────────────────────────────────────────────
    let scene, camera, pCamera, oCamera, renderer, controls, viewCube;
    let isOrtho = false;
    let gridGroup, docGroup, toolpathGroup, gcodeGroup;
    let container;
    let animId;
    let currentTheme = 'dark';
    let domW = 0, domH = 0;

    // Selection
    let raycaster = null;
    let mouseVec = null;
    let selectable = [];   // THREE objects that can be clicked
    let selected = [];   // currently selected set
    let hovered = null;    // currently hovered object

    // ── Init ──────────────────────────────────────────────
    function init(containerId) {
        container = document.getElementById(containerId);
        if (!container) return;

        domW = container.clientWidth;
        domH = container.clientHeight;

        // Scene
        scene = new THREE.Scene();

        // Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(domW, domH);
        container.appendChild(renderer.domElement);

        // Camera — top-down default, same FOV as reference
        pCamera = new THREE.PerspectiveCamera(45, domW / domH, 0.1, 20000);
        pCamera.up.set(0, 1, 0);
        pCamera.position.set(100, 100, 400);

        const aspect = domW / domH;
        oCamera = new THREE.OrthographicCamera(400 * aspect / -2, 400 * aspect / 2, 400 / 2, 400 / -2, 0.1, 20000);
        oCamera.up.set(0, 1, 0);
        oCamera.position.copy(pCamera.position);

        camera = pCamera;

        // Controls
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enableRotate = true;
        controls.enableZoom = true;
        controls.maxDistance = 8000;
        controls.rotateSpeed = 0.3; // Make touchpad/mouse orbiting less wildly sensitive
        controls.panSpeed = 0.5;

        // Trackpad friendly: Hold Shift to pan with Left Click
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
                controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
                controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
            }
        });

        // ViewCube
        if (window.ViewCube) {
            viewCube = new window.ViewCube(camera, controls, container);
        }

        // Raycaster for picking
        raycaster = new THREE.Raycaster();
        raycaster.linePrecision = 10;
        mouseVec = new THREE.Vector2();

        // Lighting (same as reference)
        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        hemi.position.set(0, 0, 200);
        scene.add(hemi);

        const dir = new THREE.DirectionalLight(0xffffff, 1.0);
        dir.position.set(50, 100, 150);
        scene.add(dir);

        // Groups
        gridGroup = new THREE.Group(); gridGroup.name = 'Grid';
        docGroup = new THREE.Group(); docGroup.name = 'Document';
        toolpathGroup = new THREE.Group(); toolpathGroup.name = 'Toolpaths';
        gcodeGroup = new THREE.Group(); gcodeGroup.name = 'GCode';
        scene.add(gridGroup);
        scene.add(docGroup);
        scene.add(toolpathGroup);
        scene.add(gcodeGroup);

        // Apply initial theme
        const saved = localStorage.getItem('cam.theme') || 'dark';
        applyTheme(saved);

        // Draw initial grid
        drawGrid(200, 200);

        // Mouse picking
        renderer.domElement.addEventListener('click', onCanvasClick);
        renderer.domElement.addEventListener('mousemove', onMouseMove);

        // Resize
        window.addEventListener('resize', onResize);

        // Animate
        animate();

        document.getElementById('viewport-status').textContent = 'Ready — drop a file to begin';
    }

    // ── Theme ─────────────────────────────────────────────
    function applyTheme(theme) {
        currentTheme = theme;
        const bg = BG[theme] || BG.dark;
        renderer.setClearColor(bg, 1);
        scene.background = new THREE.Color(bg);
        drawGrid(
            parseFloat(document.getElementById('job-x')?.value || 200),
            parseFloat(document.getElementById('job-y')?.value || 200)
        );
        updateSelectionHighlight();
    }

    // ── Grid (exact port of renderCoolGrid from reference) ──
    function drawGrid(sxmax, symax) {
        while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);

        const xmin = 0, xmax = sxmax, ymin = 0, ymax = symax;
        const maxDim = Math.max(xmax - xmin, ymax - ymin);
        let rawStep = maxDim / 10;
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const norm = rawStep / mag;
        let cleanStep = norm < 2 ? mag : norm < 5 ? 2 * mag : 5 * mag;
        if (cleanStep < 10) cleanStep = 10;
        const minorStep = cleanStep / 5;
        const eps = 0.0001;

        const cMajor = new THREE.Color(GRID_MAJOR[currentTheme] || GRID_MAJOR.dark);
        const cMinor = new THREE.Color(GRID_MINOR[currentTheme] || GRID_MINOR.dark);

        const verts = [], colors = [];

        for (let x = Math.floor(xmin / minorStep) * minorStep; x <= xmax + eps; x += minorStep) {
            if (x < xmin - eps || x > xmax + eps) continue;
            const major = Math.abs(x % cleanStep) < eps || Math.abs((x % cleanStep) - cleanStep) < eps;
            const c = major ? cMajor : cMinor;
            verts.push(x, ymin, 0, x, ymax, 0);
            colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
        for (let y = Math.floor(ymin / minorStep) * minorStep; y <= ymax + eps; y += minorStep) {
            if (y < ymin - eps || y > ymax + eps) continue;
            const major = Math.abs(y % cleanStep) < eps || Math.abs((y % cleanStep) - cleanStep) < eps;
            const c = major ? cMajor : cMinor;
            verts.push(xmin, y, 0, xmax, y, 0);
            colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }

        const geo = new THREE.BufferGeometry();
        geo.addAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
        geo.addAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
        const mat = new THREE.LineBasicMaterial({ vertexColors: THREE.VertexColors, transparent: true, opacity: 0.8 });
        gridGroup.add(new THREE.LineSegments(geo, mat));

        // X axis zero (red)
        if (ymin <= 0 && ymax >= 0) {
            const g = new THREE.Geometry();
            g.vertices.push(new THREE.Vector3(xmin, 0, 0.1), new THREE.Vector3(xmax, 0, 0.1));
            gridGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xef4444 })));
        }
        // Y axis zero (green)
        if (xmin <= 0 && xmax >= 0) {
            const g = new THREE.Geometry();
            g.vertices.push(new THREE.Vector3(0, ymin, 0.1), new THREE.Vector3(0, ymax, 0.1));
            gridGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x22c55e })));
        }

        // Grid labels (canvas sprites)
        addGridLabels(xmax, ymax, cleanStep);
    }

    function makeLabel(text, x, y) {
        const fs = 22, pad = 5;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(text.length * fs * 0.6 + pad * 2, 40);
        canvas.height = fs + pad * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = (currentTheme === 'dark') ? '#475569' : '#94a3b8';
        ctx.font = `bold ${fs}px "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        const tex = new THREE.Texture(canvas);
        tex.needsUpdate = true;
        tex.minFilter = THREE.LinearFilter;
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sp = new THREE.Sprite(mat);
        const sc = 0.18;
        sp.scale.set(canvas.width * sc, canvas.height * sc, 1);
        sp.position.set(x, y, 0.5);
        return sp;
    }

    function addGridLabels(xmax, ymax, step) {
        const offX = step * 0.6, offY = step * 0.6;
        for (let x = 0; x <= xmax + 0.001; x += step)
            gridGroup.add(makeLabel(String(x), x, -offY));
        for (let y = step; y <= ymax + 0.001; y += step)
            gridGroup.add(makeLabel(String(y), -offX, y));
    }

    // ── Document objects ──────────────────────────────────
    function clearDocument() {
        while (docGroup.children.length) docGroup.remove(docGroup.children[0]);
        while (toolpathGroup.children.length) toolpathGroup.remove(toolpathGroup.children[0]);
        while (gcodeGroup.children.length) gcodeGroup.remove(gcodeGroup.children[0]);
        selectable.length = 0;
        selected.length = 0;
        fireSelectionChange();
    }

    function registerSelectable(obj) {
        obj.traverse(child => {
            if (child instanceof THREE.Line) {
                // Ensure unique material for highlighting
                if (child.material) {
                    child.material = child.material.clone();
                    // Use a fallback grey if no color is set
                    const hex = (child.material.color && typeof child.material.color.getHex === 'function')
                        ? child.material.color.getHex() : 0x888888;

                    if (child.userData._origColor === undefined) {
                        child.userData._origColor = hex;
                    }
                }
                if (!selectable.includes(child)) {
                    selectable.push(child);
                }
            }
        });
    }

    function addDocObject(obj) {
        obj.userData.isDoc = true;
        docGroup.add(obj);
        registerSelectable(obj);
    }

    function addToolpathObject(obj) {
        toolpathGroup.add(obj);
        obj.userData.isToolpath = true;
        registerSelectable(obj);
    }

    function clearToolpaths() {
        // Remove items that belong to the toolpathGroup (clones) from the selectable list
        selectable = selectable.filter(item => {
            if (item.userData && item.userData.camSourceId) return false; // Is a clone
            if (item.userData && item.userData.isToolpath) return false;

            let p = item.parent;
            while (p) {
                if (p === toolpathGroup) return false;
                p = p.parent;
            }
            return true;
        });
        while (toolpathGroup.children.length) toolpathGroup.remove(toolpathGroup.children[0]);
    }

    function setGroupVisibility(name, visible) {
        if (name === 'vectors') docGroup.visible = visible;
        if (name === 'toolpaths') toolpathGroup.visible = visible;
        if (name === 'gcode') gcodeGroup.visible = visible;
    }

    function showGcode(gcode) {
        // Clear previous
        while (gcodeGroup.children.length) gcodeGroup.remove(gcodeGroup.children[0]);

        if (!gcode) return;

        const loader = new THREE.ObjectLoader();
        const worker = new Worker('lib/3dview/workers/litegcodeviewer.js');

        worker.addEventListener('message', function (e) {
            try {
                const json = JSON.parse(e.data);
                const object = loader.parse(json);
                if (object) {
                    object.name = 'gcodeobject';
                    gcodeGroup.add(object);
                    // Force update if needed
                    gcodeGroup.visible = document.getElementById('view-gcode')?.checked !== false;
                }
            } catch (err) {
                console.error('[Web CAM] G-Code back-plot failed:', err);
            } finally {
                worker.terminate();
            }
        });

        worker.postMessage({ 'data': gcode });
    }

    function onMouseMove(e) {
        if (!raycaster) return;
        const rect = renderer.domElement.getBoundingClientRect();
        mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouseVec, camera);

        const hits = raycaster.intersectObjects(selectable, false);
        const oldHovered = hovered;
        if (hits.length > 0) {
            hovered = hits[0].object;
            renderer.domElement.style.cursor = 'pointer';
        } else {
            hovered = null;
            renderer.domElement.style.cursor = '';
        }

        if (oldHovered !== hovered) {
            updateSelectionHighlight();
        }
    }

    // ── Picking ──────────────────────────────────────────
    function onCanvasClick(e) {
        if (!raycaster) return;
        const rect = renderer.domElement.getBoundingClientRect();
        mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        camera.updateProjectionMatrix();
        raycaster.setFromCamera(mouseVec, camera);

        const hits = raycaster.intersectObjects(selectable, false);
        if (hits.length === 0) {
            // Deselect if clicking empty space (no shift)
            if (!e.shiftKey) {
                selected.length = 0;
                updateSelectionHighlight();
                fireSelectionChange();
            }
            return;
        }

        const hit = hits[0].object;

        // Selection Resolution:
        // Clicking a toolpath vector (clone) should technically resolve to the original vector
        // so that the toolpath-manager knows what we are talking about.
        let target = hit;
        if (hit.userData.camSourceId) {
            const source = selectable.find(s => s.uuid === hit.userData.camSourceId);
            if (source) target = source;
        }

        const idx = selected.indexOf(target);
        if (e.shiftKey) {
            // Toggle
            if (idx >= 0) selected.splice(idx, 1);
            else selected.push(target);
        } else {
            selected.length = 0;
            selected.push(target);
        }
        updateSelectionHighlight();
        fireSelectionChange();
    }

    function updateSelectionHighlight() {
        // Collect UUIDs of everything selected to handle synced highlighting
        const selectedUuids = selected.map(s => s.uuid);

        selectable.forEach(obj => {
            if (obj.material) {
                // Highlight if IT is selected, or if its SOURCE is selected, or if it IS the source of something selected
                const isSelected = selected.includes(obj) ||
                    selectedUuids.includes(obj.userData.camSourceId);
                const isHovered = hovered === obj;

                if (isSelected) {
                    obj.material.color.setHex(HIGHLIGHT[currentTheme] || HIGHLIGHT.dark);
                } else if (isHovered) {
                    obj.material.color.setHex(HOVER[currentTheme] || HOVER.dark);
                } else {
                    obj.material.color.setHex(obj.userData._origColor !== undefined ? obj.userData._origColor : 0x64748b);
                }
            }
        });
    }

    function fireSelectionChange() {
        window.dispatchEvent(new CustomEvent('cam-selection-changed', {
            detail: { selected: selected.slice() }
        }));
    }

    function getSelectedPaths() {
        return selected;
    }

    // ── Camera helpers ─────────────────────────────────────
    function resetView() {
        // Fit camera to document bounding box, top-down
        const box = new THREE.Box3();
        docGroup.traverse(o => { if (o.geometry) box.expandByObject(o); });
        if (box.isEmpty()) {
            const x = parseFloat(document.getElementById('job-x')?.value || 200);
            const y = parseFloat(document.getElementById('job-y')?.value || 200);
            box.set(new THREE.Vector3(0, 0, -100), new THREE.Vector3(x, y, 0));
        }
        const cx = (box.min.x + box.max.x) / 2;
        const cy = (box.min.y + box.max.y) / 2;
        const sz = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
        const dist = sz * 1.4;

        controls.target.set(cx, cy, 0);
        camera.position.set(cx, cy, dist);
        camera.up.set(0, 1, 0);
        camera.lookAt(cx, cy, 0);

        if (isOrtho) {
            const aspect = domW / domH;
            const fov = pCamera.fov * (Math.PI / 180);
            const visibleHeight = 2 * Math.tan(fov / 2) * dist;
            oCamera.left = -(visibleHeight * aspect) / 2;
            oCamera.right = (visibleHeight * aspect) / 2;
            oCamera.top = visibleHeight / 2;
            oCamera.bottom = -visibleHeight / 2;
            oCamera.updateProjectionMatrix();
        } else {
            pCamera.updateProjectionMatrix();
        }

        controls.update();
    }

    function toggleOrtho() {
        isOrtho = !isOrtho;

        const oldCamera = camera;
        camera = isOrtho ? oCamera : pCamera;

        // Sync positions
        if (isOrtho) {
            const dist = oldCamera.position.distanceTo(controls.target);
            const aspect = domW / domH;

            // In Ortho, zoom is handled by frustum size, not distance
            // But if we want to roughly mimic Perspective frustum at target:
            const fov = pCamera.fov * (Math.PI / 180);
            const visibleHeight = 2 * Math.tan(fov / 2) * dist;

            oCamera.left = -(visibleHeight * aspect) / 2;
            oCamera.right = (visibleHeight * aspect) / 2;
            oCamera.top = visibleHeight / 2;
            oCamera.bottom = -visibleHeight / 2;

            oCamera.position.copy(oldCamera.position);
            oCamera.up.copy(oldCamera.up);
            oCamera.lookAt(controls.target);
            oCamera.updateProjectionMatrix();

        } else {
            pCamera.position.copy(oldCamera.position);
            pCamera.up.copy(oldCamera.up);
            pCamera.lookAt(controls.target);
            pCamera.updateProjectionMatrix();
        }

        controls.object = camera;
        controls.update();

        if (viewCube) viewCube.updateCamera(camera, controls);

        return isOrtho;
    }

    // ── Animate ───────────────────────────────────────────
    function animate() {
        animId = requestAnimationFrame(animate);
        controls.update();
        if (viewCube) viewCube.animate();
        renderer.render(scene, camera);
    }

    function onResize() {
        if (!container) return;
        domW = container.clientWidth;
        domH = container.clientHeight;
        const aspect = domW / domH;

        pCamera.aspect = aspect;
        pCamera.updateProjectionMatrix();

        // Ortho frustum width needs to rescale to fit aspect ratio, height remains same
        const visibleHeight = oCamera.top - oCamera.bottom;
        oCamera.left = -(visibleHeight * aspect) / 2;
        oCamera.right = (visibleHeight * aspect) / 2;
        oCamera.updateProjectionMatrix();

        renderer.setSize(domW, domH);
    }

    // ── Public API ────────────────────────────────────────
    return {
        init,
        applyTheme,
        drawGrid,
        clearDocument,
        addDocObject,
        addToolpathObject,
        registerSelectable,
        clearToolpaths,
        updateSelectionHighlight,
        resetView,
        toggleOrtho,
        getSelectedPaths,
        setGroupVisibility,
        showGcode,
        get scene() { return scene; },
        get camera() { return camera; },
        get renderer() { return renderer; },
        get controls() { return controls; },
        get toolpathGroup() { return toolpathGroup; },
        get docGroup() { return docGroup; },
        get gcodeGroup() { return gcodeGroup; }
    };

})();
