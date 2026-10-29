/**
 * Records a highlight replay as a short video the kid can save or share.
 * Each frame, the 3D canvas is copied onto a 2D canvas with the letterbox,
 * the title and the stamp painted on top, and that canvas (plus the game's
 * own audio) goes into a MediaRecorder. No libraries and no server.
 */
export interface ClipOverlay {
  title: string;
  sub: string;
  /** Rubber stamp at the end ("IT WORKED!"), when showing. */
  stamp: string | null;
  /** 0..1: how far the stamp has slammed in. */
  stampT: number;
  /** "INSTANT REPLAY" tag, blinking. */
  tag: string;
  slowmo: boolean;
}

const MIME = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function canRecordClips(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && MIME.some((m) => MediaRecorder.isTypeSupported(m));
}

export class ClipRecorder {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime = '';
  active = false;
  private time = 0;

  start(src: HTMLCanvasElement, audio: MediaStream | null) {
    // Keep it light: at most 1280 wide, even dimensions for the encoders.
    const scale = Math.min(1, 1280 / src.width);
    this.canvas.width = Math.round((src.width * scale) / 2) * 2;
    this.canvas.height = Math.round((src.height * scale) / 2) * 2;
    const stream = this.canvas.captureStream(30);
    if (audio) for (const t of audio.getAudioTracks()) stream.addTrack(t);
    this.mime = MIME.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 4_000_000 });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.active = true;
    this.time = 0;
  }

  /** Call right after the 3D frame has been rendered. */
  frame(src: HTMLCanvasElement, o: ClipOverlay, dt: number) {
    if (!this.active) return;
    this.time += dt;
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.drawImage(src, 0, 0, W, H);
    // Letterbox.
    const bar = Math.round(H * 0.09);
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, bar);
    c.fillRect(0, H - bar, W, bar);
    const u = H / 400;
    c.textBaseline = 'middle';
    c.font = `900 ${Math.round(18 * u)}px ui-rounded, 'Nunito', system-ui, sans-serif`;
    c.fillStyle = '#fff6e3';
    c.fillText('BACKYARD', 14 * u, bar / 2);
    const w1 = c.measureText('BACKYARD ').width;
    c.fillStyle = '#ff8a1a';
    c.fillText('LAB', 14 * u + w1, bar / 2);
    if (Math.floor(this.time * 2) % 2 === 0 || o.slowmo) {
      c.textAlign = 'right';
      c.fillStyle = o.slowmo ? '#ffd27a' : '#ff5a4a';
      c.font = `800 ${Math.round(13 * u)}px ui-rounded, 'Nunito', system-ui, sans-serif`;
      c.fillText(o.slowmo ? 'SLOW-MO' : `● ${o.tag}`, W - 14 * u, bar / 2);
      c.textAlign = 'left';
    }
    c.fillStyle = '#fff6e3';
    c.font = `800 ${Math.round(15 * u)}px ui-rounded, 'Nunito', system-ui, sans-serif`;
    c.fillText(o.title, 14 * u, H - bar / 2);
    c.textAlign = 'right';
    c.fillStyle = '#d8c8a8';
    c.font = `700 ${Math.round(12 * u)}px ui-rounded, 'Nunito', system-ui, sans-serif`;
    c.fillText(o.sub, W - 14 * u, H - bar / 2);
    c.textAlign = 'left';
    if (o.stamp) drawStamp(c, W / 2, H / 2, o.stamp, o.stampT, u);
  }

  /** Finish and hand back the video (null if nothing was recorded). */
  stop(): Promise<{ blob: Blob; ext: string } | null> {
    const rec = this.rec;
    this.active = false;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = this.mime.split(';')[0] || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        resolve(blob.size ? { blob, ext: type.includes('mp4') ? 'mp4' : 'webm' } : null);
      };
      rec.stop();
      this.rec = null;
    });
  }
}

/** A tilted red rubber stamp that slams down. */
function drawStamp(c: CanvasRenderingContext2D, x: number, y: number, text: string, t: number, u: number) {
  const s = 1 + (1 - Math.min(1, t)) * 1.6;
  c.save();
  c.translate(x, y);
  c.rotate(-0.16);
  c.scale(s, s);
  c.globalAlpha = Math.min(1, t * 2);
  c.font = `900 ${Math.round(46 * u)}px ui-rounded, 'Nunito', system-ui, sans-serif`;
  const w = c.measureText(text).width + 40 * u;
  const hh = 70 * u;
  c.lineWidth = 6 * u;
  c.strokeStyle = '#e0452f';
  c.fillStyle = 'rgba(255, 246, 227, 0.85)';
  c.beginPath();
  if (c.roundRect) c.roundRect(-w / 2, -hh / 2, w, hh, 12 * u);
  else c.rect(-w / 2, -hh / 2, w, hh);
  c.fill();
  c.stroke();
  c.fillStyle = '#e0452f';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 0, 3 * u);
  c.restore();
}

/** Offer the clip to the share sheet where there is one, else download it. */
export async function shareClip(blob: Blob, ext: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const name = `backyard-lab-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'clip'}.${ext}`;
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Backyard Lab', text: `${title}, built in Backyard Lab` });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
