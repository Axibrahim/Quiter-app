"""
One-time, idempotent codemod that makes Quiter themeable (dark stays pixel-identical).

  python tools/theme_codemod.py

 1. tokens.css / layout.css: white-on-dark tints  rgba(255,255,255,x) -> rgb(var(--tint) / x)
                             drop shadows         rgba(0,0,0,x)       -> rgb(var(--shade) / calc(x * var(--shadow-k)))
                             top catch-lights     inset ... white     -> rgb(var(--catch) / x)
                             solid white/black UI -> var(--ink) / var(--on-ink) ...
 2. every frontend/*.html: adds theme-boot.js (no-flash) + theme-light.css
Run `python tools/pwa_build.py` afterwards so the service worker precaches the new files.
"""
import re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "frontend"
CSS = ROOT / "assets" / "css"

WS = r"\s*"
RGBA_W = re.compile(rf"rgba\({WS}255{WS},{WS}255{WS},{WS}255{WS},{WS}([\d.]+){WS}\)")
RGBA_K_SHADOW = re.compile(rf"(\d+px{WS}\d+px{WS}\d+px(?:{WS}\d+px)?{WS})rgba\({WS}0{WS},{WS}0{WS},{WS}0{WS},{WS}([\d.]+){WS}\)")
RGBA_K_INSET = re.compile(rf"(inset{WS}0{WS}-?\d+px{WS}\d+px{WS})rgba\({WS}0{WS},{WS}0{WS},{WS}0{WS},{WS}([\d.]+){WS}\)")
CATCH = re.compile(rf"(inset{WS}0{WS}1px{WS}[01]px{WS})rgba\({WS}255{WS},{WS}255{WS},{WS}255{WS},{WS}([\d.]+){WS}\)")

# exact literals -> replacement (all must exist at least once the first time)
LITERALS = [
    ("z-index: -2; background: #000;",                       "z-index: -2; background: var(--bg);"),
    ("linear-gradient(90deg, #fff var(--range-progress, 8%)", "linear-gradient(90deg, var(--ink) var(--range-progress, 8%)"),
    ("border-radius: 50%; background: #fff; box-shadow: 0 0 0 5px", "border-radius: 50%; background: var(--ink); box-shadow: 0 0 0 5px"),
    ("border-radius: 50%; background: #fff; border: none; box-shadow", "border-radius: 50%; background: var(--ink); border: none; box-shadow"),
    ("background: #fff; color: #000; border-color: #fff;",   "background: var(--ink); color: var(--on-ink); border-color: var(--ink);"),
    ("background: #fff; color: #000; font-weight: 600;",     "background: var(--ink); color: var(--on-ink); font-weight: 600;"),
    ("linear-gradient(90deg, #fff, var(--accent-teal))",     "linear-gradient(90deg, var(--meter-start), var(--accent-teal))"),
    (".spark circle { fill: #fff; }",                        ".spark circle { fill: var(--ink); }"),
    ("linear-gradient(180deg, #fff, rgb(var(--tint) / .35))", "linear-gradient(180deg, var(--ink), rgb(var(--tint) / .35))"),   # runs after the rgba pass
    (".spot__dot.is-on { width: 26px; background: #fff; }",  ".spot__dot.is-on { width: 26px; background: var(--ink); }"),
    ("outline: 1.5px solid #fff;",                           "outline: 1.5px solid var(--ink);"),
    (".field select option { background: #12121a; }",        ".field select option { background: var(--option-bg); }"),
    (".btn--solid { background: var(--ink); color: #000;",   ".btn--solid { background: var(--ink); color: var(--on-ink);"),
]

DARK_TOKENS = """  color-scheme: dark;
  /* theme plumbing: the light theme (theme-light.css) only overrides these */
  --tint: 255 255 255;     /* "ink" tint used for fills, borders and hovers   */
  --shade: 0 0 0;          /* drop-shadow colour                               */
  --catch: 255 255 255;    /* glass catch-light                                */
  --shadow-k: 1;           /* drop-shadow strength multiplier                  */
  --on-ink: #000000;       /* text on top of a solid --ink surface             */
  --meter-start: #ffffff;
  --option-bg: #12121a;
"""

def convert(text):
    text = CATCH.sub(lambda m: f"{m.group(1)}rgb(var(--catch) / {m.group(2)})", text)
    text = RGBA_W.sub(lambda m: f"rgb(var(--tint) / {m.group(1)})", text)
    text = RGBA_K_SHADOW.sub(lambda m: f"{m.group(1)}rgb(var(--shade) / calc({m.group(2)} * var(--shadow-k)))", text)
    text = RGBA_K_INSET.sub(lambda m: f"{m.group(1)}rgb(var(--shade) / calc({m.group(2)} * var(--shadow-k)))", text)
    for old, new in LITERALS:
        text = text.replace(old, new)
    return text

def main():
    if "--tint" in (CSS / "tokens.css").read_text(encoding="utf-8"):
        print("CSS already converted - skipping CSS step")
    else:
        for name in ("tokens.css", "layout.css"):
            p = CSS / name
            with open(p, encoding="utf-8", newline="") as fh:
                before = fh.read()
            after = convert(before)
            if name == "tokens.css":
                nl = "\r\n" if "\r\n" in after else "\n"
                after = after.replace(":root {", ":root {" + nl + DARK_TOKENS.replace("\n", nl), 1)
            with open(p, "w", encoding="utf-8", newline="") as fh:
                fh.write(after)
            print(f"{name}: {len(before)} -> {len(after)} bytes")

    # inline white tints outside the stylesheets (heatmap "no entry" cell + its legend swatch)
    for rel in ("assets/js/progress.js", "progress.html"):
        f = ROOT / rel
        with open(f, encoding="utf-8", newline="") as fh:
            t = fh.read()
        t2 = RGBA_W.sub(lambda m: f"rgb(var(--tint) / {m.group(1)})", t)
        if t2 != t:
            with open(f, "w", encoding="utf-8", newline="") as fh:
                fh.write(t2)
            print("patched", rel)

    boot = '<script src="assets/js/theme-boot.js"></script>'
    link = '<link rel="stylesheet" href="assets/css/theme-light.css">'
    for html in sorted(ROOT.glob("*.html")):
        with open(html, encoding="utf-8", newline="") as fh:
            s = fh.read()
        o = s
        if "theme-boot.js" not in s:
            s = re.sub(r'(<meta name="theme-color"[^>]*>)', r"\1\n" + boot, s, count=1)
        if "theme-light.css" not in s:
            s = re.sub(r'(<link rel="stylesheet" href="assets/css/layout.css">)', r"\1\n" + link, s, count=1)
        if s != o:
            with open(html, "w", encoding="utf-8", newline="") as fh:
                fh.write(s)
            print("patched", html.name)

if __name__ == "__main__":
    sys.exit(main())