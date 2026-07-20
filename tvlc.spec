# -*- mode: python ; coding: utf-8 -*-

import os
import sys

block_cipher = None

SRC_ROOT = os.path.abspath(".")
STATIC_DIR = os.path.join(SRC_ROOT, "src", "tvlc", "static")

a = Analysis(
    [os.path.join(SRC_ROOT, "src", "tvlc", "__init__.py")],
    pathex=[os.path.join(SRC_ROOT, "src")],
    binaries=[],
    datas=[
        (STATIC_DIR, "tvlc/static"),
    ],
    hiddenimports=[
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "starlette.middleware.base",
        "starlette.middleware.cors",
        "anyio",
        "anyio._backends._asyncio",
        "httpx",
        "faster_whisper",
        "mutagen",
        "mutagen.mp3",
        "mutagen.flac",
        "mutagen.mp4",
        "PIL",
        "PIL.Image",
        "platformdirs",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "ruff", "IPython", "jupyter"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

if sys.platform == "darwin":
    # macOS: onedir + .app bundle
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name="veedeeoh",
        debug=False,
        strip=False,
        upx=True,
        console=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon=None,
    )
    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name="veedeeoh",
    )
    app = BUNDLE(
        coll,
        name="veedeeoh.app",
        icon=None,
        bundle_identifier="com.veedeeoh.app",
        info_plist={
            "NSHighResolutionCapable": True,
        },
    )
else:
    # Windows / Linux: single-file exe
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.zipfiles,
        a.datas,
        [],
        exclude_binaries=False,
        name="veedeeoh",
        debug=False,
        strip=False,
        upx=True,
        console=False,
        disable_windowed_traceback=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon=None,
    )
