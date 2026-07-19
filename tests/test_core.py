from tvlc.catalog import build_catalog, filter_channels
from tvlc.m3u import render
from tvlc.proxy import is_playlist, rewrite_m3u8

RAW = {
    "channels": [
        {"id": "News.us", "name": "News", "country": "US", "categories": ["news"], "is_nsfw": False},
        {"id": "Spice.fr", "name": "Spice", "country": "FR", "categories": [], "is_nsfw": True},
        {"id": "Old.us", "name": "Old", "country": "US", "categories": [], "closed": "2020-01-01"},
        {"id": "NoStream.de", "name": "NoStream", "country": "DE", "categories": []},
    ],
    "streams": [
        {"channel": "News.us", "url": "http://x/news.m3u8", "quality": "720p"},
        {"channel": "News.us", "url": "http://x/news2.m3u8"},
        {"channel": "Spice.fr", "url": "http://x/spice.m3u8"},
        {"channel": "Old.us", "url": "http://x/old.m3u8"},
        {"channel": None, "url": "http://x/orphan.m3u8"},
    ],
    "logos": [{"channel": "News.us", "url": "http://x/logo.png"}],
    "countries": [
        {"code": "US", "name": "United States", "flag": "🇺🇸"},
        {"code": "FR", "name": "France", "flag": "🇫🇷"},
        {"code": "DE", "name": "Germany", "flag": "🇩🇪"},
    ],
    "categories": [{"id": "news", "name": "News"}, {"id": "kids", "name": "Kids"}],
}


def test_build_catalog_joins_and_prunes():
    cat = build_catalog(RAW)
    ids = [c["id"] for c in cat["channels"]]
    assert ids == ["News.us", "Spice.fr"]  # closed + streamless dropped, sorted by name
    news = cat["channels"][0]
    assert news["logo"] == "http://x/logo.png"
    assert len(news["streams"]) == 2
    assert news["streams"][0]["quality"] == "720p"
    # only countries/categories actually in use survive
    assert [c["code"] for c in cat["countries"]] == ["FR", "US"]
    assert [c["id"] for c in cat["categories"]] == ["news"]


def test_filter_channels():
    channels = build_catalog(RAW)["channels"]
    assert [c["id"] for c in filter_channels(channels)] == ["News.us"]  # nsfw hidden
    assert len(filter_channels(channels, include_nsfw=True)) == 2
    assert filter_channels(channels, country="FR") == []
    assert [c["id"] for c in filter_channels(channels, category="news")] == ["News.us"]
    assert [c["id"] for c in filter_channels(channels, q="EWS")] == ["News.us"]
    assert filter_channels(channels, ids={"Spice.fr"}) == []
    assert len(filter_channels(channels, ids={"Spice.fr"}, include_nsfw=True)) == 1


def test_m3u_render():
    channels = build_catalog(RAW)["channels"]
    text = render(channels, country_names={"US": "United States"})
    lines = text.splitlines()
    assert lines[0] == "#EXTM3U"
    assert (
        lines[1]
        == '#EXTINF:-1 tvg-id="News.us" tvg-logo="http://x/logo.png" group-title="United States",News'
    )
    assert lines[2] == "http://x/news.m3u8"
    assert text.endswith("\n")


def test_m3u_render_group_by_category():
    channels = build_catalog(RAW)["channels"]
    text = render(channels, group_by="category")
    assert 'group-title="News"' in text


def test_is_playlist():
    assert is_playlist("http://x/a.m3u8", None)
    assert is_playlist("http://x/a.M3U8?tok=1", None)
    assert is_playlist("http://x/seg", "application/vnd.apple.mpegurl")
    assert not is_playlist("http://x/seg.ts", "video/mp2t")


def test_rewrite_m3u8():
    playlist = "\n".join(
        [
            "#EXTM3U",
            '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
            "#EXTINF:4,",
            "seg1.ts",
            "#EXTINF:4,",
            "https://other.host/seg2.ts",
        ]
    )
    out = rewrite_m3u8(playlist, "https://cdn.example/live/chunks.m3u8")
    assert '/proxy?url=https%3A%2F%2Fcdn.example%2Flive%2Fseg1.ts' in out
    assert '/proxy?url=https%3A%2F%2Fother.host%2Fseg2.ts' in out
    assert 'URI="/proxy?url=https%3A%2F%2Fcdn.example%2Flive%2Fkey.bin"' in out
    assert out.splitlines()[0] == "#EXTM3U"


SAMSUNG_M3U = """#EXTM3U
#EXTINF:-1 channel-id="US1" tvg-id="US1" tvg-logo="http://s/a.png" group-title="Anime & Gaming",Anime All Day
https://jmp2.uk/stvp-US1
#EXTINF:-1 tvg-id="US2" group-title="News",Dupe News
http://x/news.m3u8
#EXTINF:-1 group-title="Anime & Gaming",No Id Channel
https://jmp2.uk/stvp-US3
"""


def test_parse_m3u():
    from tvlc.sources import parse_m3u

    entries = parse_m3u(SAMSUNG_M3U)
    assert len(entries) == 3
    assert entries[0] == {
        "name": "Anime All Day",
        "tvg_id": "US1",
        "logo": "http://s/a.png",
        "group": "Anime & Gaming",
        "url": "https://jmp2.uk/stvp-US1",
    }


def test_extras_merge_and_dedup():
    from tvlc.sources import parse_m3u

    source = {"key": "samsung", "label": "Samsung TV Plus", "country": "US"}
    raw = {**RAW, "extras": [(source, parse_m3u(SAMSUNG_M3U))]}
    cat = build_catalog(raw)
    ids = [c["id"] for c in cat["channels"]]
    # "Dupe News" shares a stream url with News.us and is dropped
    assert ids == ["samsung:US1", "News.us", "samsung:no-id-channel", "Spice.fr"]
    anime = next(c for c in cat["channels"] if c["id"] == "samsung:US1")
    assert anime["categories"] == ["anime-gaming"]
    assert anime["source"] == "Samsung TV Plus"
    assert {"id": "anime-gaming", "name": "Anime & Gaming"} in cat["categories"]


def test_cross_source_duplicate_merges_into_stream_picker():
    from tvlc.sources import parse_m3u

    m3u = """#EXTM3U
#EXTINF:-1 tvg-id="USNEWS" group-title="News",News
https://jmp2.uk/stvp-USNEWS
"""
    source = {"key": "samsung", "label": "Samsung TV Plus", "country": "US"}
    raw = {**RAW, "extras": [(source, parse_m3u(m3u))]}
    cat = build_catalog(raw)
    ids = [c["id"] for c in cat["channels"]]
    assert "samsung:USNEWS" not in ids  # merged, not a separate card
    news = next(c for c in cat["channels"] if c["id"] == "News.us")
    assert [s["source"] for s in news["streams"]] == ["iptv-org", "iptv-org", "Samsung TV Plus"]
    assert news["streams"][-1]["url"] == "https://jmp2.uk/stvp-USNEWS"


def test_pluto_bumper_detection():
    import io

    from PIL import Image

    from tvlc.thumbs import is_pluto_url, looks_like_pluto_bumper

    def jpeg(draw_yellow: bool) -> bytes:
        img = Image.new("RGB", (480, 270), (5, 5, 5))
        if draw_yellow:
            for x in range(200, 280):
                for y in range(100, 170):
                    img.putpixel((x, y), (255, 224, 0))
        buf = io.BytesIO()
        img.save(buf, "JPEG")
        return buf.getvalue()

    assert looks_like_pluto_bumper(jpeg(draw_yellow=True))
    assert not looks_like_pluto_bumper(jpeg(draw_yellow=False))  # plain black frame
    assert is_pluto_url("https://jmp2.uk/plu-abc123")
    assert not is_pluto_url("https://example.com/live.m3u8")
