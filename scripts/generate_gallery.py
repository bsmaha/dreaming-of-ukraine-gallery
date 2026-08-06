#!/usr/bin/env python3
"""Generate gallery-data.json from a public Google Sheet and public Drive folders."""

from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SHEET_ID = "1VM6gQ5B5OwZ2nd0wJfDbBAumhA0F18qW2OPtLoEQwQw"
ART_FOLDER_ID = "1xS-dGSF9E3I4oNHayFw1hPweA1x3Za6X"
AUTHORS_FOLDER_ID = "1rD47Avm1yKIoGe4PM4qn-_3lnogcBMbG"
OUTPUT_PATH = Path("gallery-data.json")

MEDIUM_KEYWORDS = (
    "Oil",
    "Acrylic",
    "Watercolor",
    "Ink",
    "Mixed media",
    "Structural paste",
    "Pencil",
    "Pastel",
    "Charcoal",
    "Digital",
)


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "DreamingOfUkraineGallery/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8-sig")


def sheet_rows(tab_name: str) -> list[dict[str, str]]:
    query = urllib.parse.urlencode({"tqx": "out:csv", "sheet": tab_name})
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?{query}"
    return [dict(row) for row in csv.DictReader(io.StringIO(fetch_text(url)))]


def normalize_filename(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def list_public_folder(folder_id: str, api_key: str) -> dict[str, dict[str, Any]]:
    files: dict[str, dict[str, Any]] = {}
    page_token = ""

    while True:
        params = {
            "key": api_key,
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
            "pageSize": "1000",
            "orderBy": "name",
        }
        if page_token:
            params["pageToken"] = page_token

        url = "https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode(params)
        payload = json.loads(fetch_text(url))

        for item in payload.get("files", []):
            files[normalize_filename(item.get("name", ""))] = item

        page_token = payload.get("nextPageToken", "")
        if not page_token:
            return files


def clean(value: Any) -> str:
    return str(value or "").strip()


def numeric(value: Any) -> int | float | None:
    text = clean(value).replace("$", "").replace(",", "")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def boolean(value: Any) -> bool | None:
    text = clean(value).casefold()
    if text in {"yes", "true", "1", "y"}:
        return True
    if text in {"no", "false", "0", "n"}:
        return False
    return None


def slug_status(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "_", clean(value).casefold()).strip("_")
    return text or "available"


def image_payload(file_info: dict[str, Any] | None, alt: str) -> dict[str, str] | None:
    if not file_info:
        return None

    file_id = file_info["id"]
    return {
        "id": file_id,
        "filename": file_info.get("name", ""),
        "url": f"https://drive.google.com/thumbnail?id={file_id}&sz=w1600",
        "originalUrl": f"https://drive.google.com/uc?export=view&id={file_id}",
        "alt": alt,
    }


def medium_filters(value: str) -> list[str]:
    lowered = value.casefold()
    found = [keyword for keyword in MEDIUM_KEYWORDS if keyword.casefold() in lowered]
    return found or ([value] if value else [])


def dimension_label(width: Any, height: Any, unit: str, panel_count: int) -> str:
    if width is None or height is None:
        return ""

    normalized_unit = "in" if unit.casefold().startswith("inch") else unit
    base = f"{width} × {height} {normalized_unit}"
    return f"{panel_count} panels, each {base}" if panel_count > 1 else base


def orientation(width: Any, height: Any) -> str:
    if width is None or height is None:
        return "unknown"
    if width == height:
        return "square"
    return "landscape" if width > height else "portrait"


def format_price(amount: Any) -> str:
    if amount is None:
        return ""
    return f"${amount:,.0f}" if float(amount).is_integer() else f"${amount:,.2f}"


def main() -> int:
    api_key = os.environ.get("DRIVE_API_KEY", "").strip()
    if not api_key:
        print("DRIVE_API_KEY is missing", file=sys.stderr)
        return 1

    art_rows = sheet_rows("art")
    author_rows = sheet_rows("authors")
    art_files = list_public_folder(ART_FOLDER_ID, api_key)
    author_files = list_public_folder(AUTHORS_FOLDER_ID, api_key)

    warnings: list[str] = []
    authors: list[dict[str, Any]] = []
    author_by_name: dict[str, dict[str, Any]] = {}

    for row in author_rows:
        author_id = clean(row.get("Author ID"))
        name = clean(row.get("Artist"))

        if not author_id and not name:
            continue
        if not author_id or not name:
            warnings.append(
                f"Author row skipped because Author ID or Artist is missing: {name or author_id}"
            )
            continue

        filename = clean(row.get("Main Image"))
        photo = image_payload(author_files.get(normalize_filename(filename)), name)
        if filename and not photo:
            warnings.append(f"{author_id}: author image not found: {filename}")

        author = {
            "id": author_id,
            "name": name,
            "bio": clean(row.get("Description")),
            "photo": photo,
        }
        authors.append(author)
        author_by_name[name.casefold()] = author

    artworks: list[dict[str, Any]] = []

    for row in art_rows:
        artwork_id = clean(row.get("Artwork ID"))
        title = clean(row.get("Title"))

        if not artwork_id and not title:
            continue

        status = slug_status(clean(row.get("Status")))
        if status == "hidden":
            continue

        if not artwork_id or not title:
            warnings.append(
                f"Artwork row skipped because Artwork ID or Title is missing: {title or artwork_id}"
            )
            continue

        artist_name = clean(row.get("Artist"))
        author = author_by_name.get(artist_name.casefold())
        filename = clean(row.get("Main Image"))
        alt = f"{title} by {artist_name}" if artist_name else title
        image = image_payload(art_files.get(normalize_filename(filename)), alt)

        if not image:
            warnings.append(
                f"{artwork_id}: artwork image not found: {filename or '[blank]'}"
            )

        width = numeric(row.get("Width"))
        height = numeric(row.get("Height"))
        unit = clean(row.get("Unit")) or "in"
        panel_count = int(numeric(row.get("Panel Count")) or 1)
        price_amount = numeric(row.get("Price"))
        medium = clean(row.get("Medium"))

        artist_summary = None
        if author:
            artist_summary = {
                "id": author["id"],
                "name": author["name"],
                "bio": author["bio"],
                "photo": author["photo"],
            }

        artworks.append(
            {
                "id": artwork_id,
                "stripeProductId": clean(row.get("Stripe Product ID")),
                "title": title,
                "artistName": artist_name,
                "artist": artist_summary,
                "medium": medium,
                "mediumFilters": medium_filters(medium),
                "dimensions": {
                    "width": width,
                    "height": height,
                    "unit": unit,
                    "panelCount": panel_count,
                    "label": dimension_label(width, height, unit, panel_count),
                },
                "orientation": orientation(width, height),
                "price": {
                    "amount": price_amount,
                    "currency": "USD",
                    "formatted": format_price(price_amount),
                },
                "status": status,
                "description": clean(row.get("Description")),
                "image": image,
                "checkoutUrl": clean(row.get("Stripe Payment Link")),
                "framed": boolean(row.get("Framed")),
            }
        )

    payload = {
        "ok": True,
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "exhibition": {"title": "Dreaming of Ukraine"},
        "counts": {
            "artworks": len(artworks),
            "authors": len(authors),
            "warnings": len(warnings),
        },
        "artworks": artworks,
        "authors": authors,
        "warnings": warnings,
    }

    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        f"Generated {OUTPUT_PATH}: "
        f"{len(artworks)} artworks, {len(authors)} authors, {len(warnings)} warnings"
    )
    for warning in warnings:
        print(f"WARNING: {warning}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
