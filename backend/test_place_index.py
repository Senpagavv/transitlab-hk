from backend.models import Place
from backend.services.place_index import PlaceIndex


def make(name_zh: str, name_en: str, kind: str) -> Place:
    return Place(name_zh=name_zh, name_en=name_en, kind=kind, lon=114.17, lat=22.33, source="test")


INDEX = PlaceIndex(
    [
        make("九龍塘站", "Kowloon Tong Station", "mtr"),
        make("九龍站", "Kowloon Station", "mtr"),
        make("九龍塘", "Kowloon Tong", "bus_stop"),
        make("又一城九龍塘", "Festival Walk Kowloon Tong", "bus_stop"),
        make("沙田站", "Sha Tin Station", "mtr"),
        make("澤豐站", "Affluence Stop", "light_rail"),
    ]
)


def names(places: list[Place]) -> list[str]:
    return [p.name_zh for p in places]


def test_single_character_suggests_prefix_matches():
    assert set(names(INDEX.suggest("九"))) >= {"九龍塘站", "九龍站", "九龍塘"}


def test_simplified_input_matches_traditional_names():
    assert names(INDEX.suggest("九龙塘"))[:2] == ["九龍塘", "九龍塘站"]


def test_exact_then_prefix_then_substring_with_stations_first():
    # exact "九龍塘" first, then prefix matches (station before bus stop), then substring match
    assert names(INDEX.suggest("九龍塘")) == ["九龍塘", "九龍塘站", "又一城九龍塘"]


def test_english_is_case_and_space_insensitive():
    assert names(INDEX.suggest("sha tin"))[0] == "沙田站"
    assert names(INDEX.suggest("KOWLOONTONG"))[0] == "九龍塘"


def test_empty_or_unmatched_query_returns_nothing():
    assert INDEX.suggest("   ") == []
    assert INDEX.suggest("不存在的地方") == []


def test_same_name_and_kind_is_suggested_once():
    index = PlaceIndex([make("古洞", "Kwu Tung", "bus_stop"), make("古洞", "Kwu Tung", "bus_stop"), make("古洞街市", "", "bus_stop")])

    assert names(index.suggest("古洞")) == ["古洞", "古洞街市"]


def test_limit_is_applied():
    assert len(INDEX.suggest("九", limit=2)) == 2
