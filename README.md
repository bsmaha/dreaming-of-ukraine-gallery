# Dreaming of Ukraine Gallery Data

Public JSON feed for the Dreaming of Ukraine Ghost gallery.

## Live feed

`https://bsmaha.github.io/dreaming-of-ukraine-gallery/gallery-data.json`

## Updating the feed

1. Update the public Google Sheet or image folders.
2. Open **Actions** in this repository.
3. Select **Rebuild gallery JSON**.
4. Click **Run workflow**.
5. Wait for the workflow to finish successfully.

The workflow reads:

- Google Sheet tabs: `art` and `authors`
- Public Drive folder: `Art`
- Public Drive folder: `Authors`

It matches images by the exact filename stored in each sheet row.

## Repository secret

The workflow requires the repository Actions secret:

`DRIVE_API_KEY`
