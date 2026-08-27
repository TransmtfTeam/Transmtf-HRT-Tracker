import React, { useMemo, useState } from 'react';
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
import { isRecord, parseImportedBackup, importHasContent, importFallbackWeight } from '../utils/importData';
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
    const darkRaw = localStorage.getItem('hrt-dark-mode');
    return {
        calibrationModel: localStorage.getItem('hrt-calibration-model') || 'ekf',
        calibrationMode: localStorage.getItem('hrt-calibration-mode') || 'retrospective',
        applyE2LearningToCPA: applyE2Raw === '1' || applyE2Raw?.toLowerCase() === 'true',
        applyCPAInhibitionToE2: applyCPARaw === '1' || applyCPARaw?.toLowerCase() === 'true',
        themeColor: localStorage.getItem('hrt-theme-color') || 'sakura',
        themeMode: localStorage.getItem('hrt-theme-mode') || (darkRaw === '1' || darkRaw === 'true' ? 'dark' : 'light'),
        darkMode: darkRaw === '1' || darkRaw === 'true',
    };
};

const SettingsPage: React.FC = () => {
    const { t, lang, setLang } = useTranslation();
    const { showDialog } = useDialog();
    const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
    const { events, setEvents, labResults, setLabResults, gelProducts, setGelProducts } = useAppData();
    const { themeMode, setThemeMode } = useTheme();

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

    const processImportedData = (parsed: unknown): boolean => {
        try {
            const fallbackWeight = importFallbackWeight(parsed, DEFAULT_WEIGHT_KG);
            const { events: newEvents, labResults: newLabResults, gelProducts: newGelProducts, migratedCount } =
                parseImportedBackup(parsed, fallbackWeight);

            if (!importHasContent({ events: newEvents, labResults: newLabResults, gelProducts: newGelProducts, migratedCount })) {
                throw new Error('No valid entries');
            }

            const nextEvents = newEvents.length > 0 ? newEvents : events;
            const nextLabResults = newLabResults ?? labResults;

            if (newEvents.length > 0) {
                setEvents(newEvents);
                localStorage.setItem('hrt-events', JSON.stringify(newEvents));
                localStorage.setItem('hrt-weight', latestEventWeight(newEvents).toString());
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

            if (migratedCount > 0) {
                showDialog('alert', t('migration.per_dose_weight'));
            } else {
                showDialog('alert', t('drawer.import_success'));
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
                                    {([
                                        ['system', Monitor, 'settings.theme.system'],
                                        ['light', Sun, 'settings.theme.light'],
                                        ['dark', Moon, 'settings.theme.dark'],
                                    ] as const).map(([mode, Icon, labelKey]) => {
                                        const active = themeMode === mode;
                                        return (
                                            <button
                                                key={mode}
                                                type="button"
                                                role="radio"
                                                aria-checked={active}
                                                onClick={() => setThemeMode(mode as ThemeMode)}
                                                className="flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-[var(--accent-300)]"
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
