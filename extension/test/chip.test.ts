import { chipView, ensureChip, findAnchor, removeChips, statLine, updateChip } from "../src/chip";
import { legacyRepoHeader, report, repoHeader } from "./helpers";

const flask = { owner: "pallets", repo: "flask" };

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("chipView", () => {
  it("shows the verdict headline and one stat", () => {
    const v = chipView({ state: "found", data: report() }, flask);
    expect(v.label).toBe("Holt: Worth your time");
    expect(v.stat).toBe("15 of 100 outside PRs merged");
    expect(v.tone).toBe("good");
  });

  it("shows the server's headline and tone, never its own reading of the verdict", () => {
    const v = chipView({ state: "found", data: report({ verdict: "not_viable", headline: "Not worth your time", tone: "bad" }) }, flask);
    expect(v.label).toBe("Holt: Not worth your time");
    expect(v.tone).toBe("bad");
    const w = chipView({ state: "found", data: report({ verdict: "insufficient_evidence", headline: "Not enough evidence", tone: "warn" }) }, flask);
    expect(w.tone).toBe("warn");
  });

  it("uses the neutral colour when a cached response has no tone yet", () => {
    const v = chipView({ state: "found", data: report({ tone: undefined }) }, flask);
    expect(v.label).toBe("Holt: Worth your time");
    expect(v.tone).toBe("unknown");
    expect(chipView({ state: "found", data: report({ tone: "purple" as never }) }, flask).tone).toBe("unknown");
  });

  it("says 'Check with Holt' when nothing is cached, on errors and without a usable headline", () => {
    expect(chipView({ state: "missing" }, flask).label).toBe("Check with Holt");
    expect(chipView({ state: "error" }, flask).label).toBe("Check with Holt");
    for (const headline of [undefined, "", 42, "x".repeat(61)]) {
      expect(chipView({ state: "found", data: report({ headline: headline as never }) }, flask).label).toBe("Check with Holt");
    }
  });
});

describe("statLine", () => {
  it("handles singular, zero and missing counts", () => {
    expect(statLine(report({ stats: { outsider_attempts: 1, outsider_merged: 0 } }))).toBe("0 of 1 outside PR merged");
    expect(statLine(report({ stats: { outsider_attempts: 0, outsider_merged: 0 } }))).toBeNull();
    expect(statLine(report({ stats: null }))).toBeNull();
    expect(statLine(report({ stats: { outsider_attempts: 3 } }))).toBeNull();
  });

  it("shows the server's stat_line when it sends one", () => {
    expect(statLine(report({ stat_line: "22 of 120 outside PRs merged" }))).toBe("22 of 120 outside PRs merged");
    expect(statLine(report({ stat_line: null }))).toBeNull();
    // Anything that isn't a short sentence falls back to the counts.
    expect(statLine(report({ stat_line: "x".repeat(61) }))).toBe("15 of 100 outside PRs merged");
  });
});

describe("ensureChip", () => {
  it("appends to the repo title in the current layout", () => {
    document.body.innerHTML = repoHeader();
    const chip = ensureChip(document, flask, { state: "found", data: report() })!;
    expect(chip.parentElement!.id).toBe("repo-title-component");
    expect(chip.href).toBe("https://githolt.com/pallets/flask");
    expect(chip.target).toBe("_blank");
    expect(chip.rel).toContain("noopener");
    expect(chip.textContent).toBe("Holt: Worth your time15 of 100 outside PRs merged");
    expect(chip.getAttribute("aria-label")).toBe("Holt: Worth your time. 15 of 100 outside PRs merged.");
  });

  it("goes right after the repo name in the legacy layout", () => {
    document.body.innerHTML = legacyRepoHeader();
    const chip = ensureChip(document, flask, { state: "missing" })!;
    expect(chip.previousElementSibling!.getAttribute("itemprop")).toBe("name");
    expect(chip.textContent).toBe("Check with Holt");
    expect(chip.querySelector<HTMLElement>(".holt-chip__stat")!.hidden).toBe(true);
  });

  it("does nothing when the page has no repo title", () => {
    document.body.innerHTML = "<main><h1>Explore</h1></main>";
    expect(findAnchor(document)).toBeNull();
    expect(ensureChip(document, flask, { state: "loading" })).toBeNull();
    expect(document.querySelector(".holt-chip")).toBeNull();
  });

  it("is idempotent", () => {
    document.body.innerHTML = repoHeader();
    const a = ensureChip(document, flask, { state: "loading" });
    const b = ensureChip(document, { owner: "Pallets", repo: "Flask" }, { state: "loading" });
    expect(b).toBe(a);
    expect(document.querySelectorAll(".holt-chip")).toHaveLength(1);
  });

  it("replaces a chip left over from another repo", () => {
    document.body.innerHTML = repoHeader();
    ensureChip(document, flask, { state: "loading" });
    ensureChip(document, { owner: "NixOS", repo: "nixpkgs" }, { state: "loading" });
    const chips = document.querySelectorAll<HTMLElement>(".holt-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0].dataset.holtRepo).toBe("nixos/nixpkgs");
  });

  it("never interprets report text as HTML", () => {
    document.body.innerHTML = repoHeader();
    const chip = ensureChip(document, flask, { state: "loading" })!;
    updateChip(chip, { owner: "pallets", repo: "<img src=x onerror=alert(1)>" }, { state: "missing" });
    expect(chip.querySelector("img")).toBeNull();
  });

  it("updates in place from loading to a verdict", () => {
    document.body.innerHTML = repoHeader();
    const chip = ensureChip(document, flask, { state: "loading" })!;
    expect(chip.dataset.holtState).toBe("loading");
    updateChip(chip, flask, { state: "found", data: report({ verdict: "insufficient_evidence", headline: "Not enough evidence", tone: "warn" }) });
    expect(chip.dataset.holtTone).toBe("warn");
    expect(chip.textContent).toContain("Not enough evidence");
  });

  it("removeChips clears every chip", () => {
    document.body.innerHTML = repoHeader();
    ensureChip(document, flask, { state: "loading" });
    removeChips(document);
    expect(document.querySelector(".holt-chip")).toBeNull();
  });
});

describe("the loading skeleton", () => {
  it("keeps the real words, marks the chip busy, and clears it on a verdict", () => {
    document.body.innerHTML = repoHeader();
    const chip = ensureChip(document, flask, { state: "loading" })!;
    expect(chip.dataset.holtState).toBe("loading");
    expect(chip.getAttribute("aria-busy")).toBe("true");
    // The label and stat carry the text that sizes the pill; content.css draws
    // them as blocks, so the chip is as wide and tall as a real one.
    expect(chip.querySelector(".holt-chip__label")!.textContent).toBe("Holt");
    expect(chip.querySelector<HTMLElement>(".holt-chip__stat")!.hidden).toBe(false);
    expect(chip.querySelector(".holt-chip__stat")!.textContent).toBe("checking…");
    expect(chip.getAttribute("aria-label")).toBe("Holt. checking….");

    updateChip(chip, flask, { state: "found", data: report() });
    expect(chip.dataset.holtState).toBe("found");
    expect(chip.hasAttribute("aria-busy")).toBe(false);
    // Same elements, so the CSS transition on them crossfades block → text.
    expect(chip.querySelector(".holt-chip__label")!.textContent).toBe("Holt: Worth your time");
  });

  it("is not busy when the verdict is already known", () => {
    document.body.innerHTML = repoHeader();
    const chip = ensureChip(document, flask, { state: "missing" })!;
    expect(chip.hasAttribute("aria-busy")).toBe(false);
  });
});
