"use client";

// The site cat from the original landing page. Static HTML first; GSAP and
// ScrollTrigger load after the page is idle, and never when the visitor
// prefers reduced motion. Smooth scrolling is site-wide (motion/smooth-scroll.tsx),
// which keeps ScrollTrigger in step with it.
import { useEffect, useRef } from "react";
import { CAT, type CatMood } from "@/lib/cat";

const TONE_VAR = { blue: "var(--blue)", green: "var(--green)", orange: "var(--orange)", amber: "var(--amber)" } as const;

export function CatCompanion() {
  const root = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !matchMedia("(min-width: 1024px)").matches) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    const idle = (cb: () => void) =>
      "requestIdleCallback" in window ? requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 1200);
    idle(async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
      if (cancelled || !root.current) return;
      cleanup = await start(gsap, ScrollTrigger, root.current);
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const c = CAT.ready;
  return (
    <button
      ref={root}
      type="button"
      aria-label="Play with Holt, the site cat"
      data-cat-companion
      // One hover target sized to the whole face, above the hero text layer.
      // It starts bottom right of the first screen, beside the short rows
      // under the paste box: the full-scale headline and kicker fill the top.
      className="pointer-events-auto absolute z-20 hidden origin-top-left p-5 text-blue [touch-action:manipulation] lg:fixed lg:bottom-[8svh] lg:right-[3vw] lg:inline-block lg:opacity-85 lg:will-change-transform"
    >
      <span className="cat-character inline-block">
        <span
          className="cat-face text-[1.5rem] lg:text-[clamp(2.4rem,3.4vw,3.4rem)]"
          data-cat-face
          style={{ textShadow: "0 0 28px color-mix(in oklab, var(--blue) 25%, transparent)" }}
        >
          <span>(=</span>
          <span className="cat-ear">{c.ears[0]}</span>
          <span className="cat-eye" data-cat-eye>{c.eyes[0]}</span>
          <span className="cat-mouth" data-cat-mouth>{c.mouth}</span>
          <span className="cat-eye" data-cat-eye>{c.eyes[1]}</span>
          <span className="cat-ear">{c.ears[1]}</span>
          <span>=)</span>
        </span>
      </span>
    </button>
  );
}

type Gsap = typeof import("gsap").gsap;
type ST = typeof import("gsap/ScrollTrigger").ScrollTrigger;

const POSE: Partial<Record<CatMood, string>> = {
  ready: "curious",
  startled: "startled",
  heartbroken: "heartbroken",
  determined: "determined",
  celebrating: "celebrating",
  adoring: "adoring",
};

async function start(gsap: Gsap, ScrollTrigger: ST, cat: HTMLButtonElement) {
  gsap.registerPlugin(ScrollTrigger);
  const character = cat.querySelector<HTMLElement>(".cat-character")!;
  const face = cat.querySelector<HTMLElement>("[data-cat-face]")!;
  const eyes = [...cat.querySelectorAll<HTMLElement>("[data-cat-eye]")];
  const mouth = cat.querySelector<HTMLElement>("[data-cat-mouth]")!;
  const ears = [...cat.querySelectorAll<HTMLElement>(".cat-ear")];
  const desktop = matchMedia("(min-width: 1024px)").matches;
  let current: CatMood = "ready";
  let hovered = false;
  let reaction: number | undefined;

  const glyphs = (m: CatMood) => {
    const s = CAT[m];
    eyes.forEach((e, i) => (e.textContent = s.eyes[i]));
    ears.forEach((e, i) => (e.textContent = s.ears[i]));
    mouth.textContent = s.mouth;
  };

  const pose = (name?: string) => {
    gsap.killTweensOf([face, ears, eyes, mouth]);
    gsap.set([face, eyes, mouth, ears], { clearProps: "x,y,rotation,scale,scaleX,scaleY" });
    const t = gsap.timeline();
    if (name === "curious") t.fromTo(face, { rotation: -4, y: 2 }, { rotation: 3, y: 0, duration: 0.38, ease: "power2.out" });
    if (name === "startled") t.fromTo(face, { y: 5, scale: 0.94 }, { y: -5, scale: 1.04, duration: 0.22 }).to(face, { y: 0, scale: 1, duration: 0.3 });
    if (name === "heartbroken")
      t.to(ears, { y: 3, rotation: (i: number) => (i ? -8 : 8), duration: 0.3 }).to(face, { y: 5, rotation: -3, duration: 0.4 }, 0);
    if (name === "determined") t.fromTo(face, { x: -3 }, { x: 3, duration: 0.12, yoyo: true, repeat: 1 }).to(face, { x: 0, duration: 0.2 });
    if (name === "celebrating") t.fromTo(face, { y: 3, scaleY: 0.92 }, { y: -7, scaleY: 1.04, duration: 0.22 }).to(face, { y: 0, scaleY: 1, duration: 0.3 });
    if (name === "adoring") t.fromTo(face, { scale: 0.96, rotation: -3 }, { scale: 1.03, rotation: 3, duration: 0.28, yoyo: true, repeat: 1, ease: "sine.inOut" });
  };

  const setMood = (m: CatMood) => {
    if (!CAT[m] || m === current) return;
    current = m;
    gsap.killTweensOf([face, eyes, mouth, ears]);
    gsap
      .timeline()
      .to(face, { scaleX: 1.14, scaleY: 0.62, y: 5, duration: 0.12, ease: "power2.in" })
      .add(() => glyphs(m))
      .to(cat, { color: TONE_VAR[CAT[m].tone], duration: 0.28 }, 0)
      .to(face, { scaleX: 1, scaleY: 1, y: 0, duration: 0.3, ease: "power2.out" })
      .add(() => pose(POSE[m]));
  };

  // Idle life: blink or twitch ears every few seconds.
  let idleCall: gsap.core.Tween | undefined;
  const idle = () => {
    if (!hovered) {
      if (Math.random() < 0.5) gsap.to(eyes, { scaleY: 0.08, duration: 0.07, yoyo: true, repeat: 1 });
      else
        gsap
          .timeline()
          .to(ears, { y: -3, rotation: (i: number) => (i === 0 ? -6 : 6), duration: 0.15 })
          .to(ears, { y: 0, rotation: 0, duration: 0.25 });
    }
    idleCall = gsap.delayedCall(gsap.utils.random(2.4, 4), idle);
  };
  idleCall = gsap.delayedCall(1.5, idle);

  const restore = () => {
    window.clearTimeout(reaction);
    face.classList.remove("is-happy");
    glyphs(current);
    gsap.to(character, { scale: 1, x: 0, y: 0, rotation: 0, duration: 0.28 });
  };
  const onEnter = () => {
    hovered = true;
    // Caret eyes are wider than the dots they replace: give them room so they
    // don't run into the ears (see .cat-face.is-happy).
    face.classList.add("is-happy");
    eyes.forEach((e) => (e.textContent = "^"));
    mouth.textContent = "ᴗ";
    gsap.to(character, { scale: 1.04, duration: 0.2 });
    gsap.to(ears, { y: -3, rotation: (i: number) => (i ? 3 : -3), duration: 0.2 });
  };
  const onLeave = () => {
    hovered = false;
    restore();
    gsap.to(ears, { y: 0, rotation: 0, duration: 0.2 });
  };
  const onClick = () => {
    window.clearTimeout(reaction);
    eyes.forEach((e) => (e.textContent = "♥"));
    mouth.textContent = "ᴗ";
    gsap
      .timeline()
      .fromTo(character, { scaleX: 1.06, scaleY: 0.9 }, { scaleX: 0.98, scaleY: 1.06, y: -6, duration: 0.18 })
      .to(character, { scaleX: 1.04, scaleY: 1.04, y: 0, duration: 0.26 });
    reaction = window.setTimeout(restore, 850);
  };
  cat.addEventListener("pointerenter", onEnter);
  cat.addEventListener("pointerleave", onLeave);
  cat.addEventListener("click", onClick);

  // Eyes follow the pointer on desktop.
  let onMove: ((e: PointerEvent) => void) | undefined;
  if (matchMedia("(pointer: fine)").matches) {
    const cx = gsap.quickTo(character, "x", { duration: 0.55, ease: "power3.out" });
    const cy = gsap.quickTo(character, "y", { duration: 0.55, ease: "power3.out" });
    const ex = gsap.quickTo(eyes, "x", { duration: 0.16 });
    const ey = gsap.quickTo(eyes, "y", { duration: 0.16 });
    onMove = (e) => {
      const r = cat.getBoundingClientRect();
      const x = gsap.utils.clamp(-1, 1, (e.clientX - (r.left + r.width / 2)) / (innerWidth * 0.3));
      const y = gsap.utils.clamp(-1, 1, (e.clientY - (r.top + r.height / 2)) / (innerHeight * 0.3));
      cx(x * 10);
      cy(y * 7);
      ex(x * 5.5);
      ey(y * 3.5);
    };
    addEventListener("pointermove", onMove);
  }

  // Mood follows the section in view.
  const sections = gsap.utils.toArray<HTMLElement>("[data-cat-section]");
  const triggers = sections.map((s) =>
    ScrollTrigger.create({
      trigger: s,
      start: "top 56%",
      end: "bottom 56%",
      onEnter: () => setMood(s.dataset.catSection as CatMood),
      onEnterBack: () => setMood(s.dataset.catSection as CatMood),
    }),
  );

  // Desktop: the cat walks from the hero to the right edge and stays with you.
  // Timed, not scrubbed: tied to scroll position, the cat jumped with every
  // wheel notch (up to ~50px a frame). Crossing the hero's top plays one glide;
  // scrolling back to the top plays it backwards.
  let journey: gsap.core.Timeline | undefined;
  let journeyTrigger: ReturnType<ST["create"]> | undefined;
  let dockTrigger: ReturnType<ST["create"]> | undefined;
  let stopDock: (() => void) | undefined;
  const root = document.documentElement;
  if (desktop) {
    const r = cat.getBoundingClientRect();
    const compact = innerWidth < 1180;
    const side = { x: innerWidth - (compact ? 118 : 156) - r.left, y: innerHeight * 0.5 - 62 - r.top, scale: compact ? 0.36 : 0.43 };
    journey = gsap.timeline({ paused: true }).to(cat, {
      ...side,
      opacity: 0.92,
      duration: 0.9,
      ease: "power3.inOut",
      force3D: true,
    });
    journeyTrigger = ScrollTrigger.create({
      trigger: "[data-hero]",
      start: "top top",
      onEnter: () => journey!.play(),
      onLeaveBack: () => journey!.reverse(),
    });

    // The end of the walk: one cat, not two. As the footer comes up, the cat
    // glides down into the footer cat's spot (top right) and becomes it; the
    // footer's own cat stays hidden until then (globals.css, data-cat-away).
    // Scrolling back up, it lifts out and carries on at the side. The target
    // moves with the page while it glides, so each frame chases where the
    // spot is now rather than where it was.
    const spot = document.querySelector<HTMLElement>("[data-footer-cat]");
    const footerFace = spot?.querySelector<HTMLElement>(".rcat-face");
    if (spot && footerFace) {
      root.dataset.catAway = "";
      const glide = (to: () => { x: number; y: number; scale: number }, done: () => void) => {
        stopDock?.();
        const from = { x: Number(gsap.getProperty(cat, "x")), y: Number(gsap.getProperty(cat, "y")), scale: Number(gsap.getProperty(cat, "scale")) };
        const ease = gsap.parseEase("power3.inOut");
        const t0 = performance.now();
        let raf = requestAnimationFrame(function step(now) {
          const k = Math.min(1, (now - t0) / 700);
          const e = ease(k);
          const t = to();
          gsap.set(cat, { x: from.x + (t.x - from.x) * e, y: from.y + (t.y - from.y) * e, scale: from.scale + (t.scale - from.scale) * e });
          if (k < 1) raf = requestAnimationFrame(step);
          else {
            stopDock = undefined;
            done();
          }
        });
        stopDock = () => cancelAnimationFrame(raf);
      };
      // Where the companion must be for its face to sit exactly on the
      // footer's: same width, same centre (the two faces' line boxes differ,
      // so corners don't line up but centres do).
      const onSpot = () => {
        const s = Number(gsap.getProperty(cat, "scale"));
        const x = Number(gsap.getProperty(cat, "x"));
        const y = Number(gsap.getProperty(cat, "y"));
        const box = cat.getBoundingClientRect();
        const f = face.getBoundingClientRect();
        const t = footerFace.getBoundingClientRect();
        const origin = { left: box.left - x, top: box.top - y };
        const mid = { x: (f.left + f.width / 2 - box.left) / s, y: (f.top + f.height / 2 - box.top) / s };
        const scale = t.width / (f.width / s);
        return { x: t.left + t.width / 2 - mid.x * scale - origin.left, y: t.top + t.height / 2 - mid.y * scale - origin.top, scale };
      };
      const dock = () => {
        journey!.progress(1);
        gsap.set(cat, { autoAlpha: 0.92 });
        // Drop the pointer lean, so the face lands exactly on the spot.
        gsap.to(character, { x: 0, y: 0, rotation: 0, duration: 0.3 });
        glide(onSpot, () => {
          delete root.dataset.catAway;
          gsap.set(cat, { autoAlpha: 0 });
          // Replay the landing squash on the footer's cat.
          delete spot.dataset.landed;
          void spot.offsetWidth;
          spot.dataset.landed = "";
        });
      };
      const undock = () => {
        root.dataset.catAway = "";
        gsap.set(cat, { autoAlpha: 0.92 });
        glide(() => side, () => {});
      };
      dockTrigger = ScrollTrigger.create({ trigger: spot, start: "top 78%", onEnter: dock, onLeaveBack: undock });
      // Arrived with the footer already in view (a reload at the bottom).
      if (dockTrigger.isActive || dockTrigger.progress > 0) dock();
    }
  }

  // Scroll reveals for anything still below the fold: short, small and started
  // as the element enters, so fast scrolling never lands on a blank section.
  const reveals = gsap.utils
    .toArray<HTMLElement>("[data-reveal]")
    .filter((el) => el.getBoundingClientRect().top > innerHeight * 0.9)
    .map((el) =>
      gsap.from(el, { y: 12, autoAlpha: 0, duration: 0.45, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 98%", once: true } }),
    );

  return () => {
    idleCall?.kill();
    triggers.forEach((t) => t.kill());
    journeyTrigger?.kill();
    journey?.kill();
    dockTrigger?.kill();
    stopDock?.();
    delete root.dataset.catAway;
    reveals.forEach((r) => {
      r.scrollTrigger?.kill();
      r.revert();
    });
    if (onMove) removeEventListener("pointermove", onMove);
    cat.removeEventListener("pointerenter", onEnter);
    cat.removeEventListener("pointerleave", onLeave);
    cat.removeEventListener("click", onClick);
    gsap.set(cat, { clearProps: "all" });
  };
}
