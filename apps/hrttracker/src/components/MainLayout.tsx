import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Settings, Plus, Activity, Calendar, FlaskConical, User } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { useDialog } from '../contexts/DialogContext';
import { useAuth } from '../contexts/AuthContext';
import { API_ORIGIN } from '../api/config';
import { useAppData } from '../contexts/AppDataContext';
import { formatDate, formatTime } from '../utils/helpers';
import { DoseEvent, LabResult } from '../../logic';

import WeightEditorModal from './WeightEditorModal';
import DoseFormModal from './DoseFormModal';
import LabResultModal from './LabResultModal';

type ViewKey = 'home' | 'history' | 'lab' | 'settings' | 'profile';

const MainLayout: React.FC = () => {
    const { t, lang } = useTranslation();
    const { showDialog } = useDialog();
    const navigate = useNavigate();
    const location = useLocation();
    const { isAuthenticated, user } = useAuth();
    const { events, setEvents, weight, setWeight, labResults, setLabResults, currentTime } = useAppData();

    const [isWeightModalOpen, setIsWeightModalOpen] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingEvent, setEditingEvent] = useState<DoseEvent | null>(null);
    const [isLabModalOpen, setIsLabModalOpen] = useState(false);
    const [editingLab, setEditingLab] = useState<LabResult | null>(null);

    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [avatarError, setAvatarError] = useState(false);
    const mainScrollRef = useRef<HTMLDivElement>(null);

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
        const shouldLock = isWeightModalOpen || isFormOpen || isLabModalOpen;
        document.body.style.overflow = shouldLock ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [isWeightModalOpen, isFormOpen, isLabModalOpen]);

    useEffect(() => {
        const el = mainScrollRef.current;
        if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
    }, [location.pathname]);

    useEffect(() => {
        if (isAuthenticated && user?.username) {
            setAvatarUrl(`${API_ORIGIN}/api/avatars/${user.username}`);
            setAvatarError(false);
        } else {
            setAvatarUrl(null);
            setAvatarError(false);
        }
    }, [isAuthenticated, user]);

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

    return (
        <div className="h-screen w-full flex flex-col bg-white text-gray-900 select-none font-sans">

            {/* ── Desktop top bar ── */}
            <header className="hidden md:flex shrink-0 items-center justify-between px-6 h-16 sticky top-0 z-20"
                style={{
                    background: 'rgba(255, 255, 255, 0.88)',
                    borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
                    boxShadow: '0 1px 20px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,1) inset',
                    backdropFilter: 'blur(20px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                }}
            >
                <div className="flex items-center gap-3 min-w-[220px]">
                    <div className="h-9 w-9 rounded-xl border border-gray-200 overflow-hidden">
                        <img src="/favicon.ico" alt="logo" className="h-full w-full object-cover" />
                    </div>
                    <p className="text-sm font-black tracking-tight text-gray-900">Transmtf HRT Tracker</p>
                </div>

                <nav aria-label={t('nav.aria_primary')} className="flex items-center gap-1">
                    {navItems.map(({ id, label, icon: Icon }) => {
                        const active = currentView === id;
                        return (
                            <button
                                key={id}
                                onClick={() => handleViewChange(id)}
                                aria-current={active ? 'page' : undefined}
                                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                                    active
                                        ? 'bg-gray-900 text-white'
                                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                }`}
                            >
                                <Icon size={15} />
                                <span>{label}</span>
                            </button>
                        );
                    })}
                </nav>

                <div className="flex items-center gap-3 min-w-[260px] justify-end">
                    <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">
                        <span>{formatDate(currentTime, lang)}</span>
                        <span className="text-gray-300">·</span>
                        <span className="font-mono">{formatTime(currentTime)}</span>
                    </div>
                    <button
                        onClick={handleAddEvent}
                        className="flex items-center gap-2 rounded-xl bg-gray-900 px-3.5 py-2 text-sm font-bold text-white hover:bg-gray-800 transition"
                    >
                        <Plus size={15} />
                        <span>{t('btn.add')}</span>
                    </button>
                    <button
                        onClick={() => navigate('/profile')}
                        aria-label={t('nav.account') || 'Profile'}
                        className="h-9 w-9 rounded-full border-2 border-gray-200 overflow-hidden hover:border-pink-400 transition"
                    >
                        {isAuthenticated && avatarUrl && !avatarError ? (
                            <img src={avatarUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" onError={() => setAvatarError(true)} />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                                <User size={17} className="text-gray-500" aria-hidden="true" />
                            </div>
                        )}
                    </button>
                </div>
            </header>

            {/* ── Scrollable content ── */}
            <main
                ref={mainScrollRef}
                className="flex-1 overflow-y-auto bg-gray-50"
            >
                <div
                    key={location.pathname}
                    className="min-h-full"
                    style={{ animation: 'fadeSlideIn 0.25s ease-out' }}
                >
                    <Outlet context={{
                        onEditEvent: handleEditEvent,
                        onOpenWeightModal: () => setIsWeightModalOpen(true),
                        onAddEvent: handleAddEvent,
                        onAddLabResult: handleAddLabResult,
                        onEditLabResult: handleEditLabResult,
                        onClearLabResults: handleClearLabResults,
                    }} />
                    {/* bottom padding so content isn't hidden behind the mobile nav */}
                    <div className="h-24 md:h-4" />
                </div>
            </main>

            {/* ── Mobile bottom nav — iOS 26 Liquid Glass ── */}
            <nav aria-label={t('nav.aria_mobile')} className="fixed bottom-0 left-0 right-0 z-40 md:hidden px-3 pt-1 pb-3 bg-gray-50" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
                <div
                    className="rounded-3xl px-1.5 py-1.5"
                    style={{
                        background: 'rgba(255, 255, 255, 0.88)',
                        border: '1px solid rgba(0, 0, 0, 0.08)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.08), 0 1px 0 rgba(255,255,255,1) inset',
                        backdropFilter: 'blur(16px) saturate(150%)',
                        WebkitBackdropFilter: 'blur(16px) saturate(150%)',
                    }}
                >
                    <div className="grid grid-cols-5">
                        {navItems.map(({ id, label, icon: Icon }) => {
                            const active = currentView === id;
                            return (
                                <button
                                    key={id}
                                    onClick={() => handleViewChange(id)}
                                    aria-current={active ? 'page' : undefined}
                                    className="relative flex flex-col items-center gap-0.5 py-2 px-1 rounded-2xl transition-all duration-200"
                                    style={active ? {
                                        background: 'rgba(255,255,255,0.95)',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
                                    } : undefined}
                                >
                                    <Icon
                                        size={22}
                                        className={active ? 'text-pink-600' : 'text-gray-500'}
                                        style={{ transition: 'color 0.2s' }}
                                    />
                                    <span
                                        className="text-[10px] font-semibold leading-none"
                                        style={{ color: active ? '#db2777' : '#6b7280', transition: 'color 0.2s' }}
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
            <WeightEditorModal
                isOpen={isWeightModalOpen}
                onClose={() => setIsWeightModalOpen(false)}
                currentWeight={weight}
                onSave={setWeight}
            />
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
        </div>
    );
};

export default MainLayout;
