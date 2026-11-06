import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { OG_SIZE } from "@/lib/seo";

/**
 * Shared renderer for the 1200x630 social-preview cards (/og/*). Photos are
 * only ever scaled to fit — never cropped, recoloured or otherwise altered —
 * and sit on the same near-black / red-glow backdrop as the site.
 */

/**
 * Reads a file from /public and returns it as a PNG data URL, downscaled to fit
 * a 640px box. next/og (satori) cannot decode WebP, and the build photos are
 * WebP, so everything is normalised to PNG through sharp. The source file on
 * disk is never modified.
 */
async function publicFileAsPngDataUrl(publicPath: string): Promise<string> {
  const file = await readFile(path.join(process.cwd(), "public", publicPath));
  const png = await sharp(file)
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

interface CardInput {
  /** Small caps line above the headline. */
  kicker: string;
  headline: string;
  /** Up to ~3 short supporting lines. */
  lines?: string[];
  /** Path under /public of the picture shown on the right. */
  picture: string;
  /** Pixel size of the picture box. */
  pictureBox: { width: number; height: number };
}

export async function renderOgCard({ kicker, headline, lines = [], picture, pictureBox }: CardInput) {
  const src = await publicFileAsPngDataUrl(picture);

  const card = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "56px 72px",
          background:
            "radial-gradient(60% 80% at 78% 50%, rgba(231,50,37,0.28) 0%, rgba(231,50,37,0) 70%), linear-gradient(135deg, #0b0b0d 0%, #131316 100%)",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 640 }}>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: "#f9c204",
            }}
          >
            {kicker}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 22,
              fontSize: headline.length > 34 ? 56 : 68,
              lineHeight: 1.08,
              letterSpacing: -1,
            }}
          >
            {headline}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
            {lines.map((line) => (
              <div key={line} style={{ display: "flex", fontSize: 28, lineHeight: 1.4, color: "#b9b9c0" }}>
                {line}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", marginTop: 40, fontSize: 24, color: "#8b8b93" }}>
            M1 Gaming PCs · Qatar
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: pictureBox.width,
            height: pictureBox.height,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders raw <img>, not next/image */}
          <img
            src={src}
            alt=""
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        </div>
      </div>
    ),
    { ...OG_SIZE }
  );

  // next/og only emits PNG, which is ~0.5MB for a photo card. Messaging apps
  // (WhatsApp in particular) skip large link-preview images, so re-encode the
  // finished card as JPEG (~10x smaller, visually the same on this dark design).
  const png = Buffer.from(await card.arrayBuffer());
  const jpeg = await sharp(png).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
