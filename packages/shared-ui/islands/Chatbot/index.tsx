import { useEffect, useRef, useState } from 'react';
import { streamChat, type ChatMessage } from '@store-front/shared-ui/lib/apiClient';

interface Props {
  brandName: string;
  starterFaqs?: string[];
}

export default function Chatbot({ brandName, starterFaqs = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content: `Hi! I'm the ${brandName} assistant. Ask me about our services, areas we cover, or how our quote process works.`,
        },
      ]);
    }
  }, [open, messages.length, brandName]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, streaming]);

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const next: ChatMessage[] = [...messages, userMsg, { role: 'assistant', content: '' }];
    setMessages(next);
    setInput('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    await streamChat(
      [...messages, userMsg],
      (e) => {
        if (e.type === 'delta') {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = { ...last, content: last.content + e.text };
            }
            return copy;
          });
        } else if (e.type === 'error') {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant' && last.content === '') {
              copy[copy.length - 1] = { role: 'assistant', content: '⚠ ' + e.message };
            }
            return copy;
          });
        }
      },
      controller.signal,
    );

    setStreaming(false);
    abortRef.current = null;
  }

  return (
    <>
      <button
        type="button"
        className={`bot-toggle ${open ? 'is-open' : ''}`}
        aria-label={open ? 'Close chat' : 'Open chat'}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '×' : '💬'}
      </button>

      {open && (
        <div className="bot-panel" role="dialog" aria-label={`${brandName} chat`}>
          <header className="bot-panel__head">
            <strong>Chat with us</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </header>
          <div ref={listRef} className="bot-panel__list">
            {messages.map((m, i) => (
              <div key={i} className={`bot-msg bot-msg--${m.role}`}>{m.content || (streaming && i === messages.length - 1 ? '…' : '')}</div>
            ))}
            {messages.length <= 1 && starterFaqs.length > 0 && (
              <div className="bot-starters">
                {starterFaqs.map((q) => (
                  <button key={q} type="button" className="bot-starter" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form
            className="bot-panel__form"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your question…"
              disabled={streaming}
            />
            <button type="submit" disabled={streaming || !input.trim()}>Send</button>
          </form>
        </div>
      )}

      <style>{`
        .bot-toggle {
          position: fixed; right: 18px; bottom: 78px;
          width: 56px; height: 56px; border-radius: 50%;
          background: var(--color-primary); color: var(--color-primary-fg);
          font-size: 24px;
          box-shadow: var(--shadow-lg);
          z-index: 60;
        }
        @media (min-width: 880px) {
          .bot-toggle { bottom: 24px; }
        }
        .bot-panel {
          position: fixed; right: 18px; bottom: 145px;
          width: min(360px, calc(100% - 36px));
          height: min(520px, calc(100% - 200px));
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          display: grid; grid-template-rows: auto 1fr auto;
          z-index: 60;
          overflow: hidden;
        }
        @media (min-width: 880px) {
          .bot-panel { bottom: 92px; }
        }
        .bot-panel__head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.75rem 1rem; background: var(--color-primary); color: var(--color-primary-fg);
        }
        .bot-panel__head button { color: inherit; font-size: 22px; padding: 0 0.25rem; }
        .bot-panel__list { padding: 0.75rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; }
        .bot-msg { max-width: 85%; padding: 0.5rem 0.75rem; border-radius: 14px; font-size: var(--fs-sm); white-space: pre-wrap; }
        .bot-msg--user { align-self: flex-end; background: var(--color-primary); color: var(--color-primary-fg); border-bottom-right-radius: 4px; }
        .bot-msg--assistant { align-self: flex-start; background: var(--color-surface-2); color: var(--color-fg); border-bottom-left-radius: 4px; }
        .bot-starters { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.25rem; }
        .bot-starter { font-size: var(--fs-xs); padding: 0.375rem 0.625rem; border-radius: 999px; background: var(--color-surface-2); border: 1px solid var(--color-border); }
        .bot-panel__form { display: flex; gap: 0.375rem; padding: 0.5rem; border-top: 1px solid var(--color-border); }
        .bot-panel__form input { flex: 1; padding: 0.5rem 0.625rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
        .bot-panel__form button { padding: 0.5rem 0.875rem; background: var(--color-primary); color: var(--color-primary-fg); border-radius: var(--radius-sm); font-weight: 600; }
        .bot-panel__form button:disabled { opacity: 0.5; }
      `}</style>
    </>
  );
}
