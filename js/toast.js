// js/toast.js
// Toast Notification System

// Ensure toast container exists
function ensureToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - Duration in milliseconds (default: 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
    const container = ensureToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    // Icon based on type
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };

    toast.innerHTML = `
        <i class="fas ${icons[type] || icons.info}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Auto remove after duration
    setTimeout(() => {
        toast.classList.add('toast-hide');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, duration);

    return toast;
}

let activeDialogResolver = null;

function removeActiveDialog() {
    const existing = document.getElementById('app-dialog-overlay');
    if (existing) existing.remove();
}

function createDialogBase({ title = '', message = '', tone = 'info' } = {}) {
    removeActiveDialog();

    const overlay = document.createElement('div');
    overlay.id = 'app-dialog-overlay';
    overlay.className = 'app-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = `app-dialog app-dialog-${tone}`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleId = `app-dialog-title-${Date.now()}`;
    dialog.setAttribute('aria-labelledby', titleId);

    dialog.innerHTML = `
        <div class="app-dialog-header">
            <h3 id="${titleId}" class="app-dialog-title">${title}</h3>
        </div>
        <div class="app-dialog-body">${message}</div>
        <div class="app-dialog-actions" id="app-dialog-actions"></div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    return { overlay, dialog, actions: dialog.querySelector('#app-dialog-actions') };
}

export function showConfirmModal({
    title = 'אישור פעולה',
    message = '',
    confirmText = 'אישור',
    cancelText = 'ביטול',
    tone = 'warning'
} = {}) {
    return new Promise((resolve) => {
        const { overlay, dialog, actions } = createDialogBase({ title, message, tone });
        let onKeyDown = null;

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'app-dialog-btn app-dialog-btn-secondary';
        cancelBtn.textContent = cancelText;

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'app-dialog-btn app-dialog-btn-primary';
        confirmBtn.textContent = confirmText;

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        const close = (result) => {
            if (!activeDialogResolver) return;
            activeDialogResolver = null;
            if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
            removeActiveDialog();
            resolve(result);
        };

        activeDialogResolver = close;

        confirmBtn.addEventListener('click', () => close(true));
        cancelBtn.addEventListener('click', () => close(false));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(false);
        });

        onKeyDown = (e) => {
            if (!document.getElementById('app-dialog-overlay')) {
                document.removeEventListener('keydown', onKeyDown);
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                close(false);
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                close(true);
            }
        };

        document.addEventListener('keydown', onKeyDown);
        setTimeout(() => confirmBtn.focus(), 0);
    });
}

export function showInfoModal({
    title = 'הודעה',
    message = '',
    buttonText = 'הבנתי',
    tone = 'info'
} = {}) {
    return new Promise((resolve) => {
        const { overlay, actions } = createDialogBase({ title, message, tone });
        let onKeyDown = null;

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'app-dialog-btn app-dialog-btn-primary';
        okBtn.textContent = buttonText;
        actions.appendChild(okBtn);

        const close = () => {
            if (!activeDialogResolver) return;
            activeDialogResolver = null;
            if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
            removeActiveDialog();
            resolve();
        };

        activeDialogResolver = close;

        okBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        onKeyDown = (e) => {
            if (!document.getElementById('app-dialog-overlay')) {
                document.removeEventListener('keydown', onKeyDown);
                return;
            }

            if (e.key === 'Escape' || e.key === 'Enter') {
                e.preventDefault();
                close();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        setTimeout(() => okBtn.focus(), 0);
    });
}

export function showThreeOptionModal({
    title = 'אישור פעולה',
    message = '',
    confirmText = 'אישור',
    alternateText = 'המשך ללא שמירה',
    cancelText = 'ביטול',
    tone = 'warning'
} = {}) {
    return new Promise((resolve) => {
        const { overlay, actions } = createDialogBase({ title, message, tone });
        let onKeyDown = null;

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'app-dialog-btn app-dialog-btn-secondary';
        cancelBtn.textContent = cancelText;

        const alternateBtn = document.createElement('button');
        alternateBtn.type = 'button';
        alternateBtn.className = 'app-dialog-btn app-dialog-btn-secondary';
        alternateBtn.textContent = alternateText;

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'app-dialog-btn app-dialog-btn-primary';
        confirmBtn.textContent = confirmText;

        actions.appendChild(cancelBtn);
        actions.appendChild(alternateBtn);
        actions.appendChild(confirmBtn);

        const close = (result) => {
            if (!activeDialogResolver) return;
            activeDialogResolver = null;
            if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
            removeActiveDialog();
            resolve(result);
        };

        activeDialogResolver = close;

        confirmBtn.addEventListener('click', () => close('confirm'));
        alternateBtn.addEventListener('click', () => close('alternate'));
        cancelBtn.addEventListener('click', () => close('cancel'));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close('cancel');
        });

        onKeyDown = (e) => {
            if (!document.getElementById('app-dialog-overlay')) {
                document.removeEventListener('keydown', onKeyDown);
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                close('cancel');
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                close('confirm');
            }
        };

        document.addEventListener('keydown', onKeyDown);
        setTimeout(() => confirmBtn.focus(), 0);
    });
}

/**
 * Start a countdown on a button with localStorage persistence
 * @param {HTMLButtonElement} button - The button element
 * @param {number} seconds - Countdown duration in seconds
 * @param {string} originalText - The original button text
 * @param {string} storageKey - Key for localStorage (default: 'countdownEndTime')
 */
export function startButtonCountdown(button, seconds, originalText, storageKey = 'countdownEndTime') {
    // Calculate end time and save to localStorage
    const endTime = Date.now() + (seconds * 1000);
    localStorage.setItem(storageKey, endTime.toString());

    runCountdown(button, endTime, originalText, storageKey);
}

/**
 * Resume countdown from localStorage if exists
 * @param {HTMLButtonElement} button - The button element
 * @param {string} originalText - The original button text
 * @param {string} storageKey - Key for localStorage (default: 'countdownEndTime')
 */
export function resumeCountdownIfNeeded(button, originalText, storageKey = 'countdownEndTime') {
    const savedEndTime = localStorage.getItem(storageKey);
    if (savedEndTime) {
        const endTime = parseInt(savedEndTime);
        const remaining = Math.ceil((endTime - Date.now()) / 1000);

        if (remaining > 0) {
            runCountdown(button, endTime, originalText, storageKey);
            return true;
        } else {
            // Countdown finished while away, clear storage
            localStorage.removeItem(storageKey);
        }
    }
    return false;
}

/**
 * Internal function to run the countdown
 */
function runCountdown(button, endTime, originalText, storageKey) {
    button.disabled = true;
    button.classList.add('btn-countdown');

    const updateText = () => {
        const remaining = Math.ceil((endTime - Date.now()) / 1000);
        if (remaining <= 0) return false;

        const minutes = Math.floor(remaining / 60);
        const secs = remaining % 60;
        const timeStr = minutes > 0
            ? `${minutes}:${secs.toString().padStart(2, '0')}`
            : `${secs}`;
        button.innerHTML = `<span class="countdown-text">יש להמתין עד לניסיון הבא ${timeStr}</span>`;
        return true;
    };

    updateText();

    const interval = setInterval(() => {
        if (!updateText()) {
            clearInterval(interval);
            localStorage.removeItem(storageKey);
            button.disabled = false;
            button.classList.remove('btn-countdown');
            button.textContent = originalText;
        }
    }, 1000);

    return interval;
}

