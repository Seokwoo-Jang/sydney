'use client';
// Adjust photo (plan §7.6.1): drag on a 3:4 card preview (lower half shows the
// number/title band), zoom 1–2×, sliders as the keyboard path. Saves
// focalX / focalY / zoom; the file itself is never cropped.
import { useRef, useState, type PointerEvent } from 'react';
import { ConflictBlock } from '@/components/checklist/FormBits';
import { useDraft } from '@/components/checklist/useDraft';
import { useSaveFlow } from '@/components/checklist/useSaveFlow';
import { Button, SaveStatus, Sheet } from '@/components/ui';
import { useAssets } from '@/lib/data';
import type { FileAsset, Member, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { Photo } from './Photo';
import styles from './Journal.module.css';
import form from '@/components/checklist/Form.module.css';

const DEFAULT = { focalX: 0.5, focalY: 0.4, zoom: 1 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Draft {
  version: number;
  focalX: number;
  focalY: number;
  zoom: number;
}

export function AdjustPhotoSheet({
  open,
  asset,
  day,
  me,
  partner,
  members,
  onClose,
}: {
  open: boolean;
  asset: FileAsset | null;
  day: TripDay | null;
  me: Member | null;
  partner: Member | null;
  members: Member[];
  onClose: () => void;
}) {
  const ops = useAssets();
  const init = (): Draft => ({
    version: asset?.version ?? 0,
    focalX: asset?.focalX ?? DEFAULT.focalX,
    focalY: asset?.focalY ?? DEFAULT.focalY,
    zoom: asset?.zoom ?? DEFAULT.zoom,
  });
  const [draft, patch] = useDraft<Draft>(open, asset?.id ?? null, init);
  const save = useSaveFlow<FileAsset>();
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const edit = (p: Partial<Draft>) => {
    patch(p);
    save.markDirty();
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, fx: draft.focalX, fy: draft.focalY };
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!d || !box) return;
    // Dragging the photo right reveals more of its left side: the focus moves left.
    edit({
      focalX: clamp(d.fx - (e.clientX - d.x) / box.width / draft.zoom, 0, 1),
      focalY: clamp(d.fy - (e.clientY - d.y) / box.height / draft.zoom, 0, 1),
    });
  };
  const onUp = () => {
    drag.current = null;
    setDragging(false);
  };

  const submit = async () => {
    if (!asset) return;
    const fields = { focalX: Number(draft.focalX.toFixed(4)), focalY: Number(draft.focalY.toFixed(4)), zoom: Number(draft.zoom.toFixed(2)) };
    const result = await save.run(() => ops.update(asset.id, fields, draft.version));
    if (result.ok) onClose();
  };

  const by = asset?.updatedBy ? members.find((m) => m.id === asset.updatedBy)?.displayName : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={S.journal.adjust}
      description={by ? S.journal.lastAdjustedBy(by) : undefined}
      headerExtra={<SaveStatus state={save.state} />}
      footer={
        <div className={form.footer}>
          <Button variant="ghost" onClick={() => edit({ ...DEFAULT })}>
            {S.journal.reset}
          </Button>
          <div className={form.footerEnd}>
            <Button variant="ghost" onClick={onClose}>
              {S.actions.cancel}
            </Button>
            <Button variant="primary" busy={save.busy} onClick={submit}>
              {S.actions.save}
            </Button>
          </div>
        </div>
      }
    >
      {asset && day && (
        <div className={form.form}>
          {save.conflict && (
            <ConflictBlock
              key={save.conflict.latest?.version ?? 0}
              latest={save.conflict.latest}
              me={me}
              partner={partner}
              onRebase={(l) => patch({ version: l.version })}
              onUseLatest={(l) => patch({ version: l.version, focalX: l.focalX, focalY: l.focalY, zoom: l.zoom })}
            />
          )}
          <p className={form.hint}>{S.journal.adjustHint}</p>
          <div
            ref={frame}
            className={[styles.adjustFrame, dragging ? styles.adjustDragging : ''].join(' ')}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <Photo
              photo={{ src: asset.url ?? '', thumb: asset.thumbUrl, width: asset.width, height: asset.height, ...draft }}
              alt={asset.caption || S.journal.photoAlt(day.dayNumber)}
              sizes="320px"
              className={styles.adjustImg}
              eager
            />
            <span className={styles.adjustBand} aria-hidden="true">
              <b>{day.dayNumber}</b>
              <span>{day.title}</span>
            </span>
            <span
              className={styles.adjustDot}
              aria-hidden="true"
              style={{ left: `${draft.focalX * 100}%`, top: `${draft.focalY * 100}%` }}
            />
          </div>
          <label className={styles.range}>
            <span>{S.journal.zoom}</span>
            <input type="range" min={1} max={2} step={0.05} value={draft.zoom} onChange={(e) => edit({ zoom: Number(e.target.value) })} />
          </label>
          <label className={styles.range}>
            <span>{S.journal.horizontal}</span>
            <input type="range" min={0} max={1} step={0.01} value={draft.focalX} onChange={(e) => edit({ focalX: Number(e.target.value) })} />
          </label>
          <label className={styles.range}>
            <span>{S.journal.vertical}</span>
            <input type="range" min={0} max={1} step={0.01} value={draft.focalY} onChange={(e) => edit({ focalY: Number(e.target.value) })} />
          </label>
        </div>
      )}
    </Sheet>
  );
}
