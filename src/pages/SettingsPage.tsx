import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import { useDialog } from '../contexts/DialogContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../contexts/AppDataContext';
import { useTheme } from '../contexts/ThemeContext';
import {
    Languages,
    Upload,
    Download,
    Copy,
    Trash2,
    Info,
    Github,
    AlertTriangle,
    AtSign,
    BarChart2,
    Settings as SettingsIcon,
    Palette,
    Moon,
    Sun,
    Monitor,
} from 'lucide-react';

import { decryptData } from '../../logic';
import { computeDataHash } from '../utils/dataHash';
import { writeCustomGelProducts } from '../utils/doseForm';
import { isRecord, precheckImportedBackup, importHasContent, importFallbackWeight, buildRepairedBackup, type ImportPrecheck } from '../utils/importData';
import type { DoseEvent, LabResult } from '../../types';
import type { GelProductSpec } from '../../pk';
import { DEFAULT_WEIGHT_KG, latestEventWeight } from '../utils/weight';
import { APP_VERSION } from '../constants';
import CustomSelect from '../components/CustomSelect';
import CustomGelManager from '../components/CustomGelManager';
import ImportModal from '../components/ImportModal';
import PasswordInputModal from '../components/PasswordInputModal';
import ModelInfoModal from '../components/ModelInfoModal';
import DisclaimerModal from '../components/DisclaimerModal';
import StatisticsModal from '../components/StatisticsModal';
import ThemePicker from '../components/ui/ThemePicker';
import type { ThemeMode } from '../contexts/ThemeContext';
import type { Lang } from '../i18n/translations';
import flagCN from '../flag_svg/🇨🇳.svg';
import flagTW from '../flag_svg/🇹🇼.svg';
import flagUS from '../flag_svg/🇺🇸.svg';
import flagJP from '../flag_svg/🇯🇵.svg';

// The remaining synced settings (read from localStorage) so a locally-written
// data hash matches CloudSync's full snapshot hash and is never固化 incomplete.
const readExtraSyncFields = () => {
    const applyE2Raw = localStorage.getItem('hrt-apply-e2-learning-to-cpa');
    const applyCPARaw = localStorage.getItem('hrt-apply-cpa-inhibition-to-e2');
    return {
        calibrationModel: localStorage.getItem('hrt-calibration-model') || 'ekf',
        calibrationMode: localStorage.getItem('hrt-calibration-mode') || 'retrospective',
        applyE2LearningToCPA: applyE2Raw === '1' || applyE2Raw?.toLowerCase() === 'true',
        applyCPAInhibitionToE2: applyCPARaw === '1' || applyCPARaw?.toLowerCase() === 'true',
        themeColor: localStorage.getItem('hrt-theme-color') || 'sakura',
    };
};

const THEME_MODE_OPTIONS = [
    ['system', Monitor, 'settings.theme.system'],
    ['light', Sun, 'settings.theme.light'],
    ['dark', Moon, 'settings.theme.dark'],
] as const satisfies readonly (readonly [ThemeMode, typeof Monitor, string])[];

const SettingsPage: React.FC = () => {
    const { t, lang, setLang } = useTranslation();
    const { showDialog } = useDialog();
    const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
    const { events, setEvents, labResults, setLabResults, gelProducts, setGelProducts } = useAppData();
    const { themeMode, setThemeMode } = useTheme();
    const themeModeRefs = useRef<(HTMLButtonElement | null)[]>([]);

    // APG radio-group keys: arrows move selection and focus together, Home/End
    // jump to the ends. Space/Enter are already handled by the native button.
    const handleThemeModeKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        const last = THEME_MODE_OPTIONS.length - 1;
        let next = index;
        switch (e.key) {
            case 'ArrowRight': case 'ArrowDown': next = index === last ? 0 : index + 1; break;
            case 'ArrowLeft': case 'ArrowUp': next = index === 0 ? last : index - 1; break;
            case 'Home': next = 0; break;
            case 'End': next = last; break;
            default: return;
        }
        e.preventDefault();
        setThemeMode(THEME_MODE_OPTIONS[next][0]);
        themeModeRefs.current[next]?.focus();
    };

    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [isPasswordInputOpen, setIsPasswordInputOpen] = useState(false);
    const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
    const [isStatisticsOpen, setIsStatisticsOpen] = useState(false);
    const [isModelInfoOpen, setIsModelInfoOpen] = useState(false);
    const [pendingImportText, setPendingImportText] = useState<string | null>(null);

    const languageOptions = useMemo(() => ([
        { value: 'zh', label: '简体中文', icon: <img src={flagCN} alt="CN" className="w-5 h-5 rounded-sm object-contain" /> },
        { value: 'zh-TW', label: '正體中文（台湾）', icon: <img src={flagTW} alt="TW" className="w-5 h-5 rounded-sm object-contain" /> },
        { value: 'en', label: 'English', icon: <img src={flagUS} alt="US" className="w-5 h-5 rounded-sm object-contain" /> },
        { value: 'ja', label: '日本語', icon: <img src={flagJP} alt="JP" className="w-5 h-5 rounded-sm object-contain" /> },
    ]), []);

    // Roll back to the snapshot written immediately before the apply phase, so
    // a failed apply never leaves mixed old/new data behind. Sections missing
    // from the snapshot are removed rather than restored.
    const restorePreImportSnapshot = () => {
        try {
            const raw = localStorage.getItem('hrt-pre-import-snapshot');
            if (!raw) return;
            const snap = JSON.parse(raw) as {
                events?: unknown;
                labResults?: unknown;
                gelProducts?: unknown;
                weight?: unknown;
                lastModified?: unknown;
                lastDataUpdated?: unknown;
                dataHash?: unknown;
            };
            if (Array.isArray(snap.events)) {
                localStorage.setItem('hrt-events', JSON.stringify(snap.events));
                setEvents(snap.events as DoseEvent[]);
            } else {
                localStorage.removeItem('hrt-events');
            }
            if (Array.isArray(snap.labResults)) {
                localStorage.setItem('hrt-lab-results', JSON.stringify(snap.labResults));
                setLabResults(snap.labResults as LabResult[]);
            } else {
                localStorage.removeItem('hrt-lab-results');
            }
            if (Array.isArray(snap.gelProducts)) {
                writeCustomGelProducts(snap.gelProducts as GelProductSpec[]);
                setGelProducts(snap.gelProducts as GelProductSpec[]);
            } else {
                localStorage.removeItem('hrt-gel-products');
            }
            if (typeof snap.weight === 'string') {
                localStorage.setItem('hrt-weight', snap.weight);
            } else {
                localStorage.removeItem('hrt-weight');
            }
            if (typeof snap.lastModified === 'string') {
                localStorage.setItem('hrt-last-modified', snap.lastModified);
            } else {
                localStorage.removeItem('hrt-last-modified');
            }
            if (typeof snap.lastDataUpdated === 'string') {
                localStorage.setItem('hrt-last-data-updated', snap.lastDataUpdated);
            } else {
                localStorage.removeItem('hrt-last-data-updated');
            }
            if (typeof snap.dataHash === 'string') {
                localStorage.setItem('hrt-data-hash', snap.dataHash);
            } else {
                localStorage.removeItem('hrt-data-hash');
            }
        } catch (rollbackError) {
            console.error('Rollback from pre-import snapshot failed:', rollbackError);
        }
    };

    const processImportedData = async (parsed: unknown): Promise<boolean> => {
        try {
            const fallbackWeight = importFallbackWeight(parsed, DEFAULT_WEIGHT_KG);
            const precheck = precheckImportedBackup(parsed, fallbackWeight);
            const { events: newEvents, labResults: newLabResults, gelProducts: newGelProducts, migratedCount } = precheck;

            if (!importHasContent(precheck)) {
                throw new Error('No valid entries');
            }

            // Fatal: a non-empty section whose rows were ALL rejected is ambiguous
            // corruption. Abort by default and write NOTHING; offer a download of
            // just the accepted rows so the user can salvage them.
            if (precheck.fatalErrors.length > 0) {
                const reasonList = (rows: { index: number; reason: string }[]) =>
                    [...new Set(rows.map(r => r.reason))].join(', ');
                const fatalLines = precheck.fatalErrors.map((entry) => {
                    const section = entry.split(':')[0];
                    const total = section === 'events' ? precheck.stats.eventsTotal
                        : section === 'labResults' ? precheck.stats.labsTotal
                        : precheck.stats.gelsTotal;
                    const reasons = section === 'events' ? reasonList(precheck.stats.eventsRejected)
                        : section === 'labResults' ? reasonList(precheck.stats.labsRejected)
                        : reasonList(precheck.stats.gelsRejected);
                    return t('import.fatal_detail')
                        .replace('{section}', section)
                        .replace('{total}', String(total))
                        .replace('{reasons}', reasons);
                });
                const fatalMessage = [t('import.fatal_title'), ...fatalLines].join('\n\n');
                const choice = await showDialog('alert', fatalMessage, { thirdOption: t('import.export_repaired') });
                if (choice === 'third') {
                    downloadRepairedCopy(precheck);
                }
                return false;
            }

            // Non-fatal issues (skipped rows, reassigned duplicate ids, migrated
            // weights, missing gel refs, rejected units) need an explicit ack.
            if (precheck.warnings.length > 0) {
                const warningMessage = `${t('import.warnings_detail').replace('{details}', precheck.warnings.join('; '))}\n\n${t('import.proceed_confirm')}`;
                const choice = await showDialog('confirm', warningMessage);
                if (choice !== 'confirm') return false;
            }

            // An explicit `events: []` section means CLEAR ALL dose events — a
            // destructive clear gets its own dedicated confirm (F17).
            if (newEvents !== null && newEvents.length === 0) {
                const choice = await showDialog('confirm', t('import.clear_events_confirm'));
                if (choice !== 'confirm') return false;
            }

            // Snapshot current data right before applying so the import can be undone.
            // Includes the legacy weight so a future restore can return it too.
            localStorage.setItem('hrt-pre-import-snapshot', JSON.stringify({
                events,
                labResults,
                gelProducts,
                weight: localStorage.getItem('hrt-weight'),
                lastModified: localStorage.getItem('hrt-last-modified'),
                lastDataUpdated: localStorage.getItem('hrt-last-data-updated'),
                dataHash: localStorage.getItem('hrt-data-hash'),
                savedAt: new Date().toISOString(),
            }));

            try {
                const nextEvents = newEvents ?? events;
                const nextLabResults = newLabResults ?? labResults;

                if (newEvents !== null) {
                    setEvents(newEvents);
                    localStorage.setItem('hrt-events', JSON.stringify(newEvents));
                    if (newEvents.length > 0) {
                        localStorage.setItem('hrt-weight', latestEventWeight(newEvents).toString());
                    } else {
                        // An explicit `events: []` has no weight source; a stale
                        // hrt-weight would otherwise keep flowing into hashes/cloud sync.
                        localStorage.removeItem('hrt-weight');
                    }
                }

                // Only overwrite labs when the file actually carried a labResults
                // section; a gel-only / events-only backup leaves existing labs intact.
                if (newLabResults !== null) {
                    setLabResults(newLabResults);
                    localStorage.setItem('hrt-lab-results', JSON.stringify(newLabResults));
                }

                // Restore custom gel products so imported gel events resolve their real
                // kinetics instead of silently falling back to the default product.
                if (newGelProducts !== null) {
                    setGelProducts(newGelProducts);
                    writeCustomGelProducts(newGelProducts);
                }

                const lastModified = new Date().toISOString();
                localStorage.setItem('hrt-last-modified', lastModified);
                localStorage.setItem('hrt-last-data-updated', lastModified);
                const langValue = localStorage.getItem('hrt-lang') || lang;
                const dataHash = computeDataHash({
                    events: nextEvents,
                    weight: latestEventWeight(nextEvents),
                    labResults: nextLabResults,
                    lang: langValue,
                    gelProducts: newGelProducts ?? gelProducts,
                    ...readExtraSyncFields(),
                });
                localStorage.setItem('hrt-data-hash', dataHash);
                window.dispatchEvent(new CustomEvent('hrt-local-data-updated', { detail: { key: 'hrt-import', lastModified } }));
            } catch (applyError) {
                // Any failure mid-apply (storage full, hash error, ...) must not
                // leave a half-imported backup behind: roll back to the snapshot.
                console.error('Import failed during apply; rolling back.', applyError);
                restorePreImportSnapshot();
                showDialog('alert', t('drawer.import_error'));
                return false;
            }

            if (migratedCount > 0) {
                showDialog('alert', `${t('migration.per_dose_weight')}\n\n${t('settings.import_snapshot_hint')}`);
            } else {
                showDialog('alert', `${t('drawer.import_success')}\n\n${t('settings.import_snapshot_hint')}`);
            }
            return true;
        } catch (error) {
            console.error(error);
            showDialog('alert', t('drawer.import_error'));
            return false;
        }
    };

    const importEventsFromJson = async (text: string): Promise<boolean> => {
        try {
            const parsed: unknown = JSON.parse(text);
            const confirmKey = (isAuthenticated && !isAuthLoading) ? 'import.overwrite_confirm' : 'import.overwrite_confirm_local';
            const confirmation = await showDialog('confirm', t(confirmKey));
            if (confirmation !== 'confirm') {
                return false;
            }

            if (
                isRecord(parsed) &&
                Boolean(parsed.encrypted) &&
                typeof parsed.iv === 'string' &&
                typeof parsed.salt === 'string' &&
                typeof parsed.data === 'string'
            ) {
                setPendingImportText(text);
                setIsPasswordInputOpen(true);
                return true;
            }

            return processImportedData(parsed);
        } catch (error) {
            console.error(error);
            showDialog('alert', t('drawer.import_error'));
            return false;
        }
    };

    const handlePasswordSubmit = async (passwordInput: string) => {
        if (!pendingImportText) return;

        const decrypted = await decryptData(pendingImportText, passwordInput);
        if (!decrypted) {
            showDialog('alert', t('import.decrypt_error'));
            return;
        }

        setIsPasswordInputOpen(false);
        setPendingImportText(null);

        try {
            const parsed: unknown = JSON.parse(decrypted);
            processImportedData(parsed);
        } catch (error) {
            console.error(error);
            showDialog('alert', t('import.decrypt_error'));
        }
    };

    const handleQuickExport = () => {
        if (events.length === 0 && labResults.length === 0 && gelProducts.length === 0) {
            showDialog('alert', t('drawer.empty_export'));
            return;
        }

        const exportData = {
            meta: { version: 2, exportedAt: new Date().toISOString() },
            weight: latestEventWeight(events),
            events,
            labResults,
            gelProducts,
        };

        navigator.clipboard.writeText(JSON.stringify(exportData, null, 2)).then(() => {
            showDialog('alert', t('drawer.export_copied'));
        }).catch((error) => {
            console.error('Failed to copy:', error);
        });
    };

    const downloadFile = (data: string, filename: string) => {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    };

    // Salvage path after a fatal precheck: a copy containing ONLY the sections
    // that still have importable rows (buildRepairedBackup). Sections that lost
    // every row are omitted entirely, so re-importing the copy keeps existing
    // data instead of wiping the section with an explicit empty array.
    const downloadRepairedCopy = (precheck: ImportPrecheck) => {
        const repaired = buildRepairedBackup(precheck);
        if (Array.isArray(repaired.events) && repaired.events.length > 0) {
            repaired.weight = latestEventWeight(repaired.events as DoseEvent[]);
        }
        downloadFile(JSON.stringify(repaired, null, 2), 'hrt-repaired-backup.json');
    };

    const handleExport = () => {
        if (events.length === 0 && labResults.length === 0 && gelProducts.length === 0) {
            showDialog('alert', t('drawer.empty_export'));
            return;
        }
        const exportData = {
            meta: { version: 2, exportedAt: new Date().toISOString() },
            weight: latestEventWeight(events),
            events,
            labResults,
            gelProducts,
        };
        downloadFile(JSON.stringify(exportData, null, 2), `hrt-dosages-${new Date().toISOString().split('T')[0]}.json`);
    };

    const handleClearAllEvents = () => {
        if (!events.length) return;

        showDialog('confirm', t('drawer.clear_confirm'), () => {
            setEvents([]);
            localStorage.setItem('hrt-events', JSON.stringify([]));
            const lastModified = new Date().toISOString();
            localStorage.setItem('hrt-last-modified', lastModified);
            localStorage.setItem('hrt-last-data-updated', lastModified);
            const langValue = localStorage.getItem('hrt-lang') || lang;
            const dataHash = computeDataHash({
                events: [],
                weight: DEFAULT_WEIGHT_KG,
                labResults,
                lang: langValue,
                gelProducts,
                ...readExtraSyncFields(),
            });
            localStorage.setItem('hrt-data-hash', dataHash);
            window.dispatchEvent(new CustomEvent('hrt-local-data-updated', { detail: { key: 'hrt-events', lastModified } }));
        });
    };

    const sectionTitleClass = "px-1 text-xs font-bold uppercase tracking-wider";

    return (
        <div className="min-h-full px-4 py-6 md:px-6">
            <div className="mx-auto w-full max-w-2xl space-y-6">
                {/* Page title */}
                <div className="rounded-2xl glass-card glass-highlight relative overflow-hidden p-5">
                    <h1 className="flex items-center gap-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                        <SettingsIcon size={24} style={{ color: 'var(--accent-500)' }} />
                        {t('nav.settings') || 'Settings'}
                    </h1>
                </div>

                {/* Appearance Section */}
                <section className="space-y-2">
                    <h2 className={sectionTitleClass} style={{ color: 'var(--text-tertiary)' }}>
                        {t('settings.group.appearance') || 'Appearance'}
                    </h2>
                    <div className="rounded-2xl glass-card p-5 space-y-5">
                        {/* Theme Color */}
                        <div>
                            <div className="flex items-start gap-3 mb-4">
                                <Palette size={20} style={{ color: 'var(--accent-500)' }} />
                                <div>
                                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('settings.theme.title')}</p>
                                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('settings.theme.desc')}</p>
                                </div>
                            </div>
                            <ThemePicker />
                        </div>

                        {/* Theme Mode */}
                        <div className="border-t pt-4" style={{ borderColor: 'var(--border-secondary)' }}>
                            <div className="space-y-3">
                                <div className="flex items-start gap-3">
                                    {themeMode === 'system' ? <Monitor size={20} style={{ color: 'var(--accent-500)' }} /> : themeMode === 'dark' ? <Moon size={20} style={{ color: 'var(--accent-500)' }} /> : <Sun size={20} style={{ color: 'var(--accent-500)' }} />}
                                    <div>
                                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('settings.theme.mode')}</p>
                                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('settings.theme.mode_desc')}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-1 rounded-xl p-1" style={{ background: 'var(--bg-secondary)' }} role="radiogroup" aria-label={t('settings.theme.mode')}>
                                    {THEME_MODE_OPTIONS.map(([mode, Icon, labelKey], index) => {
                                        const active = themeMode === mode;
                                        return (
                                            <button
                                                key={mode}
                                                type="button"
                                                role="radio"
                                                aria-checked={active}
                                                // A radio group is a single tab stop: only the checked
                                                // option is reachable by Tab, arrows move within it.
                                                tabIndex={active ? 0 : -1}
                                                ref={(el) => { themeModeRefs.current[index] = el; }}
                                                onClick={() => setThemeMode(mode)}
                                                onKeyDown={(e) => handleThemeModeKeyDown(e, index)}
                                                className="flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-300)]"
                                                style={active ? {
                                                    color: 'var(--accent-600)',
                                                    background: 'var(--bg-card)',
                                                    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                                                } : { color: 'var(--text-secondary)' }}
                                            >
                                                <Icon size={16} />
                                                {t(labelKey)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Language Section */}
                <section className="space-y-2">
                    <h2 className={sectionTitleClass} style={{ color: 'var(--text-tertiary)' }}>
                        {t('settings.group.general') || 'General'}
                    </h2>
                    <div className="rounded-2xl glass-card p-4">
                        <div className="mb-3 flex items-start gap-3">
                            <Languages className="text-blue-500" size={20} />
                            <div>
                                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('drawer.lang')}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('drawer.lang_hint')}</p>
                            </div>
                            <div className="ml-auto text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{lang.toUpperCase()}</div>
                        </div>
                        <CustomSelect
                            value={lang}
                            onChange={(value) => setLang(value as Lang)}
                            options={languageOptions}
                        />
                    </div>
                </section>

                {/* Custom gels Section */}
                <section className="space-y-2">
                    <h2 className={sectionTitleClass} style={{ color: 'var(--text-tertiary)' }}>
                        {t('settings.group.gels') || 'Custom gels'}
                    </h2>
                    <CustomGelManager />
                </section>

                {/* Data Section */}
                <section className="space-y-2">
                    <h2 className={sectionTitleClass} style={{ color: 'var(--text-tertiary)' }}>
                        {t('settings.group.data') || 'Data Management'}
                    </h2>
                    <div className="overflow-hidden rounded-2xl glass-card divide-y divide-[var(--border-secondary)]">
                        <button
                            onClick={() => setIsImportModalOpen(true)}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition btn-press-glass"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-50)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <Upload className="text-teal-500" size={20} />
                            <div>
                                <p className="text-sm font-bold">{t('import.title')}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('drawer.import_hint')}</p>
                            </div>
                        </button>

                        <button
                            onClick={handleExport}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition btn-press-glass"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-50)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <Download style={{ color: 'var(--accent-500)' }} size={20} />
                            <div>
                                <p className="text-sm font-bold">{t('export.title')}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('drawer.save_hint')}</p>
                            </div>
                        </button>

                        <button
                            onClick={handleQuickExport}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition btn-press-glass"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <Copy className="text-blue-500" size={20} />
                            <div>
                                <p className="text-sm font-bold">{t('drawer.export_quick')}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('drawer.export_quick_hint')}</p>
                            </div>
                        </button>

                        <button
                            onClick={handleClearAllEvents}
                            disabled={!events.length}
                            className={`flex w-full items-center gap-3 px-4 py-4 text-left transition ${
                                events.length ? 'btn-press-glass hover:bg-red-50 dark:hover:bg-red-950/30' : 'cursor-not-allowed opacity-60'
                            }`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <Trash2 className="text-red-500" size={20} />
                            <div>
                                <p className="text-sm font-bold">{t('drawer.clear')}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('drawer.clear_confirm')}</p>
                            </div>
                        </button>
                    </div>
                </section>

                {/* About Section */}
                <section className="space-y-2">
                    <h2 className={sectionTitleClass} style={{ color: 'var(--text-tertiary)' }}>
                        {t('settings.group.about') || 'About'}
                    </h2>
                    <div className="overflow-hidden rounded-2xl glass-card divide-y divide-[var(--border-secondary)]">
                        <button
                            onClick={() => setIsModelInfoOpen(true)}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition btn-press-glass"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <Info className="text-purple-500" size={20} />
                            <div>
                                <p className="text-sm font-bold">{t('drawer.model_title')}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('drawer.model_desc')}</p>
                            </div>
                        </button>

                        <button
                            onClick={() => {
                                showDialog('confirm', t('drawer.github_confirm'), () => {
                                    window.open('https://github.com/TransmtfTeam/Transmtf-HRT-Tracker', '_blank');
                                });
                            }}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition btn-press-glass"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <Github size={20} style={{ color: 'var(--text-secondary)' }} />
                            <div>
                                <p className="text-sm font-bold">{t('drawer.github')}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('drawer.github_desc')}</p>
                            </div>
                        </button>

                        <button
                            onClick={() => {
                                showDialog('confirm', t('drawer.contact_confirm'), () => {
                                    window.open('https://x.com/axzamyzed', '_blank');
                                });
                            }}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition btn-press-glass"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <AtSign size={20} style={{ color: 'var(--text-secondary)' }} />
                            <div>
                                <p className="text-sm font-bold">{t('drawer.contact')}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('drawer.contact_desc')}</p>
                            </div>
                        </button>

                        <button
                            onClick={() => setIsStatisticsOpen(true)}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition btn-press-glass"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <BarChart2 className="text-blue-500" size={20} />
                            <div>
                                <p className="text-sm font-bold">{t('statistics.title')}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('statistics.desc')}</p>
                            </div>
                        </button>

                        <button
                            onClick={() => setIsDisclaimerOpen(true)}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition btn-press-glass"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <AlertTriangle className="text-amber-500" size={20} />
                            <div>
                                <p className="text-sm font-bold">{t('drawer.disclaimer')}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('drawer.disclaimer_desc')}</p>
                            </div>
                        </button>
                    </div>
                </section>

                <div className="pb-4 pt-2 text-center">
                    <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>{APP_VERSION}</p>
                </div>
            </div>

            <ImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onImportJson={importEventsFromJson}
            />

            <PasswordInputModal
                isOpen={isPasswordInputOpen}
                onClose={() => setIsPasswordInputOpen(false)}
                onConfirm={handlePasswordSubmit}
            />

            <DisclaimerModal
                isOpen={isDisclaimerOpen}
                onClose={() => setIsDisclaimerOpen(false)}
            />

            <ModelInfoModal
                isOpen={isModelInfoOpen}
                onClose={() => setIsModelInfoOpen(false)}
            />

            <StatisticsModal
                isOpen={isStatisticsOpen}
                onClose={() => setIsStatisticsOpen(false)}
            />
        </div>
    );
};

export default SettingsPage;
