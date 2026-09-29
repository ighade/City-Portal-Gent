FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ParkingGent.Api/ParkingGent.Api.csproj ParkingGent.Api/
RUN dotnet restore ParkingGent.Api/ParkingGent.Api.csproj
COPY . .
RUN dotnet publish ParkingGent.Api/ParkingGent.Api.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
# Niet als root (uid 1654). Deze dienst schrijft niets op schijf — alles gaat naar postgres —
# maar de regel geldt hier net zo goed als bij de buren.
USER app
ENV ASPNETCORE_URLS=http://+:5000
ENV ASPNETCORE_ENVIRONMENT=Production
# De trendgrafiek rekent in Belgische tijd; zonder tijdzonedatabank in het beeld valt ze terug
# op UTC en verspringt de ochtendspits een uur bij de overgang naar de wintertijd.
ENV TZ=Europe/Brussels
EXPOSE 5000
ENTRYPOINT ["dotnet", "ParkingGent.Api.dll"]
