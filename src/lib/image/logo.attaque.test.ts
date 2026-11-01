import { describe, expect, test } from "vitest";

import { analyserLogo, decoderBase64 } from "./logo";

// T-60, S-53 : le type réel du logo se lit dans ses octets, jamais dans le
// nom du fichier ni dans le type annoncé. PNG et JPEG seulement, 200 Ko et
// 2048 pixels de côté au plus. Fichiers construits ici, sans image réelle.
// Fiche : docs/features/parametres-organisation.md, section 5, test 3.

const SIGNATURE_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function entier32(valeur: number): number[] {
  return [(valeur >>> 24) & 0xff, (valeur >>> 16) & 0xff, (valeur >>> 8) & 0xff, valeur & 0xff];
}

function png(largeur: number, hauteur: number, remplissage = 0): Uint8Array {
  const ihdr = [
    ...entier32(13),
    ...[0x49, 0x48, 0x44, 0x52],
    ...entier32(largeur),
    ...entier32(hauteur),
    8,
    6,
    0,
    0,
    0,
    ...[0, 0, 0, 0],
  ];
  const idat = [
    ...entier32(remplissage),
    0x49,
    0x44,
    0x41,
    0x54,
    ...new Array<number>(remplissage + 4).fill(0),
  ];
  return Uint8Array.from([...SIGNATURE_PNG, ...ihdr, ...idat, ...IEND]);
}

function jpeg(largeur: number, hauteur: number, marqueur = 0xc0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [
    0xff,
    marqueur,
    0x00,
    0x11,
    8,
    (hauteur >> 8) & 0xff,
    hauteur & 0xff,
    (largeur >> 8) & 0xff,
    largeur & 0xff,
    3,
    ...new Array<number>(9).fill(1),
  ];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xda, 0x00, 0x02, 0x00, 0xff, 0xd9]);
}

function texte(contenu: string): Uint8Array {
  return new TextEncoder().encode(contenu);
}

describe("analyserLogo : acceptés", () => {
  test("PNG : type et dimensions lus dans IHDR", () => {
    expect(analyserLogo(png(320, 120))).toEqual({ type: "image/png", largeur: 320, hauteur: 120 });
  });

  test("JPEG de base et progressif : dimensions lues dans SOFn", () => {
    expect(analyserLogo(jpeg(640, 200))).toEqual({
      type: "image/jpeg",
      largeur: 640,
      hauteur: 200,
    });
    expect(analyserLogo(jpeg(10, 20, 0xc2))).toEqual({
      type: "image/jpeg",
      largeur: 10,
      hauteur: 20,
    });
  });

  test("2048 pixels de côté et 204 800 octets : à la limite, acceptés", () => {
    expect(analyserLogo(png(2048, 2048))?.largeur).toBe(2048);
    const limite = png(1, 1, 204_800 - png(1, 1).length);
    expect(limite.length).toBe(204_800);
    expect(analyserLogo(limite)?.type).toBe("image/png");
  });
});

describe("analyserLogo : refusés", () => {
  const plusUnOctet = png(1, 1, 204_801 - png(1, 1).length);

  test.each([
    ["vide", new Uint8Array()],
    ["HTML renommé en .png", texte("<html><script>alert(1)</script></html>")],
    ["SVG", texte('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["GIF", texte("GIF89a\u0001\u0000\u0001\u0000")],
    ["WebP", texte("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")],
    ["PNG tronqué (sans IEND)", png(10, 10).slice(0, 40)],
    ["PNG sans IHDR en tête", Uint8Array.from([...SIGNATURE_PNG, ...IEND])],
    ["PNG de 4096 pixels", png(4096, 10)],
    ["PNG de largeur nulle", png(0, 10)],
    ["204 801 octets", plusUnOctet],
    ["JPEG sans fin FF D9", jpeg(10, 10).slice(0, -2)],
    ["JPEG sans segment SOF", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])],
    ["JPEG de 4096 pixels", jpeg(4096, 10)],
    ["signature PNG suivie de HTML", Uint8Array.from([...SIGNATURE_PNG, ...texte("<html>")])],
  ])("%s", (_nom, octets) => {
    expect(analyserLogo(octets)).toBeNull();
  });
});

describe("decoderBase64 (strict)", () => {
  test("valide : octets", () => {
    expect(decoderBase64("AQID")).toEqual(Uint8Array.from([1, 2, 3]));
    expect(decoderBase64("AQI=")).toEqual(Uint8Array.from([1, 2]));
  });

  test.each(["", "AQI", "AQ=D", "AQ ID", "AQID\n", "AQ-_", "====", "AQID==="])(
    "%j : refusé",
    (saisie) => {
      expect(decoderBase64(saisie)).toBeNull();
    },
  );
});
