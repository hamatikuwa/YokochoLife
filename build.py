#!/usr/bin/env python3
"""src/ の index.html + style.css + game.js + lib/three.min.js を、
GitHub Pages でそのまま配信できる単一ファイル index.html に結合する。

使い方: python3 build.py
"""
import pathlib

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"


def main():
    html = (SRC / "index.html").read_text(encoding="utf-8")
    css = (SRC / "style.css").read_text(encoding="utf-8")
    three = (SRC / "lib" / "three.min.js").read_text(encoding="utf-8")
    game = (SRC / "game.js").read_text(encoding="utf-8")

    assert "</script" not in three
    assert "</script" not in game
    assert "</style" not in css

    html = html.replace(
        '<link rel="stylesheet" href="style.css">', f"<style>\n{css}\n</style>"
    )
    html = html.replace(
        '<script src="lib/three.min.js"></script>\n<script src="game.js"></script>',
        f"<script>\n{three}\n</script>\n<script>\n{game}\n</script>",
    )

    out = ROOT / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({len(html.encode('utf-8')):,} bytes)")


if __name__ == "__main__":
    main()
