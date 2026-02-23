// tabs.js — Tab placement for the new CAM UI
// Ported from advanced-cam-tabs.js but adapted for the new module architecture.
// Dependencies: cam3d (for scene/camera/renderer), toolpathManager

window.tabSystem = (function () {

    var _active = false;
    var _tpId = null;
    var _markerGrp = null;
    var _ghostMesh = null;
    var _hitInfo = null;   // {x, y, angle}

    var TAB_COLOR = 0x30797f;  // primary teal — matches theme
    var GHOST_COLOR = 0x94a3b8;  // muted slate

    // ── Sphere marker ─────────────────────────────────────
    function _makeSphere(x, y, color, opacity) {
        var geo = new THREE.SphereGeometry(3, 12, 8);
        var mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, 2);
        return mesh;
    }

    // ── Enter / Exit ──────────────────────────────────────
    function enter(tpId) {
        var entry = toolpathManager.getById(tpId);
        if (!entry) { toast.error('Select a toolpath first'); return; }
        if (!entry.previewObj && !entry.group) { toast.error('Preview the toolpath first'); return; }

        _tpId = tpId;
        _active = true;

        // Create/clear marker group in the 3D scene
        if (!_markerGrp) {
            _markerGrp = new THREE.Group();
            _markerGrp.name = 'TabMarkers';
            cam3d.scene.add(_markerGrp);
        }
        _rebuildMarkers();

        // Bind events
        var el = cam3d.renderer.domElement;
        el.addEventListener('mousemove', _onHover);
        el.addEventListener('click', _onClick);
        document.addEventListener('keydown', _onKey);

        // Cursor hint
        setStatus('Tab mode: hover vector → click to place | Click sphere to remove | Esc to exit');
        toast.info('Tab placement active for ' + entry.name);
    }

    function exit() {
        if (!_active) return;
        _active = false;
        _removeGhost();

        var el = cam3d.renderer.domElement;
        el.removeEventListener('mousemove', _onHover);
        el.removeEventListener('click', _onClick);
        document.removeEventListener('keydown', _onKey);

        setStatus('');
        toast.info('Tab placement done');

        // Fire sidebar refresh so tab count updates
        sidebar.refreshToolpathList();
    }

    function isActive() { return _active; }

    // ── Hover ─────────────────────────────────────────────
    function _onHover(evt) {
        _hitInfo = null;
        _removeGhost();

        var wp = _raycastXYPlane(evt);
        if (!wp) return;

        var tp = toolpathManager.getById(_tpId);
        var src = tp.previewObj || tp.group;
        var best = _findNearestSegment(src, wp.x, wp.y);
        if (!best) return;

        _hitInfo = best;
        _ghost = _makeSphere(best.x, best.y, GHOST_COLOR, 0.55);
        _ghostMesh = _ghost;
        cam3d.scene.add(_ghostMesh);
    }

    // ── Click ─────────────────────────────────────────────
    function _onClick(evt) {
        if (!_active) return;

        var wp = _raycastXYPlane(evt);
        if (!wp) return;

        // First check hit on existing marker spheres (remove)
        var ray = _makeRay(evt);
        var hits = ray.intersectObjects(_markerGrp ? _markerGrp.children : [], true);
        if (hits.length > 0) {
            var obj = hits[0].object;
            while (obj && obj !== _markerGrp) {
                if (obj.userData.isTabMarker) {
                    _removeTab(obj.userData.tabIndex);
                    return;
                }
                obj = obj.parent;
            }
        }

        // Place new tab at snap position
        if (_hitInfo) {
            _placeTab(_hitInfo.x, _hitInfo.y, _hitInfo.angle);
        }
    }

    function _onKey(evt) {
        if (evt.key === 'Escape') exit();
    }

    // ── Tab data ──────────────────────────────────────────
    function _getTabLocs() {
        var tp = toolpathManager.getById(_tpId);
        return tp ? (tp.group.userData.camTabLocations || []) : [];
    }

    function _setTabLocs(locs) {
        var tp = toolpathManager.getById(_tpId);
        if (tp) tp.group.userData.camTabLocations = locs;
    }

    function _placeTab(x, y, angle) {
        var locs = _getTabLocs();
        // Deduplicate within 2mm
        for (var i = 0; i < locs.length; i++) {
            var dx = locs[i].x - x, dy = locs[i].y - y;
            if (Math.sqrt(dx * dx + dy * dy) < 2) return;
        }
        locs.push({ x: parseFloat(x.toFixed(4)), y: parseFloat(y.toFixed(4)), a: angle || 0 });
        _setTabLocs(locs);
        _rebuildMarkers();
        toast.success('Tab at (' + x.toFixed(1) + ', ' + y.toFixed(1) + ')');
    }

    function _removeTab(idx) {
        var locs = _getTabLocs();
        locs.splice(idx, 1);
        _setTabLocs(locs);
        _rebuildMarkers();
        toast.info('Tab removed');
    }

    function clearAll() {
        _setTabLocs([]);
        _rebuildMarkers();
    }

    // ── Markers ───────────────────────────────────────────
    function _rebuildMarkers() {
        if (!_markerGrp) return;
        while (_markerGrp.children.length) {
            var c = _markerGrp.children[0];
            c.traverse(function (o) {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
            _markerGrp.remove(c);
        }

        var locs = _getTabLocs();
        locs.forEach(function (loc, idx) {
            var m = _makeSphere(loc.x, loc.y, TAB_COLOR, 0.9);
            m.userData.isTabMarker = true;
            m.userData.tabIndex = idx;
            m.name = 'TabMarker_' + idx;
            _markerGrp.add(m);
        });
    }

    function _removeGhost() {
        if (_ghostMesh) {
            cam3d.scene.remove(_ghostMesh);
            if (_ghostMesh.geometry) _ghostMesh.geometry.dispose();
            if (_ghostMesh.material) _ghostMesh.material.dispose();
            _ghostMesh = null;
        }
    }

    // ── Geometry helpers ──────────────────────────────────
    function _raycastXYPlane(evt) {
        var el = cam3d.renderer.domElement;
        var rect = el.getBoundingClientRect();
        var mv = new THREE.Vector2(
            ((evt.clientX - rect.left) / rect.width) * 2 - 1,
            -((evt.clientY - rect.top) / rect.height) * 2 + 1
        );
        var ray = new THREE.Raycaster();
        ray.setFromCamera(mv, cam3d.camera);
        var dir = ray.ray.direction.clone().normalize();
        var origin = ray.ray.origin.clone();
        if (Math.abs(dir.z) < 1e-6) return null;
        var t = -origin.z / dir.z;
        if (t < 0) return null;
        return { x: origin.x + t * dir.x, y: origin.y + t * dir.y };
    }

    function _makeRay(evt) {
        var el = cam3d.renderer.domElement;
        var rect = el.getBoundingClientRect();
        var mv = new THREE.Vector2(
            ((evt.clientX - rect.left) / rect.width) * 2 - 1,
            -((evt.clientY - rect.top) / rect.height) * 2 + 1
        );
        var ray = new THREE.Raycaster();
        ray.setFromCamera(mv, cam3d.camera);
        return ray;
    }

    function _snapRadius() {
        // Return a stable snap radius in scene units (mm)
        if (cam3d && cam3d.camera) {
            // scale snap distance loosely by camera distance
            return Math.abs(cam3d.camera.position.z) * 0.02;
        }
        return 3;
    }

    function _findNearestSegment(obj3d, px, py) {
        var best = { dist: Infinity, x: 0, y: 0, angle: 0 };
        var snap = _snapRadius();

        obj3d.traverse(function (child) {
            if (child.type !== 'Line') return;
            var verts = child.geometry && child.geometry.vertices;
            if (!verts || verts.length < 2) return;

            for (var i = 0; i < verts.length - 1; i++) {
                var wA = child.localToWorld(verts[i].clone());
                var wB = child.localToWorld(verts[i + 1].clone());
                var abx = wB.x - wA.x, aby = wB.y - wA.y;
                var len2 = abx * abx + aby * aby;
                if (len2 < 1e-10) continue;
                var t = Math.max(0, Math.min(1, ((px - wA.x) * abx + (py - wA.y) * aby) / len2));
                var nx = wA.x + t * abx, ny = wA.y + t * aby;
                var d = Math.hypot(nx - px, ny - py);
                if (d < best.dist && d < snap) {
                    best = { dist: d, x: nx, y: ny, angle: Math.atan2(aby, abx) };
                }
            }
        });

        return best.dist < snap ? best : null;
    }

    function setStatus(msg) {
        var el = document.getElementById('viewport-status');
        if (el) el.textContent = msg || 'Ready';
    }

    return { enter, exit, isActive, clearAll };
})();
