from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pycountry
from countryinfo import CountryInfo


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "app" / "data"
COUNTRIES_PATH = DATA_DIR / "countries.json"
ALIASES_PATH = DATA_DIR / "country_aliases.json"


SUPPLEMENTAL_ALIASES: dict[str, set[str]] = {
    "US": {"U.S.", "U.S.A.", "USA", "America", "American", "Washington"},
    "GB": {
        "U.K.",
        "UK",
        "Britain",
        "British",
        "England",
        "Scotland",
        "Wales",
        "London",
    },
    "CN": {"Chinese", "Beijing", "PRC"},
    "RU": {"Russian", "Moscow", "Kremlin"},
    "UA": {"Ukrainian", "Kyiv", "Kiev"},
    "IR": {"Iranian", "Persian", "Tehran"},
    "IL": {"Israeli", "Jerusalem"},
    "PS": {"Palestinian", "Gaza", "West Bank"},
    "KR": {"South Korean", "Seoul"},
    "KP": {"North Korean", "DPRK", "Pyongyang"},
    "TW": {"Taiwanese", "Taipei"},
    "JP": {"Japanese", "Tokyo"},
    "IN": {"Indian", "New Delhi", "Bharat"},
    "PK": {"Pakistani", "Islamabad"},
    "DE": {"German", "Berlin"},
    "FR": {"French", "Paris"},
    "TR": {"Turkish", "Ankara"},
    "QA": {"Qatari", "Doha"},
    "HK": {"Hong Konger", "Hong Kongese"},
    "VE": {"Venezuelan"},
    "NG": {"Nigerian"},
    "CA": {"Canadian"},
    "AU": {"Australian"},
    "SG": {"Singaporean"},
    "ZA": {"South African"},
    "MX": {"Mexican"},
    "EG": {"Egyptian"},
    "NZ": {"New Zealander"},
    "AR": {"Argentinian", "Argentine"},
    "KE": {"Kenyan"},
    "MM": {"Burmese"},
    "CO": {"Colombian"},
    "BD": {"Bangladeshi"},
    "DO": {"Dominican Republic", "Dominican"},
}


def _normalize(value: str) -> str:
    return " ".join(value.replace("\u2019", "'").split()).strip()


def _countryinfo_names(country: Any) -> set[str]:
    candidates = [
        getattr(country, "common_name", None),
        getattr(country, "name", None),
        getattr(country, "official_name", None),
    ]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            try:
                info = CountryInfo(candidate)
                values = set(info.alt_spellings())
                demonym = info.demonym()
                if isinstance(demonym, str) and demonym.strip():
                    values.add(demonym)
                return {
                    _normalize(value)
                    for value in values
                    if isinstance(value, str) and value.strip()
                }
            except Exception:
                continue
    return set()


def _demonym_aliases() -> dict[str, set[str]]:
    demonyms_path = ROOT / "backend" / "app" / "data" / "demonyms.json"
    with demonyms_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    name_to_code: dict[str, str] = {}
    for country in pycountry.countries:
        for field in ("name", "common_name", "official_name"):
            value = getattr(country, field, None)
            if isinstance(value, str) and value.strip():
                name_to_code[_normalize(value).lower()] = country.alpha_2

    aliases: dict[str, set[str]] = {}
    for demonym, place_names in data.items():
        if not isinstance(demonym, str) or not isinstance(place_names, list):
            continue
        for place_name in place_names:
            if not isinstance(place_name, str):
                continue
            code = name_to_code.get(_normalize(place_name).lower())
            if code is None:
                continue
            aliases.setdefault(code, set()).add(_normalize(demonym))

    return aliases


def main() -> None:
    with COUNTRIES_PATH.open("r", encoding="utf-8") as handle:
        countries = json.load(handle)

    demonym_map = _demonym_aliases()
    output: dict[str, list[str]] = {}

    for country in pycountry.countries:
        code = country.alpha_2
        aliases: set[str] = {code, country.alpha_3}

        for field in ("name", "common_name", "official_name"):
            value = getattr(country, field, None)
            if isinstance(value, str) and value.strip():
                aliases.add(_normalize(value))

        aliases.update(_countryinfo_names(country))
        aliases.update(demonym_map.get(code, set()))
        aliases.update(SUPPLEMENTAL_ALIASES.get(code, set()))

        country_record = countries.get(code)
        if isinstance(country_record, dict):
            name = country_record.get("name")
            if isinstance(name, str) and name.strip():
                aliases.add(_normalize(name))

        cleaned = sorted(
            {
                alias
                for alias in aliases
                if isinstance(alias, str)
                and alias.strip()
                and len(alias.strip()) > 1
                and alias.strip().lower() not in {"international"}
            },
            key=lambda value: (-len(value), value.lower()),
        )
        if cleaned:
            output[code] = cleaned

    with ALIASES_PATH.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2, ensure_ascii=True)
        handle.write("\n")


if __name__ == "__main__":
    main()
