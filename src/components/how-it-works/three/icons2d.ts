import { COLORS, canvasTexture, drawCheck, fonts, roundRect } from "./assets";

/** Simple vector icons drawn into a canvas, centred on (cx, cy) at `s` px. */
export type IconName = "wallet" | "gamepad" | "palette" | "bolt" | "truck";

export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, cx: number, cy: number, s: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (name) {
    case "wallet": {
      roundRect(ctx, -s * 0.46, -s * 0.3, s * 0.92, s * 0.62, s * 0.1);
      ctx.stroke();
      roundRect(ctx, s * 0.12, -s * 0.1, s * 0.34, s * 0.22, s * 0.06);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.26, s * 0.01, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.36, -s * 0.3);
      ctx.lineTo(s * 0.2, -s * 0.46);
      ctx.lineTo(s * 0.3, -s * 0.3);
      ctx.stroke();
      break;
    }
    case "gamepad": {
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.22);
      ctx.lineTo(s * 0.3, -s * 0.22);
      ctx.quadraticCurveTo(s * 0.52, -s * 0.22, s * 0.52, s * 0.08);
      ctx.quadraticCurveTo(s * 0.52, s * 0.34, s * 0.34, s * 0.3);
      ctx.lineTo(s * 0.18, s * 0.12);
      ctx.lineTo(-s * 0.18, s * 0.12);
      ctx.lineTo(-s * 0.34, s * 0.3);
      ctx.quadraticCurveTo(-s * 0.52, s * 0.34, -s * 0.52, s * 0.08);
      ctx.quadraticCurveTo(-s * 0.52, -s * 0.22, -s * 0.3, -s * 0.22);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.05);
      ctx.lineTo(-s * 0.14, -s * 0.05);
      ctx.moveTo(-s * 0.22, -s * 0.13);
      ctx.lineTo(-s * 0.22, s * 0.03);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.2, -s * 0.08, s * 0.045, 0, Math.PI * 2);
      ctx.arc(s * 0.3, s * 0.02, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "palette": {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.42);
      ctx.bezierCurveTo(s * 0.46, -s * 0.42, s * 0.52, s * 0.1, s * 0.26, s * 0.2);
      ctx.bezierCurveTo(s * 0.08, s * 0.26, s * 0.2, s * 0.44, -s * 0.02, s * 0.42);
      ctx.bezierCurveTo(-s * 0.4, s * 0.4, -s * 0.48, -s * 0.42, 0, -s * 0.42);
      ctx.stroke();
      const dots: [number, number, string][] = [
        [-s * 0.2, -s * 0.14, COLORS.red],
        [s * 0.05, -s * 0.24, COLORS.gold],
        [s * 0.24, -s * 0.06, COLORS.white],
        [-s * 0.18, s * 0.14, COLORS.redDark],
      ];
      for (const [x, y, c] of dots) {
        ctx.beginPath();
        ctx.fillStyle = c;
        ctx.arc(x, y, s * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "bolt": {
      ctx.beginPath();
      ctx.moveTo(s * 0.08, -s * 0.48);
      ctx.lineTo(-s * 0.26, s * 0.06);
      ctx.lineTo(-s * 0.02, s * 0.06);
      ctx.lineTo(-s * 0.1, s * 0.48);
      ctx.lineTo(s * 0.28, -s * 0.08);
      ctx.lineTo(s * 0.04, -s * 0.08);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "truck": {
      roundRect(ctx, -s * 0.48, -s * 0.24, s * 0.58, s * 0.42, s * 0.05);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.1, -s * 0.1);
      ctx.lineTo(s * 0.32, -s * 0.1);
      ctx.lineTo(s * 0.48, s * 0.06);
      ctx.lineTo(s * 0.48, s * 0.18);
      ctx.lineTo(s * 0.1, s * 0.18);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.26, s * 0.24, s * 0.08, 0, Math.PI * 2);
      ctx.arc(s * 0.3, s * 0.24, s * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** Round requirement chip: icon badge + caption (scene 1 speech chips). */
export function chipTexture(icon: IconName, caption: string) {
  const f = fonts();
  return canvasTexture(`chip|${icon}|${caption}`, 320, 360, (ctx, w) => {
    const cx = w / 2;
    const cy = 140;
    ctx.beginPath();
    ctx.arc(cx, cy, 118, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(21,21,23,0.96)";
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = COLORS.gold;
    ctx.stroke();
    drawIcon(ctx, icon, cx, cy, 130, COLORS.white);
    ctx.font = `700 40px ${f.display}`;
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(caption, cx, 318);
  });
}

/** Gold check-in-a-circle badge. */
export function checkBadgeTexture(color: string = COLORS.gold) {
  return canvasTexture(`check-badge|${color}`, 256, 256, (ctx, w, h) => {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 118, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    drawCheck(ctx, w / 2, h / 2 + 4, 120, "#111111", 22);
  });
}
