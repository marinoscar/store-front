import { useCallback, useRef, useState } from 'react';
import {
  signUploads,
  uploadToS3,
  type SignFileOutput,
} from '@store-front/shared-ui/lib/apiClient';

export type UploadedFile = SignFileOutput & {
  name: string;
  size: number;
  type: string;
  previewUrl: string;
};

interface Props {
  quoteId?: string;
  onUploaded: (files: UploadedFile[], quoteId: string) => void;
  maxFiles?: number;
  maxMb?: number;
  accept?: string;
}

export default function PhotoDropzone({
  quoteId,
  onUploaded,
  maxFiles = 8,
  maxMb = 15,
  accept = 'image/jpeg,image/png,image/webp',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<
    Array<{ name: string; size: number; type: string; pct: number; error?: string; previewUrl: string }>
  >([]);
  const [busy, setBusy] = useState(false);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const incoming = Array.from(fileList).slice(0, maxFiles - items.length);
      if (incoming.length === 0) return;

      const maxBytes = maxMb * 1024 * 1024;
      const validated = incoming.filter((f) => {
        if (f.size > maxBytes) return false;
        if (accept && !accept.split(',').includes(f.type)) return false;
        return true;
      });
      if (validated.length === 0) return;

      const newRows = validated.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
        pct: 0,
        previewUrl: URL.createObjectURL(f),
      }));
      const offset = items.length;
      setItems((prev) => [...prev, ...newRows]);
      setBusy(true);

      try {
        const signed = await signUploads({
          quoteId,
          files: validated.map((f) => ({ filename: f.name, contentType: f.type, size: f.size })),
        });

        const uploaded: UploadedFile[] = [];
        await Promise.all(
          validated.map(async (f, i) => {
            const s = signed.files[i];
            if (!s) return;
            try {
              await uploadToS3(s.putUrl, f, (pct) => {
                setItems((prev) => {
                  const next = [...prev];
                  const row = next[offset + i];
                  if (row) next[offset + i] = { ...row, pct };
                  return next;
                });
              });
              uploaded.push({
                ...s,
                name: f.name,
                size: f.size,
                type: f.type,
                previewUrl: newRows[i]!.previewUrl,
              });
            } catch {
              setItems((prev) => {
                const next = [...prev];
                const row = next[offset + i];
                if (row) next[offset + i] = { ...row, error: 'Upload failed' };
                return next;
              });
            }
          }),
        );

        if (uploaded.length > 0) onUploaded(uploaded, signed.quoteId);
      } finally {
        setBusy(false);
      }
    },
    [items.length, maxFiles, maxMb, accept, quoteId, onUploaded],
  );

  return (
    <div className="dropzone">
      <button
        type="button"
        className="dropzone__target"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        disabled={busy && items.length >= maxFiles}
      >
        <span className="dropzone__icon" aria-hidden="true">📷</span>
        <strong>Drop photos or click to upload</strong>
        <small>JPG, PNG, or WebP up to {maxMb}MB · max {maxFiles} files</small>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </button>

      {items.length > 0 && (
        <ul className="dropzone__list">
          {items.map((it, i) => (
            <li key={i} className="dropzone__row">
              <img src={it.previewUrl} alt="" className="dropzone__thumb" />
              <div className="dropzone__meta">
                <span className="dropzone__name">{it.name}</span>
                {it.error ? (
                  <span className="dropzone__err">{it.error}</span>
                ) : (
                  <div className="dropzone__bar" aria-label={`${it.pct}% uploaded`}>
                    <div className="dropzone__fill" style={{ width: `${it.pct}%` }} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .dropzone { display: flex; flex-direction: column; gap: 0.75rem; }
        .dropzone__target {
          display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
          padding: 1.75rem 1rem;
          border: 2px dashed var(--color-border);
          border-radius: var(--radius);
          background: var(--color-surface);
          color: var(--color-fg);
          text-align: center;
        }
        .dropzone__target:hover:not(:disabled) { border-color: var(--color-primary); background: var(--color-surface-2); }
        .dropzone__icon { font-size: 28px; }
        .dropzone__target small { color: var(--color-muted); }
        .dropzone__list { list-style: none; padding: 0; display: grid; gap: 0.5rem; }
        .dropzone__row { display: grid; grid-template-columns: 48px 1fr; gap: 0.75rem; align-items: center; background: var(--color-surface); padding: 0.5rem; border-radius: var(--radius-sm); }
        .dropzone__thumb { width: 48px; height: 48px; object-fit: cover; border-radius: var(--radius-sm); }
        .dropzone__meta { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
        .dropzone__name { font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dropzone__bar { width: 100%; height: 6px; background: var(--color-border); border-radius: 999px; overflow: hidden; }
        .dropzone__fill { height: 100%; background: var(--color-accent); transition: width 200ms ease; }
        .dropzone__err { color: var(--color-danger); font-size: var(--fs-xs); }
      `}</style>
    </div>
  );
}
