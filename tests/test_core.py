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
