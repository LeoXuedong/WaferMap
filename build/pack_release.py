"""正式打包：WaferMap-v1.0.0.zip（内层根目录 WaferMap/）→ 解压比对哈希 → 必需文件守卫。"""
import hashlib
import os
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = "v1.0.1"
TOP = "WaferMap"                                   # zip 内层根目录
ZIP = os.path.join(os.path.dirname(ROOT), "WaferMap-%s.zip" % VERSION)

INCLUDE_DIRS = ["css", "js", "data", "vendor", "tests", "docs"]
INCLUDE_FILES = ["index.html", "使用说明.md"]
EXCLUDE_PARTS = {"shots", "build", "__pycache__"}


def collect():
    items = list(INCLUDE_FILES)
    for d in INCLUDE_DIRS:
        base_dir = os.path.join(ROOT, d)
        if not os.path.isdir(base_dir):
            continue
        for base, dirs, files in os.walk(base_dir):
            dirs[:] = [x for x in dirs if x not in EXCLUDE_PARTS]
            for fn in sorted(files):
                full = os.path.join(base, fn)
                rel = os.path.relpath(full, ROOT).replace("\\", "/")
                if any((p in EXCLUDE_PARTS) or p.startswith("dl") for p in rel.split("/")):
                    continue
                items.append(rel)
    return items


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


items = collect()
if os.path.exists(ZIP):
    os.remove(ZIP)
with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for rel in items:
        z.write(os.path.join(ROOT, rel), TOP + "/" + rel)

size = os.path.getsize(ZIP)
print("zip:", os.path.basename(ZIP), "%.2f MB" % (size / 1024 / 1024), len(items), "files")

# ---- 解压到临时目录并逐文件比对哈希 ----
DEST = os.path.join(os.environ["TEMP"], "wm_verify_" + VERSION.replace(".", "_"))
if os.path.exists(DEST):
    shutil.rmtree(DEST)
os.makedirs(DEST, exist_ok=True)
with zipfile.ZipFile(ZIP) as z:
    z.extractall(DEST)

bad = []
for rel in items:
    a = os.path.join(ROOT, rel)
    b = os.path.join(DEST, TOP, rel)
    if not os.path.exists(b):
        bad.append((rel, "MISSING"))
    elif sha256(a) != sha256(b):
        bad.append((rel, "HASH MISMATCH"))
print("hash diff:", bad if bad else "none (%d files identical)" % len(items))

need = ["index.html", "css/app.css", "js/app.js", "js/views.js", "js/charts.js",
        "js/wafer.js", "js/export.js", "js/core.js", "js/stats.js",
        "data/demo.js", "data/trend_demo_10P.csv",
        "vendor/echarts.min.js", "vendor/xlsx.full.min.js",
        "tests/fixtures/multi_sheet.xlsx", "使用说明.md", "docs/开发记录.md"]
missing = [n for n in need if not os.path.exists(os.path.join(DEST, TOP, n))]
print("required missing:", missing if missing else "none")
print("unpacked to:", os.path.join(DEST, TOP))

sys.exit(1 if (bad or missing) else 0)
