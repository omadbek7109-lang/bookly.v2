import { deflateSync } from 'node:zlib';
import { createBlock, createBook, createChapter, type Book } from '../../src/models/book';
import type { ResolvedAsset } from '../../src/services/export/types';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Generates a real RGB PNG (gradient) without any image library. */
export function makePng(w = 64, h = 40): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 60 + Math.round((x / w) * 120); raw[o + 1] = 50; raw[o + 2] = 160 + Math.round((y / h) * 90);
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', new Uint8Array()),
  ]));
}

export function sampleBook(): { book: Book; assets: Record<string, ResolvedAsset>; cover: ResolvedAsset } {
  const img: ResolvedAsset = { id: 'ast_img1', bytes: makePng(80, 50), mime: 'image/png', width: 80, height: 50, name: 'img.png' };
  const cover: ResolvedAsset = { id: 'cover', bytes: makePng(60, 90), mime: 'image/png', width: 60, height: 90 };
  const audio: ResolvedAsset = { id: 'ast_aud1', bytes: new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]), mime: 'audio/mpeg', name: 'a.mp3' };
  const ch1 = createChapter('Kirish: moliyaviy savodxonlik nima', [
    createBlock('paragraph', { html: 'Bu <b>qalin</b>, <i>kursiv</i> va <u>tagi chizilgan</u> so‘zlar bilan paragraf. O‘zbek harflari: oʻ gʻ sh ch.' }),
    createBlock('heading', { level: 2, html: 'Asosiy g‘oya' }),
    createBlock('paragraph', { html: 'Ikkinchi paragraf<br>yangi qator bilan.', align: 'center' }),
    createBlock('list', { ordered: false, items: ['Birinchi band', '<b>Ikkinchi</b> band'] }),
    createBlock('list', { ordered: true, items: ['Bir', 'Ikki', 'Uch'] }),
    createBlock('quote', { html: 'Ming chaqirimlik yo‘l ham bir qadamdan boshlanadi.', cite: 'Lao Szi' }),
    createBlock('image', { assetId: 'ast_img1', caption: 'Diagramma', width: 'medium' }),
    createBlock('table', { header: true, rows: [['Bosqich', 'Natija'], ['1-hafta', 'Tasavvur'], ['2-hafta', 'Natija']] }),
    createBlock('divider'),
    createBlock('audio', { assetId: 'ast_aud1', title: 'Muallif so‘zi' }),
    createBlock('pagebreak'),
    createBlock('paragraph', { html: 'Sahifa uzilishidan keyingi matn.' }),
  ]);
  const long = Array.from({ length: 30 }, (_, i) => `Bu ${i + 1}-gap bo‘lib, uzun bobni bir nechta sahifaga bo‘lishni tekshiradi.`).join(' ');
  const ch2 = createChapter('Pul bilan ishlash odatlari', [
    createBlock('paragraph', { html: long }),
    createBlock('paragraph', { html: long }),
    createBlock('heading', { level: 3, html: 'Kichik sarlavha' }),
    createBlock('paragraph', { html: 'Русский текст для проверки транслитерации.' }),
  ]);
  const book = createBook({ title: 'Moliyaviy savodxonlik', subtitle: 'Yoshlar uchun qo‘llanma', author: 'Test Muallif', description: 'Sinov kitobi tavsifi.', chapters: [ch1, ch2], category: 'finance' });
  book.metadata.keywords = ['moliya', 'savodxonlik'];
  return { book, assets: { ast_img1: img, ast_aud1: audio }, cover };
}
