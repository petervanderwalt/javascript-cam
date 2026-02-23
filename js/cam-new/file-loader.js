// file-loader.js — SVG and DXF → THREE.Group → cam3d scene
// Wires the existing lw.svg-parser + dxf-parser/three-dxf stacks.

window.fileLoader = (function () {

    // ── Globals the old parsers rely on ──────────────────
    // We stub the ones we need and capture the result.
    var _capturedGroup = null;

    function _stubGlobals() {
        // svgparser.js pushes to objectsInScene and calls fillTree().
        // We intercept by temporarily replacing those globals.
        if (!window._objectsInScene_orig) {
            window._objectsInScene_orig = window.objectsInScene;
            window._fillTree_orig = window.fillTree;
        }
        window.objectsInScene = [];
        window.fillTree = function () {
            if (window.objectsInScene.length) {
                _capturedGroup = window.objectsInScene[window.objectsInScene.length - 1];
            }
        };
        // dxf-render calls viewExtents() — stub it
        window._viewExtents_orig = window.viewExtents;
        window.viewExtents = function () { };
        // Metro.toast — may not exist in new UI
        if (!window.Metro) window.Metro = { toast: { create: (m) => toast.info(m) } };
    }

    function _restoreGlobals() {
        if (window._objectsInScene_orig !== undefined)
            window.objectsInScene = window._objectsInScene_orig;
        if (window._fillTree_orig !== undefined)
            window.fillTree = window._fillTree_orig;
        if (window._viewExtents_orig !== undefined)
            window.viewExtents = window._viewExtents_orig;
    }

    // ── Geometry helpers ─────────────────────────────────
    function normaliseGroup(group) {
        // Compute bounding box and shift geometry so min.x=0, min.y=0
        var box = new THREE.Box3().setFromObject(group);
        if (box.isEmpty()) return group;
        var ox = box.min.x, oy = box.min.y;
        group.traverse(function (child) {
            if (child.geometry && child.geometry.vertices) {
                child.geometry.vertices.forEach(function (v) {
                    v.x -= ox; v.y -= oy;
                });
                child.geometry.verticesNeedUpdate = true;
            }
        });
        return group;
    }

    function markSelectable(group) {
        // Give every Line child an original colour for pick-highlight reset
        group.traverse(function (child) {
            if (child instanceof THREE.Line && child.material && child.material.color) {
                child.userData._origColor = child.material.color.getHex();
            }
        });
        return group;
    }

    // ── SVG loading ───────────────────────────────────────
    function loadSVG(text, filename) {
        _stubGlobals();
        _capturedGroup = null;

        // lw.svg-parser needs a File-like object; we fake a Blob URL or use
        // the loadFromString path if the parser supports it.
        var parser = new SVGParser.Parser();
        return parser.loadFromString(text)
            .then(function () { return parser.parse(); })
            .then(function (tags) {
                // drawFile() in svgparser.js will call fillTree → captured
                drawFile(filename, tags, false);
                _restoreGlobals();
                return _capturedGroup;
            })
            .catch(function (err) {
                _restoreGlobals();
                throw err;
            });
    }

    // ── DXF loading ───────────────────────────────────────
    function loadDXF(text, filename) {
        _stubGlobals();
        _capturedGroup = null;

        try {
            // drawDXF is in dxf-render.js — it also needs these globals:
            window.yflip = false;
            window.resol = 96;
            window.scale = 1;
            window.row = []; window.pwr = []; window.cutSpeed = [];

            drawDXF(text, filename);
            var grp = window.objectsInScene[window.objectsInScene.length - 1] || _capturedGroup;
            _restoreGlobals();

            return Promise.resolve(grp);
        } catch (err) {
            _restoreGlobals();
            return Promise.reject(err);
        }
    }

    // ── Core load dispatcher ──────────────────────────────
    function load(file) {
        var ext = file.name.split('.').pop().toLowerCase();
        if (!['svg', 'dxf'].includes(ext)) {
            toast.error('Unsupported file type: .' + ext);
            return;
        }

        toast.info('Loading ' + file.name + '…');
        setStatus('Loading ' + file.name + '…');

        var reader = new FileReader();
        reader.onload = function (e) {
            var text = e.target.result;
            var promise = (ext === 'svg') ? loadSVG(text, file.name)
                : loadDXF(text, file.name);

            promise.then(function (group) {
                if (!group || !group.children || group.children.length === 0) {
                    toast.error('No geometry found in ' + file.name);
                    return;
                }

                normaliseGroup(group);
                markSelectable(group);

                cam3d.clearDocument();
                cam3d.addDocObject(group);

                // Fit grid to file extents
                var box = new THREE.Box3().setFromObject(group);
                var gx = Math.ceil(box.max.x) + 20;
                var gy = Math.ceil(box.max.y) + 20;
                document.getElementById('job-x').value = gx;
                document.getElementById('job-y').value = gy;
                cam3d.drawGrid(gx, gy);
                cam3d.resetView();

                showFileInfo(file.name);
                toast.success(file.name + ' loaded');
                setStatus(file.name + ' — click vectors to select, then Add Toolpath');
                document.getElementById('btn-add-tp').disabled = false;

            }).catch(function (err) {
                console.error(err);
                toast.error('Error loading ' + file.name + ': ' + (err.message || err));
                setStatus('Load failed — check console');
            });
        };
        reader.readAsText(file);
    }

    // ── UI helpers ────────────────────────────────────────
    function showFileInfo(name) {
        document.getElementById('file-name').textContent = name;
        document.getElementById('file-info').style.display = '';
    }

    function setStatus(msg) {
        var el = document.getElementById('viewport-status');
        if (el) el.textContent = msg;
    }

    // ── Init ──────────────────────────────────────────────
    function init() {
        var dropZone = document.getElementById('drop-zone');
        var fileInput = document.getElementById('file-input');
        var openBtn = document.getElementById('btn-open-file');

        openBtn.addEventListener('click', function () { fileInput.click(); });
        dropZone.addEventListener('click', function () { fileInput.click(); });

        fileInput.addEventListener('change', function (e) {
            if (e.target.files[0]) load(e.target.files[0]);
            fileInput.value = '';
        });

        ['dragover', 'dragenter'].forEach(function (ev) {
            dropZone.addEventListener(ev, function (e) {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });
        });
        dropZone.addEventListener('dragleave', function () {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', function (e) {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
        });

        // Also catch drops on the viewport
        var vp = document.getElementById('viewport');
        vp.addEventListener('dragover', function (e) { e.preventDefault(); });
        vp.addEventListener('drop', function (e) {
            e.preventDefault();
            if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
        });
    }

    return { init, load };
})();
