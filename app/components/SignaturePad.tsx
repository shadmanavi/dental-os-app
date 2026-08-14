"use client";

// Signature pad — v1
//
// A box the patient signs in with a finger. Nothing else.
//
// Changelog:
//   v1  First cut. Canvas capture, clear, and a PNG data URL out.
//
// Design notes:
//   - OpenDental's own signature format is a compressed vector of pen
//     strokes, and its API will not accept one from us — proved against
//     the live Downey server. So this does not try to imitate it. The
//     drawing becomes a picture, the picture goes into the PDF, and the
//     PDF is filed in the patient's chart. The image is the record.
//   - Pointer events rather than touch or mouse events. One code path
//     covers finger, stylus and trackpad, and setPointerCapture keeps a
//     stroke alive when the finger strays outside the box mid-signature.
//   - The canvas is sized in device pixels and scaled back down in CSS,
//     so the line is sharp on a retina tablet instead of soft.
//   - touch-action: none on the canvas, or the browser treats a
//     signature as a scroll gesture and the page moves under the finger.
//   - Empty is reported as null rather than as a blank image. A blank
//     PNG is a real image and would sail past a truthiness check, which
//     would file an unsigned plan as signed.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Props = {
  // Called with a PNG data URL, or null when the pad is cleared.
  onChange: (dataUrl: string | null) => void;
  label?: string;
  heightClass?: string;
  disabled?: boolean;
};

export default function SignaturePad({
  onChange,
  label = "Sign here",
  heightClass = "h-40 xl:h-48",
  disabled = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const dirtyRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const [hasInk, setHasInk] = useState(false);

  // -------------------------------------------------------------------
  // Size the backing store to the element, in device pixels.
  //
  // Resizing a canvas clears it, so anything already drawn is captured
  // first and painted back afterwards. Without that, rotating the
  // tablet would wipe a signature the patient had already given.
  // -------------------------------------------------------------------
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);

    if (canvas.width === width && canvas.height === height) return;

    let previous: HTMLCanvasElement | null = null;
    if (dirtyRef.current && canvas.width > 0 && canvas.height > 0) {
      previous = document.createElement("canvas");
      previous.width = canvas.width;
      previous.height = canvas.height;
      previous.getContext("2d")?.drawImage(canvas, 0, 0);
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";

    if (previous !== null) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(previous, 0, 0, width, height);
      ctx.restore();
    }
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  const pointFrom = (
    canvas: HTMLCanvasElement,
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const handleDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;

    // Keep receiving moves even if the finger leaves the box.
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastRef.current = pointFrom(canvas, event);
  };

  const handleMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || !drawingRef.current) return;

    const canvas = canvasRef.current;
    if (canvas === null) return;

    const ctx = canvas.getContext("2d");
    const last = lastRef.current;
    if (ctx === null || last === null) return;

    const next = pointFrom(canvas, event);

    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();

    lastRef.current = next;

    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setHasInk(true);
    }
  };

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;

    const canvas = canvasRef.current;
    if (canvas !== null && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    drawingRef.current = false;
    lastRef.current = null;

    if (dirtyRef.current && canvas !== null) {
      onChange(canvas.toDataURL("image/png"));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    dirtyRef.current = false;
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || !hasInk}
          className="rounded-md px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      <div
        className={`relative w-full rounded-lg border-2 bg-white ${heightClass} ${
          disabled ? "border-slate-700 opacity-60" : "border-slate-500"
        }`}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          className="absolute inset-0 h-full w-full rounded-lg"
          style={{ touchAction: "none" }}
        />

        {!hasInk && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center">
            <div className="h-px w-3/4 bg-slate-300" />
            <span className="mt-1 text-xs text-slate-400">
              Sign above with your finger
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
