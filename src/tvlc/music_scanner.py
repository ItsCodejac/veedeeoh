import os
import mimetypes
from pathlib import Path
import mutagen
from mutagen.easyid3 import EasyID3

SUPPORTED_EXTENSIONS = {".mp3", ".flac", ".wav", ".m4a", ".ogg"}

def get_music_dir() -> Path:
    """Resolve local music directory path from config/defaults."""
    env_dir = os.environ.get("TVLC_MUSIC_DIR")
    if env_dir:
        p = Path(env_dir).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p

    # Default 1: Workspace music folder
    workspace_music = Path("/Users/cojac/TVLC/music")
    if workspace_music.exists():
        return workspace_music

    # Default 2: User Home Music directory
    home_music = Path(os.path.expanduser("~/Music")).resolve()
    if home_music.exists():
        return home_music

    # Fallback: create workspace folder
    workspace_music.mkdir(parents=True, exist_ok=True)
    return workspace_music

def get_track_metadata(path: Path, music_dir: Path) -> dict:
    """Extract metadata tags and check artwork presence."""
    title = path.stem
    artist = "Unknown Artist"
    album = "Unknown Album"
    genre = "Unknown Genre"
    duration = 0.0
    has_art = False

    try:
        audio = mutagen.File(path)
        if audio is not None:
            duration = getattr(audio.info, "length", 0.0)

            # Try reading tags via standard dict keys
            if hasattr(audio, "tags") and audio.tags:
                # EasyID3 or generic tag mappings
                title = audio.tags.get("title", [title])[0]
                artist = audio.tags.get("artist", [artist])[0]
                album = audio.tags.get("album", [album])[0]
                genre = audio.tags.get("genre", [genre])[0]

            # Try tag-specific cover extraction checks
            if "APIC:" in audio:
                has_art = True
            elif hasattr(audio, "pictures") and audio.pictures:
                has_art = True
            elif "covr" in audio:
                has_art = True
            else:
                # Check for standard naming keys in any tag formats
                for key in audio.keys():
                    if "art" in key.lower() or "covr" in key.lower() or "apic" in key.lower():
                        has_art = True
                        break
    except Exception as e:
        print(f"Error reading tags for {path}: {e}")

    rel_path = str(path.relative_to(music_dir))
    return {
        "id": rel_path,
        "title": str(title),
        "artist": str(artist),
        "album": str(album),
        "genre": str(genre),
        "duration": float(duration),
        "has_art": has_art,
        "url": f"/api/local/music/file/{rel_path}"
    }

def extract_album_art(path: Path) -> tuple[bytes, str] | None:
    """Extract embedded album art image bytes and MIME type."""
    try:
        audio = mutagen.File(path)
        if audio is None:
            return None

        # Check MP3 (APIC)
        if hasattr(audio, "tags") and audio.tags:
            for key in audio.tags.keys():
                if key.startswith("APIC"):
                    apic = audio.tags[key]
                    return apic.data, apic.mime

        # Check FLAC
        if hasattr(audio, "pictures") and audio.pictures:
            pic = audio.pictures[0]
            return pic.data, pic.mime

        # Check MP4 / M4A (covr)
        if "covr" in audio:
            covr = audio["covr"]
            if isinstance(covr, list) and len(covr) > 0:
                data = covr[0]
                mime = "image/jpeg"
                if data.startswith(b"\x89PNG\r\n\x1a\n"):
                    mime = "image/png"
                return data, mime
    except Exception as e:
        print(f"Error extracting artwork: {e}")
    return None

def parse_m3u(playlist_path: Path, music_dir: Path) -> list[str]:
    """Parse standard .m3u playlist files."""
    tracks_list = []
    try:
        with open(playlist_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                track_path = Path(line)
                if not track_path.is_absolute():
                    track_path = (playlist_path.parent / track_path).resolve()
                if track_path.exists() and track_path.is_relative_to(music_dir):
                    tracks_list.append(str(track_path.relative_to(music_dir)))
    except Exception as e:
        print(f"Error parsing playlist {playlist_path}: {e}")
    return tracks_list

def scan_library() -> dict:
    """Scan the configured music folder for tracks and playlists."""
    music_dir = get_music_dir()
    tracks = []
    playlists = []

    if not music_dir.exists():
        return {"tracks": [], "playlists": []}

    # Walk directory
    for root, _, files in os.walk(music_dir):
        root_path = Path(root)
        for file in files:
            file_path = root_path / file
            ext = file_path.suffix.lower()

            if ext in SUPPORTED_EXTENSIONS:
                meta = get_track_metadata(file_path, music_dir)
                tracks.append(meta)
            elif ext == ".m3u":
                rel_playlist = str(file_path.relative_to(music_dir))
                playlist_tracks = parse_m3u(file_path, music_dir)
                playlists.append({
                    "name": file_path.stem,
                    "id": rel_playlist,
                    "tracks": playlist_tracks
                })

    return {
        "tracks": tracks,
        "playlists": playlists
    }
