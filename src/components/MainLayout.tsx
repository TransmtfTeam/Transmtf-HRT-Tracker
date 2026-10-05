import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Settings, Plus, Activity, Calendar, FlaskConical, User } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { useDialog } from '../contexts/DialogContext';
import { useAuth } from '../contexts/AuthContext';
import { API_ORIGIN } from '../api/config';
import { useAppData, PER_DOSE_WEIGHT_MIGRATION_EVENT } from '../contexts/AppDataContext';
import { formatDate, formatTime } from '../utils/helpers';
import { clearAllLocalMedicalData } from '../utils/localDataCleanup';
import { DoseEvent, LabResult } from '../../logic';

import DoseFormModal from './DoseFormModal';
import BatchDoseModal from './BatchDoseModal';
import LabResultModal from './LabResultModal';

type ViewKey = 'home' | 'history' | 'lab' | 'settings' | 'profile';

const MOBILE_HOME_LONG_PRESS_MS = 550;
const MOBILE_HOME_LONG_PRESS_MOVE_PX = 10;

const MainLayout: React.FC = () => {
    const { t, lang } = useTranslation();
    const { showDialog } = useDialog();
    const navigate = useNavigate();
    const location = useLocation();
    const { isAuthenticated, user } = useAuth();
    const { events, setEvents, labResults, setLabResults, currentTime, isComputing } = useAppData();

    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingEvent, setEditingEvent] = useState<DoseEvent | null>(null);
    const [isLabModalOpen, setIsLabModalOpen] = useState(false);
    const [editingLab, setEditingLab] = useState<LabResult | null>(null);
    const [isBatchOpen, setIsBatchOpen] = useState(false);

    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [avatarError, setAvatarError] = useState(false);
    const mainScrollRef = useRef<HTMLDivElement>(null);
    const mobileHomeLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mobileHomeLongPressStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const mobileHomeLongPressTriggeredRef = useRef(false);

    const currentView = useMemo<ViewKey | null>(() => {
        const { pathname } = location;
        if (pathname === '/') return 'home';
        if (pathname.startsWith('/history')) return 'history';
        if (pathname.startsWith('/lab')) return 'lab';
        if (pathname.startsWith('/settings')) return 'settings';
        if (pathname === '/profile' || pathname === '/account' || pathname.startsWith('/account/')) return 'profile';
        return null;
    }, [location.pathname]);

    const handleViewChange = (view: ViewKey) => {
        const routes: Record<ViewKey, string> = {
            home: '/',
            history: '/history',
            lab: '/lab',
            settings: '/settings',
            profile: '/profile',
        };
        navigate(routes[view]);
    };

    useEffect(() => {
        const handler = () => {
            showDialog('alert', t('migration.per_dose_weight'));
        };        window.addEventListener(PER_DOSE_WEIGHT_MIGRATION_EVENT, handler);
        return () => window.removeEventListener(PER_DOSE_WEIGHT_MIGRATION_EVENT, handler);
    }, [showDialog, t]);

    useEffect(() => {
        const shouldLock = isFormOpen || isLabModalOpen || isBatchOpen;
        document.body.style.overflow = shouldLock ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [isFormOpen, isLabModalOpen, isBatchOpen]);

    useEffect(() => {
        const el = mainScrollRef.current;
        if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
        const notifyLayout = () => window.dispatchEvent(new Event('resize'));
        const rafIds: number[] = [];
        const raf1 = requestAnimationFrame(() => {
            notifyLayout();
            rafIds.push(requestAnimationFrame(notifyLayout));
        });
        rafIds.push(raf1);
        const timers = [100, 300, 600].map(delay => setTimeout(notifyLayout, delay));
        return () => {
            rafIds.forEach(cancelAnimationFrame);
            timers.forEach(clearTimeout);
        };
    }, [location.pathname]);

    useEffect(() => {
        if (isAuthenticated && user) {
            // Prefer OIDC avatar URL, fallback to uploaded avatar
            if (user.avatarUrl) {
                setAvatarUrl(user.avatarUrl);
            } else if (user.username) {
                setAvatarUrl(`${API_ORIGIN}/api/avatars/${user.username}`);
            }
            setAvatarError(false);
        } else {
            setAvatarUrl(null);
            setAvatarError(false);
        }
    }, [isAuthenticated, user]);

    // FINAL-REVIEW (blocker 1): this device holds medical records that were
    // never synced under the current account. Sync is paused (see canSync)
    // until the user decides what should happen to them — otherwise the new
    // account's first sync would upload the previous account's records.
    const ownershipPromptShownRef = useRef(false);
    useEffect(() => {
        if (!isAuthenticated || ownershipPromptShownRef.current) return;
        if (localStorage.getItem('hrt-data-ownership-pending') !== '1') return;
        ownershipPromptShownRef.current = true;
        (async () => {
            const choice = await showDialog('confirm', t('sync.ownership_prompt'), {
                confirmText: t('sync.ownership_upload'),
                cancelText: t('sync.ownership_clear'),
                thirdOption: t('sync.ownership_later'),
            });
            if (choice === 'confirm') {
                // Upload: sync resumes and pushes the local records to this account.
                localStorage.removeItem('hrt-data-ownership-pending');
            } else if (choice === 'cancel') {
                // Clear: wipe local records (storage + in-memory state holders).
                clearAllLocalMedicalData();
                localStorage.removeItem('hrt-data-ownership-pending');
            }
            // 'third' (later): keep the flag — sync stays paused; the prompt
            // reappears on the next mount.
            ownershipPromptShownRef.current = false;
        })();
    }, [isAuthenticated, showDialog, t]);

    const navItems = useMemo(() => [
        { id: 'home' as ViewKey, label: t('nav.home'), icon: Activity },
        { id: 'history' as ViewKey, label: t('nav.history'), icon: Calendar },
        { id: 'lab' as ViewKey, label: t('nav.lab'), icon: FlaskConical },
        { id: 'settings' as ViewKey, label: t('nav.settings'), icon: Settings },
        { id: 'profile' as ViewKey, label: t('nav.account') || 'Profile', icon: User },
    ], [t]);

    const handleAddEvent = () => { setEditingEvent(null); setIsFormOpen(true); };
    const handleEditEvent = (e: DoseEvent) => { setEditingEvent(e); setIsFormOpen(true); };
    const handleAddLabResult = () => { setEditingLab(null); setIsLabModalOpen(true); };
    const handleEditLabResult = (r: LabResult) => { setEditingLab(r); setIsLabModalOpen(true); };
    const handleClearLabResults = () => {
        if (!labResults.length) return;
        showDialog('confirm', t('lab.clear_confirm'), () => setLabResults([]));
    };
    const handleSaveEvent = (e: DoseEvent) => {
        setEvents(prev => {
            const exists = prev.find(p => p.id === e.id);
            return exists ? prev.map(p => p.id === e.id ? e : p) : [...prev, e];
        });
    };
    const handleDeleteEvent = (id: string) => {
        showDialog('confirm', t('timeline.delete_confirm'), () => {
            setEvents(prev => prev.filter(e => e.id !== id));
        });
    };
    const handleSaveBatch = (newEvents: DoseEvent[]) => {
        setEvents(prev => [...prev, ...newEvents]);
    };

    const cancelMobileHomeLongPress = () => {
        if (mobileHomeLongPressTimerRef.current !== null) {
            clearTimeout(mobileHomeLongPressTimerRef.current);
            mobileHomeLongPressTimerRef.current = null;
        }
        mobileHomeLongPressStartRef.current = null;
    };

    const startMobileHomeLongPress = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!event.isPrimary || currentView !== 'home') return;

        cancelMobileHomeLongPress();
        mobileHomeLongPressTriggeredRef.current = false;
        mobileHomeLongPressStartRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
        };
        mobileHomeLongPressTimerRef.current = setTimeout(() => {
            mobileHomeLongPressTimerRef.current = null;
            mobileHomeLongPressTriggeredRef.current = true;
            handleAddEvent();
        }, MOBILE_HOME_LONG_PRESS_MS);
    };

    const moveMobileHomeLongPress = (event: React.PointerEvent<HTMLButtonElement>) => {
        const start = mobileHomeLongPressStartRef.current;
        if (!start || start.pointerId !== event.pointerId) return;

        if (
            Math.abs(event.clientX - start.x) > MOBILE_HOME_LONG_PRESS_MOVE_PX ||
            Math.abs(event.clientY - start.y) > MOBILE_HOME_LONG_PRESS_MOVE_PX
        ) {
            cancelMobileHomeLongPress();
        }
    };

    useEffect(() => () => {
        if (mobileHomeLongPressTimerRef.current !== null) {
            clearTimeout(mobileHomeLongPressTimerRef.current);
        }
    }, []);

    return (
        <div className="h-screen w-full overflow-x-hidden flex flex-col select-none font-sans"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', overscrollBehaviorX: 'none' }}>

            {/* ── Desktop top bar ── */}
            <header className="hidden md:flex shrink-0 items-center justify-between px-6 h-16 sticky top-0 z-20 glass"
                style={{
                    boxShadow: 'var(--shadow-sm)',
                }}
            >
                <div className="flex items-center gap-3 min-w-[220px]">
                    <div className="h-9 w-9 rounded-xl border overflow-hidden"
                        style={{ borderColor: 'var(--border-primary)' }}>
                        <img src="/favicon.ico" alt="logo" className="h-full w-full object-cover" />
                    </div>
                    <p className="text-sm font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>Transmtf HRT Tracker</p>
                </div>

                <nav aria-label={t('nav.aria_primary')} className="flex items-center gap-1">
                    {navItems.map(({ id, label, icon: Icon }) => {
                        const active = currentView === id;
                        return (
                            <button
                                key={id}
                                onClick={() => handleViewChange(id)}
                                aria-current={active ? 'page' : undefined}
                                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold btn-press-glass transition-all duration-200 ${
                                    active
                                        ? 'glass-btn-primary text-white'
                                        : 'glass-btn hover:bg-[var(--glass-bg-default)]'
                                }`}
                                style={active ? {} : {
                                    color: 'var(--text-secondary)',
                                }}
                            >
                                <Icon size={15} />
                                <span>{label}</span>
                            </button>
                        );
                    })}
                </nav>

                <div className="flex items-center gap-3 min-w-[260px] justify-end">
                    {/* F07: explicit PK computation status — a long history recomputes
                        in a worker; without any indicator old values look final. */}
                    {isComputing && (
                        <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
                            style={{ color: 'var(--accent-500)', border: '1px solid var(--accent-200)', background: 'var(--accent-50)' }}>
                            <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ background: 'var(--accent-500)' }} aria-hidden="true" />
                            {t('common.computing') || '计算中…'}
                        </span>
                    )}
                    <div className="flex items-center gap-2 rounded-full glass-subtle px-3 py-1.5 text-xs font-semibold"
                        style={{
                            color: 'var(--text-secondary)',
                        }}>
                        <span>{formatDate(currentTime, lang)}</span>
                        <span style={{ color: 'var(--accent-300)' }}>·</span>
                        <span className="font-mono">{formatTime(currentTime)}</span>
                    </div>
                    <button
                        onClick={handleAddEvent}
                        className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-bold text-white glass-btn-primary btn-press-glass transition"
                    >
                        <Plus size={15} />
                        <span>{t('btn.add')}</span>
                    </button>
                    <button
                        onClick={() => navigate('/profile')}
                        aria-label={t('nav.account') || 'Profile'}
                        className="h-9 w-9 rounded-full border-2 overflow-hidden transition"
                        style={{ borderColor: 'var(--border-primary)' }}
                        onMouseEnter={(e) => e.currentTarget.style.borderColor = `var(--accent-400)`}
                        onMouseLeave={(e) => e.currentTarget.style.borderColor = `var(--border-primary)`}
                    >
                        {isAuthenticated && avatarUrl && !avatarError ? (
                            <img src={avatarUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" onError={() => setAvatarError(true)} />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center"
                                style={{ background: 'var(--bg-card-hover)' }}>
                                <User size={17} style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
                            </div>
                        )}
                    </button>
                </div>
            </header>

            {/* ── Scrollable content ── */}
            <main
                ref={mainScrollRef}
                className="flex-1 overflow-y-auto overflow-x-hidden"
                style={{ background: 'var(--bg-secondary)', overscrollBehaviorX: 'none', touchAction: 'pan-y' }}
            >
                <div
                    key={location.pathname}
                    className="min-h-full max-w-full overflow-x-hidden"
                    style={{ animation: 'fadeSlideIn 0.25s ease-out' }}
                >
                    <Outlet context={{
                        onEditEvent: handleEditEvent,
                        onAddEvent: handleAddEvent,
                        onBatchAdd: () => setIsBatchOpen(true),
                        onAddLabResult: handleAddLabResult,
                        onEditLabResult: handleEditLabResult,
                        onClearLabResults: handleClearLabResults,
                    }} />
                    {/* bottom padding so content isn't hidden behind the mobile nav */}
                    <div className="h-24 md:h-4" />
                </div>
            </main>

            {/* ── Mobile bottom nav — Glass Pill ── */}
            <nav aria-label={t('nav.aria_mobile')} className="fixed bottom-0 left-0 right-0 z-40 md:hidden px-3 pt-1 pb-3"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', background: 'linear-gradient(to top, var(--bg-secondary) 75%, transparent)' }}>
                <div
                    className="rounded-3xl px-1.5 py-1.5 glass"
                    style={{
                        boxShadow: 'var(--shadow-md)',
                    }}
                >
                    <div className="grid grid-cols-5">
                        {navItems.map(({ id, label, icon: Icon }) => {
                            const active = currentView === id;
                            return (
                                <button
                                    key={id}
                                    onClick={(event) => {
                                        if (id === 'home' && active && mobileHomeLongPressTriggeredRef.current) {
                                            event.preventDefault();
                                            mobileHomeLongPressTriggeredRef.current = false;
                                            return;
                                        }
                                        handleViewChange(id);
                                    }}
                                    onPointerDown={id === 'home' && active ? startMobileHomeLongPress : undefined}
                                    onPointerMove={id === 'home' && active ? moveMobileHomeLongPress : undefined}
                                    onPointerUp={id === 'home' && active ? cancelMobileHomeLongPress : undefined}
                                    onPointerCancel={id === 'home' && active ? cancelMobileHomeLongPress : undefined}
                                    onPointerLeave={id === 'home' && active ? cancelMobileHomeLongPress : undefined}
                                    onContextMenu={id === 'home' && active ? (event) => event.preventDefault() : undefined}
                                    aria-current={active ? 'page' : undefined}
                                    className={`relative flex flex-col items-center gap-0.5 py-2.5 px-1 rounded-2xl transition-all duration-200 btn-press-glass ${
                                        active ? 'glass-btn' : ''
                                    }`}
                                >
                                    <Icon
                                        size={22}
                                        style={{
                                            color: active ? 'var(--accent-500)' : 'var(--text-tertiary)',
                                            transition: 'color 0.2s',
                                        }}
                                    />
                                    <span
                                        className="text-[10px] font-semibold leading-none"
                                        style={{
                                            color: active ? 'var(--accent-500)' : 'var(--text-tertiary)',
                                            transition: 'color 0.2s',
                                        }}
                                    >
                                        {label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </nav>

            <style>{`
                @keyframes fadeSlideIn {
                    from { opacity: 0; transform: translateY(6px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>

            {/* ── Modals ── */}
            <DoseFormModal
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                eventToEdit={editingEvent}
                onSave={handleSaveEvent}
                onDelete={handleDeleteEvent}
            />
            <LabResultModal
                isOpen={isLabModalOpen}
                onClose={() => setIsLabModalOpen(false)}
                onSave={(result) => {
                    setLabResults(prev => {
                        const exists = prev.find(r => r.id === result.id);
                        return exists ? prev.map(r => r.id === result.id ? result : r) : [...prev, result];
                    });
                }}
                onDelete={(id) => {
                    showDialog('confirm', t('lab.delete_confirm'), () => {
                        setLabResults(prev => prev.filter(r => r.id !== id));
                    });
                }}
                resultToEdit={editingLab}
            />
            <BatchDoseModal
                isOpen={isBatchOpen}
                onClose={() => setIsBatchOpen(false)}
                onSaveBatch={handleSaveBatch}
            />
        </div>
    );
};

export default MainLayout;
