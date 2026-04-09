import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Accessibility focus trap for modal dialogs.
 * - Moves focus into the dialog when it opens
 * - Traps Tab / Shift+Tab within the dialog
 * - Closes the dialog on Escape
 * - Restores focus to the previously focused element when closed
 */
export function useFocusTrap(isOpen: boolean, onClose?: () => void) {
    const ref = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<Element | null>(null);

    // Save previous focus & move focus into dialog on open; restore on close
    useEffect(() => {
        if (!isOpen) return;

        previousFocusRef.current = document.activeElement;

        // Small delay so the dialog is fully rendered before focusing
        const timer = setTimeout(() => {
            const focusable = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
            focusable?.[0]?.focus();
        }, 50);

        return () => {
            clearTimeout(timer);
            if (previousFocusRef.current instanceof HTMLElement) {
                previousFocusRef.current.focus();
            }
        };
    }, [isOpen]);

    // Trap Tab and handle Escape
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose?.();
                return;
            }

            if (e.key !== 'Tab') return;

            const el = ref.current;
            if (!el) return;

            const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    return ref;
}
