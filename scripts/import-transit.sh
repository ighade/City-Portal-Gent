#!/bin/sh
set -eu

seed_path=${1:-seed/delijn-gtfs}
seed_root=$(CDPATH= cd -- "$(dirname "$0")/../backend/ParkingGent.Api/seed" && pwd)
docker compose run --rm -v "$seed_root:/app/seed:ro" -e Transit__StaticFilePath="$seed_path" backend dotnet ParkingGent.Api.dll --import-transit