"""Prepare pinned MIT inputs without cloning the full Rocketbox library.

Requires Pillow in the project's Python environment. Source files are cached
in .tmp; this script never modifies the original RHODA character assets.
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from PIL import Image

root = Path(__file__).resolve().parents[1]
credit = json.loads((root / "public/gltf/lab-companion.credit.json").read_text())
source = root / ".tmp/deep-avatar/rocketbox-source"
source.mkdir(parents=True, exist_ok=True)


def fetch(entry):
    destination = source / entry["local"]
    if destination.exists() and sha256(destination.read_bytes()).hexdigest() == entry["sha256"]:
        return
    request = Request(credit["sourceBase"] + quote(entry["path"]), headers={"User-Agent": "RHODA-model-preparation"})
    with urlopen(request, timeout=90) as response:
        data = response.read()
    if sha256(data).hexdigest() != entry["sha256"]:
        raise RuntimeError("Pinned source hash mismatch: " + entry["path"])
    destination.write_bytes(data)


# Check and preserve the required notice before fetching model inputs.
license_entry = next(entry for entry in credit["sourceFiles"] if entry["local"] == "LICENSE.md")
fetch(license_entry)
assert "MIT License" in (source / "LICENSE.md").read_text()
with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(fetch, [entry for entry in credit["sourceFiles"] if entry != license_entry]))

for path in source.glob("m152_*.tga"):
    # FBX images use a bottom-left origin; glTF uses top-left.
    image = Image.open(path).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    image.save(path.with_suffix(".png"))
    if path.stem in ("m152_body_color", "m152_head_color"):
        image.convert("RGB").save(path.with_suffix(".jpg"), quality=92, subsampling=0)
    if path.stem == "m152_opacity_color":
        image.thumbnail((512, 512), Image.Resampling.LANCZOS)
        image.save(source / "m152_opacity_color_512.png")
print("Pinned MIT model, three native clips and four texture inputs prepared in", source)
