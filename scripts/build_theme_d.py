#!/usr/bin/env python3
"""Genera theme-d.css desde theme-d.src.css.

En el fuente, cada selector que empieza por «@» recibe el prefijo del diseño D, con prioridad
suficiente para ganar a las hojas anteriores (que encadenan :not(#id)). Así el diseño D solo se
aplica con html[data-design="d"] y el «diseño clásico» queda intacto al desactivarlo.
"""
import re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
PRE = 'html[data-design="d"]:root:root body:not(#d1):not(#d2):not(#d3):not(#d4):not(#d5):not(#d6)'
PRE_LIGHT = 'html[data-design="d"][data-theme="light"]:root:root body:not(#d1):not(#d2):not(#d3):not(#d4):not(#d5):not(#d6)'
PRE_DARK = 'html[data-design="d"]:not([data-theme="light"]):root:root body:not(#d1):not(#d2):not(#d3):not(#d4):not(#d5):not(#d6)'
src = (ROOT / 'theme-d.src.css').read_text(encoding='utf-8')
def fix(sel):
    sel = sel.strip()
    for tok, pre in (('@light', PRE_LIGHT), ('@dark', PRE_DARK), ('@', PRE)):
        if sel.startswith(tok):
            rest = sel[len(tok):].strip()
            # «@body» se refiere al propio body.
            if rest.startswith('body'):
                return pre + rest[4:]
            return pre + ' ' + rest.strip() if rest.strip() else pre
    return sel
out = []
for block in re.split(r'(\{[^{}]*\})', src):
    if block.startswith('{'):
        out.append(block); continue
    # Lo que precede al selector (comentarios, «@media …{», «}» de cierre) se copia tal cual.
    cut = max(block.rfind('*/') + 2 if '*/' in block else 0, block.rfind('{') + 1, block.rfind('}') + 1)
    head, sels = block[:cut], block[cut:]
    if sels.strip().startswith('@') and not re.match(r'\s*@(font-face|media|supports|keyframes)', sels):
        lead = sels[:len(sels) - len(sels.lstrip())]
        sels = lead + ',\n'.join(fix(x) for x in sels.split(',')) + ' '
    out.append(head + sels)
header = '/* Generado por scripts/build_theme_d.py desde theme-d.src.css: no editar a mano. */\n'
(ROOT / 'theme-d.css').write_text(header + ''.join(out), encoding='utf-8')
print('theme-d.css', len(''.join(out)), 'bytes')
