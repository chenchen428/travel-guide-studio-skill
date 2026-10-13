#!/usr/bin/env python3
"""Rebuild the committed GitHub Pages examples and skill download (Python 3.9+)."""
import hashlib
import re
import shutil
import zipfile
from pathlib import Path
from render import render

root = Path(__file__).resolve().parents[1]
docs = root / 'docs'
docs.mkdir(exist_ok=True)
render(root / 'examples/hangzhou.json', docs / 'hangzhou-guide.html')
render(root / 'examples/suzhou-draft.json', docs / 'suzhou-draft.html')
# A new handbook build must not reuse a cached iframe from the previous release.
version = hashlib.sha256((docs / 'hangzhou-guide.html').read_bytes()).hexdigest()[:12]
index = docs / 'index.html'
index.write_text(re.sub(r'src="hangzhou-guide\.html[^"]*"', f'src="hangzhou-guide.html?v={version}#trip"', index.read_text(encoding='utf-8')), encoding='utf-8')
files = [root / 'SKILL.md']
# Rebuild the online skill directory so retired case assets cannot remain in it.
shutil.rmtree(docs / 'skill', ignore_errors=True)
for folder in ('agents', 'assets', 'references'):
    files.extend(p for p in (root / folder).rglob('*') if p.is_file())
files.append(root / 'scripts/render.py')
for source in files:
    target = docs / 'skill' / source.relative_to(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
archive = docs / 'downloads/travel-guide-studio.zip'
archive.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
    for source in files:
        output.write(source, Path('travel-guide-studio') / source.relative_to(root))
(docs / '.nojekyll').touch()
print('Pages examples, online skill resources and ZIP updated.')
