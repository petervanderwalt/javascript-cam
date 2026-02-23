// sidebar.js — toolpath list + settings panel management
window.sidebar = (function () {

    function init() {
        // Collapsible cards
        document.querySelectorAll('[data-collapse]').forEach(header => {
            header.addEventListener('click', () => {
                const card = header.closest('.card');
                card.classList.toggle('collapsed');
            });
        });

        // Workspace Reset
        const btnNew = document.getElementById('btn-new-job');
        if (btnNew) btnNew.addEventListener('click', () => workspace.reset());

        // Add toolpath
        document.getElementById('btn-add-tp').addEventListener('click', () => {
            const sel = cam3d.getSelectedPaths();
            toolpathManager.addFromSelection(sel);
        });

        document.getElementById('btn-add-to-tp').addEventListener('click', () => {
            const tp = toolpathManager.getActive();
            if (!tp) return;
            const sel = cam3d.getSelectedPaths();
            const btn = document.getElementById('btn-add-to-tp');
            if (btn.dataset.action === 'remove') {
                toolpathManager.removeFromToolpath(tp.id, sel);
            } else {
                toolpathManager.addToToolpath(tp.id, sel);
            }
        });

        // Preview
        document.getElementById('btn-preview-tp').addEventListener('click', () => {
            const tp = toolpathManager.getActive();
            if (!tp) return;
            _applySettingsToActive();
            toolpathManager.preview(tp.id);
        });

        // Delete
        document.getElementById('btn-delete-tp').addEventListener('click', () => {
            const tp = toolpathManager.getActive();
            if (tp) toolpathManager.deleteToolpath(tp.id);
        });

        // Tabs toggle
        document.getElementById('tp-tabs-enabled').addEventListener('change', e => {
            document.getElementById('tp-tabs-fields').style.display = e.target.checked ? '' : 'none';
        });

        // Place Tabs button — enter tab mode
        document.getElementById('btn-place-tabs').addEventListener('click', () => {
            _applySettingsToActive();
            const tp = toolpathManager.getActive();
            if (!tp) return;
            if (tabSystem.isActive()) { tabSystem.exit(); }
            else { tabSystem.enter(tp.id); }
        });

        // Clear All Tabs
        document.getElementById('btn-clear-tabs').addEventListener('click', () => {
            tabSystem.clearAll();
            toast.info('All tabs cleared');
        });

        // Job size → refresh grid
        ['job-x', 'job-y'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                const x = parseFloat(document.getElementById('job-x').value) || 200;
                const y = parseFloat(document.getElementById('job-y').value) || 200;
                cam3d.drawGrid(x, y);
            });
        });

        // View toggles
        document.getElementById('view-vectors').addEventListener('change', e => {
            cam3d.setGroupVisibility('vectors', e.target.checked);
        });
        document.getElementById('view-toolpaths').addEventListener('change', e => {
            cam3d.setGroupVisibility('toolpaths', e.target.checked);
        });
        document.getElementById('view-gcode').addEventListener('change', e => {
            cam3d.setGroupVisibility('gcode', e.target.checked);
        });

        // Generate G-code
        document.getElementById('btn-generate').addEventListener('click', () => {
            if (toolpathManager.areWorkersBusy()) {
                toast.info('Workers still running — please wait');
                return;
            }
            const safeZ = parseFloat(document.getElementById('job-safez').value) || 5;
            const bar = document.getElementById('gcode-progress');
            document.getElementById('card-gcode').style.display = '';

            toolpathManager.generateGcode(
                safeZ,
                pct => { bar.style.width = pct + '%'; },
                gcode => {
                    bar.style.width = '100%';
                    document.getElementById('gcode-output').value = gcode;
                    document.getElementById('btn-save-nc').disabled = false;
                    document.getElementById('btn-save-gcode').disabled = false;
                    toast.success('G-Code generated!');
                    window._lastGcode = gcode;
                    cam3d.showGcode(gcode);
                }
            );
        });

        // Save .nc
        ['btn-save-nc', 'btn-save-gcode'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', saveGcode);
        });

        // Copy G-code
        document.getElementById('btn-copy-gcode').addEventListener('click', () => {
            const gc = document.getElementById('gcode-output').value;
            navigator.clipboard.writeText(gc).then(() => toast.success('Copied!'));
        });

        document.getElementById('btn-view-reset').addEventListener('click', () => cam3d.resetView());
        document.getElementById('btn-view-ortho').addEventListener('click', () => {
            const isOrtho = cam3d.toggleOrtho();
            const icon = document.getElementById('icon-cam-type');
            if (isOrtho) {
                icon.classList.remove('bi-box-fill');
                icon.classList.add('bi-square-fill'); // visual difference
            } else {
                icon.classList.remove('bi-square-fill');
                icon.classList.add('bi-box-fill');
            }
        });

        // Selection → enable Add button
        window.addEventListener('cam-selection-changed', e => {
            const btn = document.getElementById('btn-add-tp');
            const btnAddTo = document.getElementById('btn-add-to-tp');
            const hasSelection = e.detail.selected.length > 0;
            const activeTp = toolpathManager.getActive();

            btn.disabled = !hasSelection;

            if (hasSelection && activeTp) {
                btnAddTo.disabled = false;
                const status = toolpathManager.getSelectionStatus(activeTp.id, e.detail.selected);
                if (status === 'all_existing') {
                    btnAddTo.innerHTML = '<i class="bi bi-dash-circle"></i> Remove Selection from Toolpath';
                    btnAddTo.dataset.action = 'remove';
                    btnAddTo.classList.remove('btn-action');
                    btnAddTo.classList.add('btn-ghost');
                    btnAddTo.style.color = 'var(--color-secondary)'; // Subtle orange/red
                } else {
                    btnAddTo.innerHTML = '<i class="bi bi-plus-circle-dotted"></i> Add Selection to this Toolpath';
                    btnAddTo.dataset.action = 'add';
                    btnAddTo.classList.remove('btn-ghost');
                    btnAddTo.classList.add('btn-action');
                    btnAddTo.style.color = '';
                }
            } else {
                btnAddTo.disabled = true;
                btnAddTo.classList.remove('btn-action');
                btnAddTo.classList.add('btn-ghost');
                btnAddTo.style.color = '';
            }

            if (hasSelection) {
                btn.classList.remove('btn-ghost');
                btn.classList.add('btn-action');
            } else {
                btn.classList.remove('btn-action');
                btn.classList.add('btn-ghost');
            }
        });

        // Units
        document.getElementById('unit-toggle').addEventListener('change', e => {
            const unit = e.target.checked ? 'mm' : 'inch';
            localStorage.setItem('cam.units', unit);
        });
    }

    function refreshToolpathList() {
        const list = document.getElementById('tp-list');
        const tps = toolpathManager.getAll();
        const count = document.getElementById('tp-count');
        count.textContent = tps.length;

        if (tps.length === 0) {
            list.innerHTML = `
            <div style="text-align:center;padding:20px;color:var(--color-text-muted);font-size:11px;">
                <i class="bi bi-cursor" style="font-size:20px;display:block;margin-bottom:6px;"></i>
                Click vectors in the viewport<br>to create toolpaths
            </div>`;
            return;
        }

        list.innerHTML = '';
        tps.forEach(tp => {
            const active = toolpathManager.getActive()?.id === tp.id;
            const dot = tp.color || 0x3b82f6;
            const dotCss = '#' + dot.toString(16).padStart(6, '0');
            const ud = tp.group ? tp.group.userData : {};
            const item = document.createElement('div');
            item.className = `tp-item${active ? ' active' : ''}`;
            item.dataset.id = tp.id;
            item.innerHTML = `
                <span class="tp-color-dot" style="background:${dotCss};"></span>
                <span class="tp-name">${tp.name}</span>
                <span class="tp-op-tag">${ud.camOperation ? ud.camOperation.replace('CNC: ', '').replace(' (path ', ' (') : '?'}</span>
                <span class="tp-spinner" id="tp-spin-${tp.id}" style="display:none;">
                    <i class="bi bi-arrow-repeat" style="animation:spin 1s linear infinite;font-size:11px;"></i>
                </span>
            `;
            item.addEventListener('click', () => {
                toolpathManager.setActive(tp.id);
                refreshToolpathList();
                showSettings(tp.id);
            });
            list.appendChild(item);
        });
    }

    function showSettings(id) {
        const tp = toolpathManager.getById(id);
        if (!tp) return;
        // Data lives on tp.group.userData
        const ud = (tp.group && tp.group.userData) || {};
        const panel = document.getElementById('card-tp-settings');
        panel.style.display = '';
        document.getElementById('tp-settings-name').textContent = tp.name;

        // Map worker operation string back to friendly label for the select
        const opRev = {
            'CNC: Vector (path outside)': 'Outside',
            'CNC: Vector (path inside)': 'Inside',
            'CNC: Pocket': 'Pocket',
            'CNC: Vector (no offset)': 'Engrave',
            'Drill: Peck (Centered)': 'Drill'
        };
        document.getElementById('tp-operation').value = opRev[ud.camOperation] || 'Outside';
        document.getElementById('tp-tooldia').value = ud.camToolDia || 3.175;
        document.getElementById('tp-passdepth').value = ud.camZStep || 3;
        document.getElementById('tp-depth').value = ud.camZDepth || 18;
        document.getElementById('tp-stepover').value = (ud.camStepover || 0.4) * 100;
        document.getElementById('tp-offset').value = ud.camOffset || 0;
        document.getElementById('tp-feed').value = ud.camFeed || 800;
        document.getElementById('tp-plunge').value = ud.camPlunge || 400;
        document.getElementById('tp-spindle').value = ud.camSpindle || 18000;
        const hasTabs = (ud.camTabWidth || 0) > 0;
        document.getElementById('tp-tabs-enabled').checked = hasTabs;
        document.getElementById('tp-tabs-fields').style.display = hasTabs ? '' : 'none';
        document.getElementById('tp-tab-width').value = ud.camTabWidth || 6;
        document.getElementById('tp-tab-depth').value = ud.camTabDepth || 3;
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function hideSettings() {
        document.getElementById('card-tp-settings').style.display = 'none';
    }

    function setSpinner(id, visible) {
        const el = document.getElementById(`tp-spin-${id}`);
        if (el) el.style.display = visible ? '' : 'none';
    }

    function _applySettingsToActive() {
        const tp = toolpathManager.getActive();
        if (!tp) return;
        const hasTabs = document.getElementById('tp-tabs-enabled').checked;
        const existingLocs = (tp.group && tp.group.userData.camTabLocations) || [];
        toolpathManager.updateSettings(tp.id, {
            operation: document.getElementById('tp-operation').value,
            toolDia: parseFloat(document.getElementById('tp-tooldia').value),
            depth: parseFloat(document.getElementById('tp-depth').value),
            passDepth: parseFloat(document.getElementById('tp-passdepth').value),
            stepover: parseFloat(document.getElementById('tp-stepover').value) / 100,
            offset: parseFloat(document.getElementById('tp-offset').value),
            feed: parseFloat(document.getElementById('tp-feed').value),
            plunge: parseFloat(document.getElementById('tp-plunge').value),
            spindle: parseFloat(document.getElementById('tp-spindle').value),
            tabWidth: hasTabs ? parseFloat(document.getElementById('tp-tab-width').value) : 0,
            tabDepth: hasTabs ? parseFloat(document.getElementById('tp-tab-depth').value) : 0,
            tabLocs: existingLocs   // preserve placed tabs
        });
    }

    function saveGcode() {
        const gc = window._lastGcode;
        if (!gc) { toast.error('Generate G-Code first'); return; }
        const blob = new Blob([gc], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'job.nc';
        a.click();
        URL.revokeObjectURL(url);
    }

    // Spinner keyframe
    const style = document.createElement('style');
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);

    return { init, refreshToolpathList, showSettings, hideSettings, setSpinner };
})();
