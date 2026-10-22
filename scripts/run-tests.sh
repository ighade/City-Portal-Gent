#!/usr/bin/env bash
# Draait de backendtests zonder lokale dotnet: een wegwerp-postgres plus de .NET SDK in Docker.
# Gebruik (vanuit de projectmap): ./scripts/run-tests.sh [extra dotnet test-opties, bv. --filter "FullyQualifiedName~Friends"]
set -euo pipefail

cd "$(dirname "$0")/.."
name="pgtest-$$"
net="$name"
trap 'docker rm -f "$name" >/dev/null 2>&1; docker network rm "$net" >/dev/null 2>&1 || true' EXIT
docker network create "$net" >/dev/null

docker run -d --name "$name" --network "$net" -e POSTGRES_PASSWORD=pw postgres:16-alpine >/dev/null

# De image start tijdens de init een tijdelijke server en daarna de echte: wacht op de tweede.
until [ "$(docker logs "$name" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ]; do sleep 1; done

docker run --rm --network "$net" \
  -e TEST_POSTGRES="Host=$name;Port=5432;Username=postgres;Password=pw" \
  -v "$PWD/backend":/src -w /src mcr.microsoft.com/dotnet/sdk:10.0 \
  dotnet test ParkingGent.Api.Tests/ParkingGent.Api.Tests.csproj --logger "console;verbosity=normal" "$@"
