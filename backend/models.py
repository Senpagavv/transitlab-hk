from typing import Literal

from pydantic import BaseModel

# mtr / light_rail / ferry / bus_stop / minibus_stop come from the local transit index;
# "place" is any other result from the Lands Department Location Search API.
PlaceKind = Literal["mtr", "light_rail", "ferry", "bus_stop", "minibus_stop", "place"]


class Place(BaseModel):
    name_zh: str
    name_en: str
    kind: PlaceKind = "place"
    address_zh: str = ""
    district_zh: str = ""
    lon: float
    lat: float
    source: str
