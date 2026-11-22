from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import re

_YTM_CLIENT = None
VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")
PLAYLIST_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{8,90}$")


def get_ytm():
    global _YTM_CLIENT
    if _YTM_CLIENT is None:
        from ytmusicapi import YTMusic
        _YTM_CLIENT = YTMusic()
    return _YTM_CLIENT


def is_valid_video_id(video_id: str) -> bool:
    return bool(VIDEO_ID_RE.match(str(video_id or "").strip()))


def parse_duration_seconds(item: dict) -> int:
    for key in ("duration_seconds", "lengthSeconds"):
        val = item.get(key)
        if isinstance(val, (int, float)) and val > 0:
            return int(val)
    raw = str(item.get("duration") or item.get("length") or "").strip()
    if not raw:
        return 0
    parts = raw.split(":")
    try:
        nums = [int(p) for p in parts]
        if len(nums) == 3:
            return nums[0] * 3600 + nums[1] * 60 + nums[2]
        if len(nums) == 2:
            return nums[0] * 60 + nums[1]
        if len(nums) == 1:
            return nums[0]
    except ValueError:
        return 0
    return 0


def upgrade_cover_url(thumbnails, video_id: str = "") -> str:
    url = ""
    if isinstance(thumbnails, list) and thumbnails:
        best = thumbnails[-1]
        if isinstance(best, dict):
            url = str(best.get("url") or "").strip()
    if url:
        url = re.sub(r"=w\d+-h\d+[^&\s]*", "=w544-h544-l90-rj", url)
        url = re.sub(r"=s\d+[^&\s]*", "=w544-h544-l90-rj", url)
        return url
    if video_id:
        return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    return "/icon-192.png"


def extract_artist_name(item: dict) -> str:
    artists = item.get("artists")
    if isinstance(artists, list) and artists:
        names = [
            str(a.get("name") or "").strip()
            for a in artists
            if isinstance(a, dict) and str(a.get("name") or "").strip()
        ]
        if names:
            return ", ".join(names)
    byline = item.get("byline")
    if isinstance(byline, str) and byline.strip():
        return byline.strip()
    return "YouTube Music"


def extract_album_name(item: dict) -> str:
    album = item.get("album")
    if isinstance(album, dict):
        name = str(album.get("name") or "").strip()
        if name:
            return name
    elif isinstance(album, str) and album.strip():
        return album.strip()
    return "YouTube Music"


def normalize_ytm_track(item: dict):
    if not isinstance(item, dict):
        return None
    video_id = str(item.get("videoId") or "").strip()
    if not is_valid_video_id(video_id):
        return None
    title = str(item.get("title") or "").strip()
    if not title:
        return None
    thumbs = item.get("thumbnails") or item.get("thumbnail") or []
    return {
        "id": f"ytm_{video_id}",
        "videoId": video_id,
        "title": title,
        "artist": extract_artist_name(item),
        "album": extract_album_name(item),
        "duration": parse_duration_seconds(item),
        "cover": upgrade_cover_url(thumbs, video_id),
        "source": "youtube",
    }


def handle_search(query: str, limit: int):
    if not query:
        return 400, {"ok": False, "error": "Parameter q wajib diisi.", "tracks": []}, "no-store"
    try:
        ytm = get_ytm()
        raw_items = ytm.search(query, filter="songs", limit=limit) or []
        tracks = []
        seen = set()
        for item in raw_items:
            t = normalize_ytm_track(item)
            if t and t["videoId"] not in seen:
                seen.add(t["videoId"])
                tracks.append(t)
                if len(tracks) >= limit:
                    break
        return (
            200,
            {"ok": True, "query": query, "tracks": tracks},
            "public, s-maxage=300, stale-while-revalidate=60",
        )
    except Exception as exc:
        return 200, {"ok": False, "tracks": [], "error": str(exc)[:200]}, "no-store"


def handle_related(video_id: str, limit: int):
    if not is_valid_video_id(video_id):
        return 400, {"ok": False, "error": "videoId tidak valid.", "tracks": [], "lyricsBrowseId": None}, "no-store"
    try:
        ytm = get_ytm()
        watch = ytm.get_watch_playlist(videoId=video_id, limit=limit) or {}
        raw_tracks = watch.get("tracks") or []
        lyrics_browse_id = watch.get("lyrics") or None
        tracks = []
        seen = {video_id}
        for item in raw_tracks:
            t = normalize_ytm_track(item)
            if t and t["videoId"] not in seen:
                seen.add(t["videoId"])
                tracks.append(t)
                if len(tracks) >= limit:
                    break
        return (
            200,
            {"ok": True, "tracks": tracks, "lyricsBrowseId": lyrics_browse_id},
            "public, s-maxage=600, stale-while-revalidate=60",
        )
    except Exception as exc:
        return 200, {"ok": False, "tracks": [], "lyricsBrowseId": None, "error": str(exc)[:200]}, "no-store"


def handle_lyrics(video_id: str):
    if not is_valid_video_id(video_id):
        return 400, {"ok": False, "mode": "none", "plainLyrics": "", "error": "videoId tidak valid."}, "no-store"
    try:
        ytm = get_ytm()
        watch = ytm.get_watch_playlist(videoId=video_id, limit=5) or {}
        browse_id = watch.get("lyrics")
        if not browse_id:
            return (
                200,
                {"ok": True, "mode": "none", "plainLyrics": "", "source": "YouTube Music"},
                "public, s-maxage=600, stale-while-revalidate=60",
            )
        lyr = ytm.get_lyrics(browse_id) or {}
        plain_text = str(lyr.get("lyrics") or "").strip()
        if len(plain_text) < 20:
            return (
                200,
                {"ok": True, "mode": "none", "plainLyrics": "", "source": "YouTube Music"},
                "public, s-maxage=600, stale-while-revalidate=60",
            )
        return (
            200,
            {
                "ok": True,
                "mode": "plain",
                "plainLyrics": plain_text,
                "source": "YouTube Music",
            },
            "public, s-maxage=3600, stale-while-revalidate=300",
        )
    except Exception as exc:
        return 200, {"ok": False, "mode": "none", "plainLyrics": "", "error": str(exc)[:200]}, "no-store"


def handle_playlist(playlist_id: str, limit: int):
    pid = str(playlist_id or "").strip()
    if not PLAYLIST_ID_RE.match(pid):
        return 400, {"ok": False, "error": "playlistId tidak valid.", "tracks": []}, "no-store"
    try:
        ytm = get_ytm()
        pl = ytm.get_playlist(pid, limit=max(1, min(100, limit))) or {}
        raw_tracks = pl.get("tracks") or []
        tracks = []
        seen = set()
        for item in raw_tracks:
            t = normalize_ytm_track(item)
            if t and t["videoId"] not in seen:
                seen.add(t["videoId"])
                tracks.append(t)
                if len(tracks) >= limit:
                    break
        name = str(pl.get("title") or "YouTube Playlist").strip() or "YouTube Playlist"
        cover = upgrade_cover_url(pl.get("thumbnails") or [], tracks[0]["videoId"] if tracks else "")
        return (
            200,
            {"ok": True, "name": name, "cover": cover, "tracks": tracks},
            "public, s-maxage=300, stale-while-revalidate=60",
        )
    except Exception as exc:
        return 200, {"ok": False, "name": "", "cover": "", "tracks": [], "error": str(exc)[:220]}, "no-store"


def handle_stream(video_id: str, quality: str = "high"):
    if not is_valid_video_id(video_id):
        return 400, {"ok": False, "error": "videoId tidak valid."}, "no-store"
    try:
        import yt_dlp

        is_low = str(quality or "").strip().lower() == "low"
        fmt_expr = (
            "bestaudio[abr<=96][ext=m4a]/bestaudio[abr<=96]/worstaudio[abr>=48]/bestaudio[ext=m4a]/bestaudio"
            if is_low
            else "bestaudio[ext=m4a]/bestaudio"
        )
        ydl_opts = {
            "format": fmt_expr,
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "socket_timeout": 4,
            "cachedir": False,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)
        if not isinstance(info, dict):
            return 200, {"ok": False, "error": "Metadata stream tidak ditemukan."}, "no-store"

        stream_url = str(info.get("url") or "").strip()
        ext = str(info.get("ext") or "m4a").strip()
        abr = info.get("abr") or (64 if is_low else 128)
        duration = int(info.get("duration") or 0)

        if not stream_url and isinstance(info.get("formats"), list):
            audio_fmts = [
                f for f in info["formats"]
                if isinstance(f, dict) and f.get("url") and f.get("acodec") not in (None, "none")
            ]
            if is_low:
                audio_fmts.sort(
                    key=lambda f: (
                        0 if 48 <= float(f.get("abr") or 0) <= 96 else 1,
                        abs(float(f.get("abr") or 96) - 64),
                        0 if f.get("ext") == "m4a" else 1,
                    )
                )
            else:
                audio_fmts.sort(key=lambda f: (1 if f.get("ext") == "m4a" else 0, float(f.get("abr") or 0)), reverse=True)
            if audio_fmts:
                best = audio_fmts[0]
                stream_url = str(best.get("url") or "").strip()
                ext = str(best.get("ext") or ext).strip()
                abr = best.get("abr") or abr

        if not stream_url:
            return 200, {"ok": False, "error": "URL stream audio kosong."}, "no-store"

        return (
            200,
            {
                "ok": True,
                "url": stream_url,
                "ext": ext,
                "abr": int(float(abr)) if abr else (64 if is_low else 128),
                "duration": duration,
                "qualityMode": "low" if is_low else "high",
            },
            "no-store",
        )
    except Exception as exc:
        return 200, {"ok": False, "error": str(exc)[:240]}, "no-store"


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: dict, cache_control: str = "no-store"):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", cache_control)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        action = (qs.get("action") or [""])[0].strip().lower()
        query = (qs.get("q") or [""])[0].strip()
        video_id = (qs.get("videoId") or qs.get("ytId") or [""])[0].strip()
        playlist_id = (qs.get("playlistId") or qs.get("list") or [""])[0].strip()
        quality = (qs.get("quality") or ["high"])[0].strip().lower()
        raw_limit = (qs.get("limit") or ["100" if action == "playlist" else "15"])[0].strip()
        max_lim = 100 if action == "playlist" else 30
        try:
            limit = max(1, min(max_lim, int(raw_limit)))
        except ValueError:
            limit = 100 if action == "playlist" else 15

        if action == "search":
            code, payload, cc = handle_search(query, limit)
            return self._send_json(code, payload, cc)
        if action == "related":
            code, payload, cc = handle_related(video_id, limit)
            return self._send_json(code, payload, cc)
        if action == "lyrics":
            code, payload, cc = handle_lyrics(video_id)
            return self._send_json(code, payload, cc)
        if action == "playlist":
            code, payload, cc = handle_playlist(playlist_id, limit)
            return self._send_json(code, payload, cc)
        if action == "stream":
            code, payload, cc = handle_stream(video_id, quality)
            return self._send_json(code, payload, cc)

        return self._send_json(
            400,
            {
                "ok": False,
                "error": "Parameter action wajib diisi (search | related | lyrics | playlist | stream).",
            },
            "no-store",
        )

    def log_message(self, format, *args):
        return
