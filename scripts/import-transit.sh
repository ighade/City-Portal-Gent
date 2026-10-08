#!/bin/sh
set -eu

docker compose run --rm backend dotnet ParkingGent.Api.dll --import-transit