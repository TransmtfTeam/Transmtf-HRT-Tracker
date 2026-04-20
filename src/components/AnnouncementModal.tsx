import React, { useEffect, useState } from 'react';
import { X, Megaphone } from 'lucide-react';
import DOMPurify from 'dompurify';

const ANNOUNCEMENT_URL = 'https://www.transmtf.com/api/announcement/tmtf_b243d43f97b51b4fef747016';
const STORAGE_KEY = 'tmtf_announcement_hash';
const ANNOUNCEMENT_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'span', 'div',
  'a', 'blockquote', 'code', 'pre', 'hr', 'img'
];
const ANNOUNCEMENT_ALLOWED_ATTR = [
  'href', 'title', 'target', 'rel', 'src', 'alt',
  'colspan', 'rowspan', 'scope'
];
const ANNOUNCEMENT_SAFE_REL_TOKENS = ['noopener', 'noreferrer'] as const;
const ANNOUNCEMENT_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ANNOUNCEMENT_ALLOWED_TAGS,
  ALLOWED_ATTR: ANNOUNCEMENT_ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math'],
  FORBID_ATTR: ['style'],
  ALLOWED_URI_REGEXP: /^(?:https:|mailto:|tel:|\/(?!\/))/i,
};

function enforceSafeLinkTargets(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll('a[target]').forEach((anchor) => {
    const target = anchor.getAttribute('target');
    if (target == null) return;

    const normalizedTarget = target.trim().toLowerCase();
    if (normalizedTarget !== '_blank') {
      anchor.removeAttribute('target');
      return;
    }

    anchor.setAttribute('target', '_blank');
    const relTokens = new Set(
      (anchor.getAttribute('rel') ?? '')
        .split(/\s+/)
        .map(token => token.trim().toLowerCase())
        .filter(Boolean)
    );
    ANNOUNCEMENT_SAFE_REL_TOKENS.forEach(token => relTokens.add(token));
    anchor.setAttribute('rel', Array.from(relTokens).join(' '));
  });

  return template.innerHTML;
}

function sanitizeAnnouncementHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, ANNOUNCEMENT_SANITIZE_CONFIG);
  return enforceSafeLinkTargets(sanitized);
}

async function hashContent(content: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const AnnouncementModal: React.FC = () => {
  const [content, setContent] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(ANNOUNCEMENT_URL);
        if (!res.ok) return;
        const text = (await res.text()).trim();
        if (!text) return;

        const sanitized = sanitizeAnnouncementHtml(text).trim();
        if (!sanitized) return;

        const currentHash = await hashContent(sanitized);
        const storedHash = localStorage.getItem(STORAGE_KEY);

        // Backward compatibility: older versions stored hash of raw content.
        if (storedHash === currentHash) return;
        if (storedHash) {
          const legacyHash = await hashContent(text);
          if (storedHash === legacyHash) {
            localStorage.setItem(STORAGE_KEY, currentHash);
            return;
          }
        }

        localStorage.setItem(STORAGE_KEY, currentHash);
        setContent(sanitized);
        setVisible(true);
      } catch {
        // 公告是非关键功能，静默失败
      }
    };
    check();
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center px-4 py-6 overflow-y-auto"
      style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)' }}
      onClick={(e) => { if (e.target === e.currentTarget) setVisible(false); }}
    >
      <div
        className="relative w-full max-w-lg mx-auto my-auto rounded-3xl overflow-hidden animate-announcement-in glass-modal glass-noise glass-highlight"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b"
          style={{ background: `linear-gradient(135deg, var(--accent-50), var(--bg-card))`, borderColor: 'var(--border-secondary)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 accent-bg-gradient">
            <Megaphone size={18} className="text-white" strokeWidth={2} />
          </div>
          <h2 className="text-base font-bold flex-1" style={{ color: 'var(--text-primary)' }}>公告 · Announcement</h2>
          <button
            onClick={() => setVisible(false)}
            className="w-8 h-8 flex items-center justify-center rounded-xl transition"
            style={{ color: 'var(--text-tertiary)' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div
          className="px-6 py-5 max-h-[60vh] overflow-y-auto text-sm leading-relaxed announcement-content"
          style={{ color: 'var(--text-secondary)' }}
          dangerouslySetInnerHTML={{ __html: content }}
        />

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end" style={{ borderColor: 'var(--border-secondary)' }}>
          <button
            onClick={() => setVisible(false)}
            className="px-5 py-2 text-white text-sm font-medium rounded-xl transition shadow-sm btn-press-glass glass-btn-primary"
          >
            知道了 · Got it
          </button>
        </div>
      </div>

      <style>{`
        @keyframes announcement-in {
          from { opacity: 0; transform: scale(0.96) translateY(16px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        .animate-announcement-in {
          animation: announcement-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .announcement-content a {
          color: var(--accent-500);
          text-decoration: underline;
        }
        .announcement-content h1, .announcement-content h2, .announcement-content h3 {
          font-weight: 700;
          margin-bottom: 0.5rem;
          color: var(--text-primary);
        }
        .announcement-content h1 { font-size: 1.25rem; }
        .announcement-content h2 { font-size: 1.1rem; }
        .announcement-content h3 { font-size: 1rem; }
        .announcement-content p { margin-bottom: 0.75rem; }
        .announcement-content ul, .announcement-content ol {
          padding-left: 1.25rem;
          margin-bottom: 0.75rem;
        }
        .announcement-content li { margin-bottom: 0.25rem; }
        .announcement-content strong { font-weight: 600; color: var(--text-primary); }
        .announcement-content hr { border-color: var(--border-secondary); margin: 1rem 0; }
        .announcement-content img { max-width: 100%; border-radius: 0.5rem; }
        .announcement-content code {
          background: var(--bg-card-hover);
          padding: 0.1rem 0.4rem;
          border-radius: 0.25rem;
          font-size: 0.85em;
        }
      `}</style>
    </div>
  );
};

export default AnnouncementModal;
