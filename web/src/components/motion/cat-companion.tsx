"use client";

// The site cat from the original landing page. Static HTML first; GSAP and
// ScrollTrigger load after the page is idle, and never when the visitor
// prefers reduced motion. Smooth scrolling is site-wide (motion/smooth-scroll.tsx),
// which keeps ScrollTrigger in step with it.
//
// On desktop it starts top right of the hero, walks to the side as you
// scroll and changes mood with each section. At the end of the page it glides
// into the footer cat's spot and becomes it (one cat, not two); scrolling
// back up, it lifts out again.
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
      // Where it starts: globals.css, [data-cat-companion].
      className="pointer-events-auto absolute z-20 hidden origin-top-left p-5 text-blue [touch-action:manipulation] lg:fixed lg:inline-block lg:opacity-85 lg:will-change-transform"
    >
      <span className="cat-character inline-block">
        <span
          className="cat-face text-[1.5rem] lg:text-[clamp(2rem,min(3.4vw,5.6svh),3.4rem)]"
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
  let section: CatMood = "ready";
  // "out": walking with you; "docking"/"docked": gliding into, or sitting in,
  // the footer cat's spot; "undocking": lifting back out.
  let away: "out" | "docking" | "docked" | "undocking" = "out";
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
      if (away !== "out") return; // no lean while it docks into the footer
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

  // Mood follows the section in view (while it's out, not docked).
  const onSection = (m: CatMood) => {
    section = m;
    if (away === "out" || away === "undocking") setMood(m);
  };
  const sections = gsap.utils.toArray<HTMLElement>("[data-cat-section]");
  const triggers = sections.map((s) =>
    ScrollTrigger.create({
      trigger: s,
      start: "top 56%",
      end: "bottom 56%",
      onEnter: () => onSection(s.dataset.catSection as CatMood),
      onEnterBack: () => onSection(s.dataset.catSection as CatMood),
    }),
  );

  // Desktop: the cat walks from the hero to the right edge and stays with you.
  // Timed, not scrubbed: tied to scroll position, the cat jumped with every
  // wheel notch (up to ~50px a frame). Crossing the hero's top plays one glide;
  // scrolling back to the top plays it backwards.
  let journey: gsap.core.Timeline | undefined;
  let journeyTrigger: ReturnType<ST["create"]> | undefined;
  let dockTrigger: ReturnType<ST["create"]> | undefined;
  let stopGlide: (() => void) | undefined;
  const root = document.documentElement;
  if (desktop) {
    const home = cat.getBoundingClientRect();
    const compact = innerWidth < 1180;
    const side = { x: innerWidth - (compact ? 118 : 156) - home.left, y: innerHeight * 0.5 - 62 - home.top, scale: compact ? 0.36 : 0.43 };
    journey = gsap.timeline({ paused: true }).to(cat, { ...side, opacity: 0.92, duration: 0.9, ease: "power3.inOut", force3D: true });
    journeyTrigger = ScrollTrigger.create({
      trigger: "[data-hero]",
      start: "top top",
      onEnter: () => journey!.play(),
      onLeaveBack: () => {
        stopGlide?.();
        journey!.reverse();
      },
    });

    // The end of the walk. The companion is fixed and the footer cat scrolls
    // with the page, so the glide chases where the spot is on each frame. It
    // runs on GSAP's ticker, after Lenis has moved the page for that frame, so
    // the two never drift apart. The face's box is measured once, now, before
    // any pose or lean: per-frame reads of a moving face would shake the target.
    const spot = document.querySelector<HTMLElement>("[data-footer-cat]");
    const spotFace = spot?.querySelector<HTMLElement>(".rcat-face");
    if (spot && spotFace) {
      const f = face.getBoundingClientRect();
      const off = { x: f.left - home.left + f.width / 2, y: f.top - home.top + f.height / 2, w: f.width };
      // The transform (origin top left) that puts this face's centre on the footer face's, at its width.
      const onSpot = () => {
        const t = spotFace.getBoundingClientRect();
        const scale = t.width / off.w;
        return { x: t.left + t.width / 2 - off.x * scale - home.left, y: t.top + t.height / 2 - off.y * scale - home.top, scale };
      };
      const glide = (to: () => { x: number; y: number; scale: number }, done: () => void) => {
        stopGlide?.();
        const from = { x: Number(gsap.getProperty(cat, "x")), y: Number(gsap.getProperty(cat, "y")), scale: Number(gsap.getProperty(cat, "scale")) };
        const ease = gsap.parseEase("power3.inOut");
        const t0 = gsap.ticker.time;
        const tick = () => {
          const k = Math.min(1, (gsap.ticker.time - t0) / 0.8);
          const e = ease(k);
          const t = to();
          gsap.set(cat, { x: from.x + (t.x - from.x) * e, y: from.y + (t.y - from.y) * e, scale: from.scale + (t.scale - from.scale) * e, force3D: true });
          if (k < 1) return;
          stop();
          done();
        };
        const stop = () => {
          gsap.ticker.remove(tick);
          stopGlide = undefined;
        };
        gsap.ticker.add(tick);
        stopGlide = stop;
      };
      // The footer's own cat hides while this one is out and about.
      root.dataset.catAway = "";
      const dock = () => {
        if (away === "docking" || away === "docked") return;
        away = "docking";
        journey!.pause();
        gsap.to(character, { x: 0, y: 0, rotation: 0, duration: 0.3 });
        gsap.to(cat, { autoAlpha: 1, duration: 0.3 });
        setMood("ready"); // the footer cat's resting face
        glide(onSpot, () => {
          away = "docked";
          delete root.dataset.catAway;
          gsap.set(cat, { autoAlpha: 0 });
          // Replay the landing squash on the footer's cat.
          delete spot.dataset.landed;
          void spot.offsetWidth;
          spot.dataset.landed = "";
        });
      };
      const undock = () => {
        if (away === "out" || away === "undocking") return;
        // Settled: lift out from exactly where the footer cat is now.
        if (away === "docked") gsap.set(cat, { ...onSpot(), autoAlpha: 1 });
        away = "undocking";
        root.dataset.catAway = "";
        setMood(section);
        gsap.to(cat, { opacity: 0.92, duration: 0.5 });
        glide(
          () => side,
          () => {
            away = "out";
            // The walk's end state is where it is now, so scrolling to the top reverses cleanly.
            journey!.progress(1).pause();
          },
        );
      };
      dockTrigger = ScrollTrigger.create({ trigger: spot, start: "top 80%", onEnter: dock, onLeaveBack: undock });
      // Arrived with the footer already in view (a reload at the bottom).
      if (dockTrigger.progress > 0) dock();
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
    stopGlide?.();
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
