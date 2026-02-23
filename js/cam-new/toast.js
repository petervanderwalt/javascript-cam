// toast.js — lightweight replacement for Metro.toast
window.toast = {
    _container: null,
    _get() {
        if (!this._container) this._container = document.getElementById('toast-container');
        return this._container;
    },
    show(msg, type = 'info', duration = 2500) {
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const icons = { info: 'bi-info-circle', success: 'bi-check-circle', error: 'bi-x-circle' };
        el.innerHTML = `<i class="bi ${icons[type] || 'bi-info-circle'}"></i><span>${msg}</span>`;
        this._get().appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(() => el.remove(), 350);
        }, duration);
    },
    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error', 4000); },
    info(msg) { this.show(msg, 'info'); }
};
