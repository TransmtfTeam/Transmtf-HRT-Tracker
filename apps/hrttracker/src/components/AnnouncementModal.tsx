import React, { useEffect, useState } from 'react';
import { X, Megaphone } from 'lucide-react';

const ANNOUNCEMENT_URL = 'https://www.transmtf.com/api/announcement/tmtf_b243d43f97b51b4fef747016';
const STORAGE_KEY = 'tmtf_announcement_hash';

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

        const hash = await hashContent(text);
        if (hash !== localStorage.getItem(STORAGE_KEY)) {
          localStorage.setItem(STORAGE_KEY, hash);
          setContent(text);
          setVisible(true);
        }
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
      style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) setVisible(false); }}
    >
      <div
        className="relative w-full max-w-lg mx-auto my-auto bg-white rounded-3xl shadow-2xl overflow-hidden animate-announcement-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 bg-gradient-to-r from-pink-50 to-purple-50 border-b border-gray-100">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center flex-shrink-0">
            <Megaphone size={18} className="text-white" strokeWidth={2} />
          </div>
          <h2 className="text-base font-bold text-gray-900 flex-1">公告 · Announcement</h2>
          <button
            onClick={() => setVisible(false)}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div
          className="px-6 py-5 max-h-[60vh] overflow-y-auto text-sm text-gray-700 leading-relaxed announcement-content"
          dangerouslySetInnerHTML={{ __html: content }}
        />

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={() => setVisible(false)}
            className="px-5 py-2 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-400 hover:to-purple-400 text-white text-sm font-medium rounded-xl transition shadow-sm shadow-pink-200"
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
          color: #ec4899;
          text-decoration: underline;
        }
        .announcement-content h1, .announcement-content h2, .announcement-content h3 {
          font-weight: 700;
          margin-bottom: 0.5rem;
          color: #111827;
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
        .announcement-content strong { font-weight: 600; color: #111827; }
        .announcement-content hr { border-color: #e5e7eb; margin: 1rem 0; }
        .announcement-content img { max-width: 100%; border-radius: 0.5rem; }
        .announcement-content code {
          background: #f3f4f6;
          padding: 0.1rem 0.4rem;
          border-radius: 0.25rem;
          font-size: 0.85em;
        }
      `}</style>
    </div>
  );
};

export default AnnouncementModal;
