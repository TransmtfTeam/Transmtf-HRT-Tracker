import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface CustomSelectProps {
    value: string;
    onChange: (val: string) => void;
    options: { value: string; label: string; icon?: React.ReactNode }[];
    label?: string;
    compactOnMobile?: boolean;
}

const CustomSelect = ({ value, onChange, options, label, compactOnMobile = false }: CustomSelectProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const listboxRef = useRef<HTMLDivElement>(null);
    // Stable unique ID for ARIA relationships
    const idRef = useRef(`cs-${Math.random().toString(36).slice(2, 8)}`);
    const listboxId = `${idRef.current}-listbox`;
    const labelId = label ? `${idRef.current}-label` : undefined;

    const selectedIndex = options.findIndex(o => o.value === value);
    const selectedOption = options[selectedIndex];

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Move DOM focus to the focused option whenever focusedIndex changes while open
    useEffect(() => {
        if (!isOpen || !listboxRef.current) return;
        const items = listboxRef.current.querySelectorAll<HTMLElement>('[role="option"]');
        items[focusedIndex]?.focus();
    }, [isOpen, focusedIndex]);

    const openList = (initialIndex?: number) => {
        const idx = initialIndex ?? (selectedIndex >= 0 ? selectedIndex : 0);
        setFocusedIndex(idx);
        setIsOpen(true);
    };

    const closeList = () => {
        setIsOpen(false);
        buttonRef.current?.focus();
    };

    const selectOption = (val: string) => {
        onChange(val);
        closeList();
    };

    const handleButtonKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'Enter':
            case ' ':
            case 'ArrowDown':
                e.preventDefault();
                openList();
                break;
            case 'ArrowUp':
                e.preventDefault();
                openList(options.length - 1);
                break;
        }
    };

    const handleOptionKeyDown = (e: React.KeyboardEvent, index: number) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedIndex(Math.min(index + 1, options.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedIndex(Math.max(index - 1, 0));
                break;
            case 'Home':
                e.preventDefault();
                setFocusedIndex(0);
                break;
            case 'End':
                e.preventDefault();
                setFocusedIndex(options.length - 1);
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                selectOption(options[index].value);
                break;
            case 'Escape':
            case 'Tab':
                e.preventDefault();
                closeList();
                break;
        }
    };

    return (
        <div className={`min-w-0 ${compactOnMobile ? 'space-y-1 sm:space-y-2' : 'space-y-2'}`} ref={containerRef}>
            {label && (
                <label id={labelId} className={`block font-bold ${compactOnMobile ? 'text-xs sm:text-sm' : 'text-sm'}`} style={{ color: 'var(--text-secondary)' }}>
                    {label}
                </label>
            )}
            <div className="relative">
                <button
                    ref={buttonRef}
                    type="button"
                    role="combobox"
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                    aria-controls={listboxId}
                    aria-labelledby={labelId}
                    onClick={() => isOpen ? closeList() : openList()}
                    onKeyDown={handleButtonKeyDown}
                    className={`w-full min-w-0 rounded-xl outline-none flex items-center justify-between transition-all glass-input ${compactOnMobile ? 'p-3 sm:p-4' : 'p-4'}`}
                    onFocus={e => e.currentTarget.style.boxShadow = '0 0 0 2px var(--glass-input-focus-ring)'}
                    onBlur={e => e.currentTarget.style.boxShadow = 'none'}
                >
                    <div className="flex min-w-0 items-center gap-2">
                        {selectedOption?.icon}
                        <span
                            className="min-w-0 truncate font-medium"
                            title={selectedOption?.label || value}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {selectedOption?.label || value}
                        </span>
                    </div>
                    <ChevronDown size={20} className={`ml-2 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--text-tertiary)' }} />
                </button>

                {isOpen && (
                    <div
                        ref={listboxRef}
                        id={listboxId}
                        role="listbox"
                        aria-labelledby={labelId}
                        className="absolute top-full left-0 right-0 mt-2 rounded-xl z-50 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100 glass-heavy glass-noise"
                    >
                        {options.map((opt, index) => (
                            <div
                                key={opt.value}
                                role="option"
                                aria-selected={opt.value === value}
                                tabIndex={focusedIndex === index ? 0 : -1}
                                onClick={() => selectOption(opt.value)}
                                onKeyDown={(e) => handleOptionKeyDown(e, index)}
                                onMouseEnter={() => setFocusedIndex(index)}
                                className={`w-full p-3 text-left flex items-center gap-2 cursor-pointer transition-colors outline-none
                                    focus:ring-2 focus:ring-inset
                                    ${opt.value === value ? 'font-bold' : 'hover:bg-[var(--accent-50)]'}`}
                                style={{
                                    color: opt.value === value ? 'var(--accent-500)' : 'var(--text-primary)',
                                    background: opt.value === value ? 'var(--accent-50)' : undefined,
                                }}
                            >
                                {opt.icon}
                                <span className="min-w-0 break-words">{opt.label}</span>
                                {opt.value === value && <div className="ml-auto h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--accent-400)' }} aria-hidden="true" />}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CustomSelect;
