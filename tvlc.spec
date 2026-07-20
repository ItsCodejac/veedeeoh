# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for TVLC
# Builds a single-folder dist (onedir) with all static assets bundled.

import os
from pathlib import Path

block_cipher = None

# Root of the source tree (same directory as this spec file)
SRC_ROOT = os.path.abspath(".")
STATIC_DIR = os.path.join(SRC_ROOT, "src", "tvlc", "static")

a = Analysis(
    [os.path.join(SRC_ROOT, "src", "tvlc", "__init__.py")],
    pathex=[os.path.join(SRC_ROOT, "src")],
    binaries=[],
    datas=[
        # Bundle the pre-built frontend
        (STATIC_DIR, "tvlc/static"),
    ],
    hiddenimports=[
        # FastAPI / Starlette internals that get missed by static analysis
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
        # faster-whisper
        "faster_whisper",
        # mutagen
        "mutagen",
        "mutagen.mp3",
        "mutagen.flac",
        "mutagen.mp4",
        # pillow
        "PIL",
        "PIL.Image",
        # platformdirs
        "platformdirs",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Dev / test stuff we don't need at runtime
        "pytest",
        "ruff",
        "IPython",
        "jupyter",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="veedeeoh",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # no console window — app opens the browser directly
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,  # add an .ico path here if you have one
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
