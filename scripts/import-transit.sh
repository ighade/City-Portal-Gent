#!/bin/sh
set -eu

seed_root=$(CDPATH= cd -- "$(dirname "$0")/../backend/ParkingGent.Api/seed" && pwd)
seed_path=${1:-seed/delijn-gtfs}

# The importer reads a directory; unpack the zip when only the archive is present.
if [ ! -d "$seed_root/delijn-gtfs" ] && [ -f "$seed_root/delijn-gtfs.zip" ]; then
  tmp=$(mktemp -d "$seed_root/.import-XXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  mkdir "$tmp/delijn-gtfs"
  python3 -m zipfile -e "$seed_root/delijn-gtfs.zip" "$tmp/delijn-gtfs"
  seed_root=$tmp
fi

docker compose run --rm -v "$seed_root:/app/seed:ro" -e Transit__StaticFilePath="$seed_path" backend dotnet ParkingGent.Api.dll --import-transit
