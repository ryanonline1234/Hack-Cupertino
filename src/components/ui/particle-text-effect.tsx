import { useCallback, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Vector2D {
  x: number;
  y: number;
}

class Particle {
  pos: Vector2D = { x: 0, y: 0 };
  vel: Vector2D = { x: 0, y: 0 };
  acc: Vector2D = { x: 0, y: 0 };
  target: Vector2D = { x: 0, y: 0 };

  closeEnoughTarget = 68;
  maxSpeed = 1.0;
  maxForce = 0.1;
  particleSize = 10;
  isKilled = false;

  startColor = { r: 0, g: 0, b: 0 };
  targetColor = { r: 0, g: 0, b: 0 };
  colorWeight = 0;
  colorBlendRate = 0.01;

  move() {
    let proximityMult = 1;
    const distance = Math.sqrt(
      Math.pow(this.pos.x - this.target.x, 2) + Math.pow(this.pos.y - this.target.y, 2)
    );

    if (distance < this.closeEnoughTarget) {
      proximityMult = distance / this.closeEnoughTarget;
    }

    const towardsTarget = {
      x: this.target.x - this.pos.x,
      y: this.target.y - this.pos.y,
    };

    const magnitude = Math.sqrt(
      towardsTarget.x * towardsTarget.x + towardsTarget.y * towardsTarget.y
    );
    if (magnitude > 0) {
      towardsTarget.x = (towardsTarget.x / magnitude) * this.maxSpeed * proximityMult;
      towardsTarget.y = (towardsTarget.y / magnitude) * this.maxSpeed * proximityMult;
    }

    const steer = {
      x: towardsTarget.x - this.vel.x,
      y: towardsTarget.y - this.vel.y,
    };

    const steerMagnitude = Math.sqrt(steer.x * steer.x + steer.y * steer.y);
    if (steerMagnitude > 0) {
      steer.x = (steer.x / steerMagnitude) * this.maxForce;
      steer.y = (steer.y / steerMagnitude) * this.maxForce;
    }

    this.acc.x += steer.x;
    this.acc.y += steer.y;

    this.vel.x += this.acc.x;
    this.vel.y += this.acc.y;
    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;
    this.acc.x = 0;
    this.acc.y = 0;
  }

  draw(ctx: CanvasRenderingContext2D, drawAsPoints: boolean) {
    if (this.colorWeight < 1.0) {
      this.colorWeight = Math.min(this.colorWeight + this.colorBlendRate, 1.0);
    }

    const currentColor = {
      r: Math.round(
        this.startColor.r + (this.targetColor.r - this.startColor.r) * this.colorWeight
      ),
      g: Math.round(
        this.startColor.g + (this.targetColor.g - this.startColor.g) * this.colorWeight
      ),
      b: Math.round(
        this.startColor.b + (this.targetColor.b - this.startColor.b) * this.colorWeight
      ),
    };

    if (drawAsPoints) {
      ctx.fillStyle = `rgb(${currentColor.r}, ${currentColor.g}, ${currentColor.b})`;
      ctx.fillRect(Math.floor(this.pos.x), Math.floor(this.pos.y), 2, 2);
    } else {
      ctx.fillStyle = `rgb(${currentColor.r}, ${currentColor.g}, ${currentColor.b})`;
      ctx.beginPath();
      ctx.arc(this.pos.x, this.pos.y, this.particleSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  kill(width: number, height: number) {
    if (!this.isKilled) {
      const randomPos = this.generateRandomPos(width / 2, height / 2, (width + height) / 2);
      this.target.x = randomPos.x;
      this.target.y = randomPos.y;

      this.startColor = {
        r: this.startColor.r + (this.targetColor.r - this.startColor.r) * this.colorWeight,
        g: this.startColor.g + (this.targetColor.g - this.startColor.g) * this.colorWeight,
        b: this.startColor.b + (this.targetColor.b - this.startColor.b) * this.colorWeight,
      };
      this.targetColor = { r: 0, g: 0, b: 0 };
      this.colorWeight = 0;

      this.isKilled = true;
    }
  }

  private generateRandomPos(x: number, y: number, mag: number): Vector2D {
    const randomX = Math.random() * 1000;
    const randomY = Math.random() * 500;

    const direction = {
      x: randomX - x,
      y: randomY - y,
    };

    const magnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    if (magnitude > 0) {
      direction.x = (direction.x / magnitude) * mag;
      direction.y = (direction.y / magnitude) * mag;
    }

    return {
      x: x + direction.x,
      y: y + direction.y,
    };
  }
}

export interface ParticleTextEffectProps {
  words?: string[];
  /** When true, fills the parent and omits demo chrome — use behind main UI */
  variant?: "standalone" | "background";
  className?: string;
  /** Show footer hint (standalone only) */
  showHint?: boolean;
  /** Fires once when the hero title (“NutriPlan.AI”) snaps to the top (≥3-word hero only) */
  onTitlePhase?: () => void;
}

/** Legacy default phrases (optional) */
export const NUTRIPLAN_PARTICLE_WORDS = [
  "NUTRIPLAN",
  ".AI",
  "URBAN",
  "FOOD",
  "ACCESS",
  "SIMULATE",
];

/** Landing hero: story beats → persistent title at top (needs ≥3 strings for title beat) */
export const HERO_PARTICLE_WORDS = ["Million Lives.", "One Decision.", "NutriPlan.AI"];

/** Min time first hero line stays up after layout; particles need ~0.4–0.8s to resolve before it reads clearly */
const FIRST_PHRASE_HOLD_MS = 7800;

/** Min time on “One Decision.” before drifting upward (keep brief, then rise with the line) */
const SECOND_PHRASE_HOLD_MS = 700;

/** Drift speed (canvas px/frame) while rising; stop when glyph reaches upper band */
const RISE_PX_PER_FRAME = 3.6;

/** When the top of the drifting line crosses this fraction of canvas height, snap to title */
const TITLE_TRIGGER_TOP_FRAC = 0.2;

/** Sampling step along glyph (lower = denser; too low + bright blend reads as a solid slab) */
const pixelSteps = 4;
const drawAsPoints = true;

function generateRandomPos(x: number, y: number, mag: number): Vector2D {
  const randomX = Math.random() * 1000;
  const randomY = Math.random() * 500;

  const direction = {
    x: randomX - x,
    y: randomY - y,
  };

  const magnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
  if (magnitude > 0) {
    direction.x = (direction.x / magnitude) * mag;
    direction.y = (direction.y / magnitude) * mag;
  }

  return {
    x: x + direction.x,
    y: y + direction.y,
  };
}

/** Bright but not maxed-out RGB — avoids “white rectangle” when many particles overlap */
function randomBrandColor() {
  return {
    r: 200 + Math.floor(Math.random() * 45),
    g: 215 + Math.floor(Math.random() * 40),
    b: 228 + Math.floor(Math.random() * 27),
  };
}

export function ParticleTextEffect({
  words = HERO_PARTICLE_WORDS,
  variant = "standalone",
  className,
  showHint = true,
  onTitlePhase,
}: ParticleTextEffectProps) {
  const onTitlePhaseRef = useRef(onTitlePhase);
  onTitlePhaseRef.current = onTitlePhase;
  const titlePhaseNotifiedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: 0, y: 0, isPressed: false, isRightClick: false });
  /** 0 first line → 2 second line → 4 rising → 6 title (top) */
  const phraseStepRef = useRef<0 | 2 | 4 | 6>(0);
  /** Clock for first → second transition */
  const phraseClockRef = useRef<number | undefined>(undefined);
  /** Set when second line is shown — for second → rise */
  const phrase2StartRef = useRef<number | undefined>(undefined);
  /** Cumulative upward shift during rise (for resize replay) */
  const riseAccumRef = useRef(0);
  const wordsRef = useRef(words);

  wordsRef.current = words;

  const nextWord = useCallback(
    (
      word: string,
      canvas: HTMLCanvasElement,
      opts?: { layout?: "center" | "upper"; seedImmediateWhite?: boolean }
    ) => {
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = canvas.width;
    offscreenCanvas.height = canvas.height;
    const offscreenCtx = offscreenCanvas.getContext("2d");
    if (!offscreenCtx) return;

    const w = canvas.width;
    const h = canvas.height;
    const layout = opts?.layout ?? "center";
    const seedImmediateWhite = opts?.seedImmediateWhite === true;
    const maxTextWidth = w * 0.92;
    /* Shrink font until the line fits — clipped text produced zero particles before */
    const sizeCap =
      layout === "upper"
        ? Math.min(h * 0.2, 112)
        : Math.min(h * 0.34, 140);
    let fontSize = 12;
    for (let s = Math.floor(sizeCap); s >= 10; s--) {
      offscreenCtx.font = `bold ${s}px Inter, system-ui, sans-serif`;
      if (offscreenCtx.measureText(word).width <= maxTextWidth) {
        fontSize = s;
        break;
      }
    }
    fontSize = Math.max(
      10,
      Math.min(fontSize, Math.floor((layout === "upper" ? h * 0.18 : h * 0.32)))
    );
    const textY = layout === "upper" ? h * TITLE_TRIGGER_TOP_FRAC : h / 2;
    offscreenCtx.fillStyle = "white";
    offscreenCtx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
    offscreenCtx.textAlign = "center";
    offscreenCtx.textBaseline = "middle";
    offscreenCtx.fillText(word, w / 2, textY);

    const imageData = offscreenCtx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;

    const newColor = randomBrandColor();

    const particles = particlesRef.current;
    let particleIndex = 0;
    let seededWhite = false;

    const coordsIndexes: number[] = [];
    for (let i = 0; i < pixels.length; i += pixelSteps * 4) {
      coordsIndexes.push(i);
    }

    for (let i = coordsIndexes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [coordsIndexes[i], coordsIndexes[j]] = [coordsIndexes[j], coordsIndexes[i]];
    }

    for (const coordIndex of coordsIndexes) {
      const pixelIndex = coordIndex;
      const alpha = pixels[pixelIndex + 3];

      if (alpha > 0) {
        const x = (pixelIndex / 4) % canvas.width;
        const y = Math.floor(pixelIndex / 4 / canvas.width);

        let particle: Particle;

        if (particleIndex < particles.length) {
          particle = particles[particleIndex];
          particle.isKilled = false;
          particleIndex++;
        } else {
          particle = new Particle();

          const randomPos = generateRandomPos(
            canvas.width / 2,
            canvas.height / 2,
            (canvas.width + canvas.height) / 2
          );
          particle.pos.x = randomPos.x;
          particle.pos.y = randomPos.y;

          particle.maxSpeed = Math.random() * 7 + 8;
          particle.maxForce = particle.maxSpeed * 0.072;
          particle.particleSize = Math.random() * 6 + 6;
          particle.colorBlendRate = Math.random() * 0.028 + 0.014;

          particles.push(particle);
        }

        particle.startColor = {
          r: particle.startColor.r + (particle.targetColor.r - particle.startColor.r) * particle.colorWeight,
          g: particle.startColor.g + (particle.targetColor.g - particle.startColor.g) * particle.colorWeight,
          b: particle.startColor.b + (particle.targetColor.b - particle.startColor.b) * particle.colorWeight,
        };
        particle.targetColor = newColor;
        particle.colorWeight = 0;

        particle.target.x = x;
        particle.target.y = y;

        if (seedImmediateWhite && !seededWhite) {
          seededWhite = true;
          particle.startColor = { r: 255, g: 255, b: 255 };
          particle.targetColor = { r: 255, g: 255, b: 255 };
          particle.colorWeight = 1;
          particle.pos.x = x;
          particle.pos.y = y;
          particle.vel.x = 0;
          particle.vel.y = 0;
        }
      }
    }

    for (let i = particleIndex; i < particles.length; i++) {
      particles[i].kill(canvas.width, canvas.height);
    }
  },
  []
);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    /* Hero over WebGL: alpha + dark trail so the city shows through; standalone stays opaque */
    const overScene = variant === "background";
    const ctx = canvas.getContext("2d", { alpha: overScene });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const syncSize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      /* Avoid 0×0 or 1×1 during layout — long phrases need real pixels for glyph sampling */
      canvas.width = Math.max(320, Math.floor(Math.max(w, 1) * dpr));
      canvas.height = Math.max(200, Math.floor(Math.max(h, 1) * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    const syncMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      mouseRef.current.y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    };

    syncSize();
    phraseStepRef.current = 0;
    phrase2StartRef.current = undefined;
    riseAccumRef.current = 0;
    titlePhaseNotifiedRef.current = false;
    nextWord(wordsRef.current[0] ?? HERO_PARTICLE_WORDS[0], canvas, { seedImmediateWhite: true });
    phraseClockRef.current = performance.now();

    if (overScene) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const rafRef = { current: 0 };

    const runFrame = () => {
      const particles = particlesRef.current;
      const list = wordsRef.current;
      const t0 = phraseClockRef.current;
      const elapsed = t0 !== undefined ? performance.now() - t0 : 0;
      const hasTitle = list.length >= 3;

      if (
        list.length >= 2 &&
        phraseStepRef.current === 0 &&
        t0 !== undefined &&
        elapsed >= FIRST_PHRASE_HOLD_MS
      ) {
        phraseStepRef.current = 2;
        nextWord(list[1], canvas);
        phrase2StartRef.current = performance.now();
        ctx.fillStyle = overScene ? "rgba(0, 0, 0, 0.92)" : "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (
        hasTitle &&
        phraseStepRef.current === 2 &&
        phrase2StartRef.current !== undefined &&
        performance.now() - phrase2StartRef.current >= SECOND_PHRASE_HOLD_MS
      ) {
        phraseStepRef.current = 4;
        riseAccumRef.current = 0;
      }

      ctx.fillStyle = overScene ? "rgba(4, 6, 10, 0.26)" : "rgba(0, 0, 0, 0.19)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (phraseStepRef.current === 4 && hasTitle) {
        let minTy = Infinity;
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          if (!p.isKilled) {
            p.target.y -= RISE_PX_PER_FRAME;
            minTy = Math.min(minTy, p.target.y);
          }
        }
        riseAccumRef.current += RISE_PX_PER_FRAME;

        const nearTop =
          minTy !== Infinity && minTy <= canvas.height * (TITLE_TRIGGER_TOP_FRAC + 0.06);
        const riseFallback = riseAccumRef.current > canvas.height * 0.42;

        if (nearTop || riseFallback) {
          phraseStepRef.current = 6;
          nextWord(list[2], canvas, { layout: "upper" });
          ctx.fillStyle = overScene ? "rgba(0, 0, 0, 0.92)" : "#000000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          if (!titlePhaseNotifiedRef.current) {
            titlePhaseNotifiedRef.current = true;
            onTitlePhaseRef.current?.();
          }
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.move();
        particle.draw(ctx, drawAsPoints);

        if (particle.isKilled) {
          if (
            particle.pos.x < 0 ||
            particle.pos.x > canvas.width ||
            particle.pos.y < 0 ||
            particle.pos.y > canvas.height
          ) {
            particles.splice(i, 1);
          }
        }
      }

      if (mouseRef.current.isPressed && mouseRef.current.isRightClick) {
        particles.forEach((particle) => {
          const distance = Math.sqrt(
            Math.pow(particle.pos.x - mouseRef.current.x, 2) +
              Math.pow(particle.pos.y - mouseRef.current.y, 2)
          );
          if (distance < 50) {
            particle.kill(canvas.width, canvas.height);
          }
        });
      }
    };

    const loop = () => {
      runFrame();
      rafRef.current = requestAnimationFrame(loop);
    };

    runFrame();
    rafRef.current = requestAnimationFrame(loop);

    const handleMouseDown = (e: MouseEvent) => {
      mouseRef.current.isPressed = true;
      mouseRef.current.isRightClick = e.button === 2;
      syncMouse(e);
    };

    const handleMouseUp = () => {
      mouseRef.current.isPressed = false;
      mouseRef.current.isRightClick = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      syncMouse(e);
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("contextmenu", handleContextMenu);

    const ro = new ResizeObserver(() => {
      syncSize();
      const list = wordsRef.current;
      const step = phraseStepRef.current;
      let wi = 0;
      let layout: "center" | "upper" = "center";
      if (step === 0) {
        wi = 0;
      } else if (step === 2 || step === 4) {
        wi = 1;
      } else if (step === 6) {
        wi = 2;
        layout = "upper";
      }
      nextWord(list[wi] ?? HERO_PARTICLE_WORDS[0], canvas, {
        layout,
        seedImmediateWhite: step === 0,
      });
      if (step === 4) {
        const acc = riseAccumRef.current;
        for (let i = 0; i < particlesRef.current.length; i++) {
          const p = particlesRef.current[i];
          if (!p.isKilled) p.target.y -= acc;
        }
      }
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [nextWord, words, variant]);

  const isBg = variant === "background";

  return (
    <div
      ref={containerRef}
      className={cn(
        isBg
          ? "pointer-events-none absolute inset-0 h-full w-full overflow-hidden bg-transparent"
          : "flex min-h-screen flex-col items-center justify-center bg-black p-4",
        className
      )}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          isBg
            ? "h-full w-full bg-transparent opacity-100"
            : "max-h-[70vh] rounded-lg border border-gray-800 shadow-2xl",
          "touch-none"
        )}
        style={isBg ? { maxWidth: "100%", height: "100%" } : { maxWidth: "100%", height: "auto" }}
      />
      {!isBg && showHint && (
        <div className="mt-4 max-w-md text-center text-sm text-white">
          <p className="mb-2">NutriPlan.AI particle field</p>
          <p className="text-xs text-gray-400">
            Right-click and hold while moving the mouse to disperse particles • Phrases rotate
            automatically every ~4s
          </p>
        </div>
      )}
    </div>
  );
}
