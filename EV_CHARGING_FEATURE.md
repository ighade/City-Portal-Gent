# EV Charging Stations Feature

## Overview

A new feature has been implemented to help electric vehicle (EV) drivers find charging stations in Gent. This feature is available on both the web and mobile platforms within the route planning interface.

## Features

### Core Functionality

1. **Real-time Charging Station Data**
   - Fetches data from the official Stad Gent API: `https://data.stad.gent/api/explore/v2.1/catalog/datasets/laadpalen-gent/records`
   - Provides current availability status of charging stations
   - Shows up to 500 charging stations across Gent

2. **Station Status Display**
   - **Free**: Station has available charging points
   - **Occupied**: All charging points are currently in use
   - Visual indicators with color coding (green for free, red for occupied)

3. **Distance Calculation**
   - Automatically calculates distance from route destination to each charging station
   - Displays distance in both meters and kilometers for clarity
   - Uses Haversine formula for accurate distance calculations

4. **Intelligent Nearest Station Selection**
   - Automatically identifies and highlights the nearest available charging station
   - Considers both proximity and availability
   - Searches within a 10 km radius

### User Interface

#### Web (React + TypeScript)
- New toggle switch: "Laadpalen (EV)" in the car mode route planner
- Dedicated panel showing:
  - Statistics (available vs occupied stations)
  - Sorted list of all charging stations
  - Station details: name, address, operator, distance
  - Click to select a charging station for more details

#### Mobile (React Native + Expo)
- New toggle switch: "Laadpalen (EV)" in the car mode route planner
- Section in Route Overview displaying:
  - Loading indicator while fetching stations
  - Statistics in a card layout
  - Scrollable list of charging stations
  - Tap to select and highlight stations
  - Color-coded status badges

## Files Added

### Frontend (Web)
- **`frontend/src/chargingStations.ts`** - Core business logic for fetching and processing charging station data
- **`frontend/src/components/ChargingStationsPanel.tsx`** - React component for web UI
- **`frontend/src/components/ChargingStationsPanel.css`** - Styling for the panel
- **`frontend/src/pages/RoutePlanner.tsx`** - Updated with charging stations integration

### Mobile (React Native)
- **`app/CityPortalGentApp/src/lib/chargingStations.ts`** - Core business logic (shared with web)
- **`app/CityPortalGentApp/src/components/ChargingStationsMobile.tsx`** - React Native component for mobile UI
- **`app/CityPortalGentApp/src/screens/RouteScreen.tsx`** - Updated with charging stations integration

## How It Works

### Data Flow

```
User enables "Laadpalen (EV)" toggle
         ↓
Component fetches data from Stad Gent API
         ↓
Charging stations are processed and filtered
         ↓
Nearest available station is identified
         ↓
UI displays stations with real-time status
         ↓
User can select a station for navigation
```

### API Integration

The feature integrates with the Stad Gent public data API:

```
Endpoint: https://data.stad.gent/api/explore/v2.1/catalog/datasets/laadpalen-gent/records
Method: GET
Limit: 500 records
Language: Dutch (nl)
Response: GeoJSON-compatible format with charging station data
```

### Data Processing

Each charging station record includes:
- `naam` - Station name
- `adres` - Full address
- `operator` - Operating company
- `oplaadpunten_totaal` - Total charging points
- `oplaadpunten_beschikbaar` - Available charging points
- `status` - Operational status
- `georef` - Geographic coordinates (lat/lon)

## Usage

### Web Interface

1. Go to the Route Planner page
2. Select "Auto" (car) as the transport mode
3. Toggle the "Laadpalen (EV)" switch
4. Enter your destination
5. The charging stations panel will appear showing all available stations
6. Click on any station to select it for navigation

### Mobile Interface

1. Open the Route Planner screen
2. Select "Auto" (car) as the transport mode
3. Toggle "Laadpalen (EV)" in the settings
4. Enter your destination
5. Scroll down to the "Charging Stations" section in the Route Overview
6. Tap on any station to select it

## Technical Specifications

### Supported Features

- ✅ Real-time availability status
- ✅ Distance calculation from destination
- ✅ Automatic nearest station identification
- ✅ Multi-platform support (web + mobile)
- ✅ Responsive design
- ✅ Loading and error states
- ✅ Accessible color coding

### Browser & Platform Support

**Web:**
- All modern browsers supporting ES2020+
- Responsive design for mobile browsers

**Mobile:**
- iOS 14+
- Android 9+
- React Native 0.88+
- Expo 58+

### Performance

- API calls are cached per session
- Lazy loading of charging stations (only when toggle is enabled)
- Efficient distance calculations using Haversine formula
- Optimized re-renders with React hooks

## Future Enhancements

Potential improvements for future iterations:

1. **Real-time Updates**
   - Poll API for fresh availability data every 30-60 seconds
   - WebSocket integration for live updates

2. **Rerouting Logic**
   - Automatic route recalculation if preferred station becomes occupied
   - Alternative station suggestions

3. **Charging Details**
   - Connector types (Type 2, CCS, CHAdeMO)
   - Charging speed (kW)
   - Pricing information
   - Reservation system integration

4. **Map Integration**
   - Display charging stations directly on the route map
   - Show charging network coverage
   - Cluster pins for better readability

5. **User Preferences**
   - Save favorite charging stations
   - Set preferred networks (Echarge, Tesla Supercharger, etc.)
   - Custom filters and sorting options

6. **Analytics**
   - Track which stations users visit
   - Popular routes for EV drivers
   - Station utilization patterns

## Error Handling

The feature gracefully handles various error scenarios:

- **Network errors**: Displays user-friendly error message
- **API unavailability**: Shows "Kon laadpalen niet laden" message
- **Empty results**: Displays "Geen laadpalen gevonden"
- **Invalid coordinates**: Filters out malformed data

## Accessibility

- Color-coded status (green/red) has accompanying text labels
- Clear visual hierarchy with semantic HTML/components
- Touch targets on mobile are 44x44px minimum (WCAG AA compliant)
- Loading states are clearly indicated with spinners and text
- Error messages are descriptive and actionable

## Privacy & Data

- No user location data is stored
- Charging station data comes from public Stad Gent API
- Feature works offline after initial load (cached data)
- No tracking of user's charging preferences

## Testing

### Manual Testing Checklist

- [ ] Toggle "Laadpalen (EV)" switch on/off
- [ ] Verify charging stations load correctly
- [ ] Check distance calculations are accurate
- [ ] Confirm nearest station is highlighted
- [ ] Test with/without destination set
- [ ] Verify error handling (network down scenario)
- [ ] Check responsive behavior on mobile
- [ ] Confirm color contrast meets accessibility standards
- [ ] Test with different theme (light/dark mode)

### Browser Testing

- [ ] Chrome/Edge (latest 2 versions)
- [ ] Firefox (latest 2 versions)
- [ ] Safari (iOS & macOS)

### Mobile Testing

- [ ] iOS with latest Expo app
- [ ] Android with latest Expo app
- [ ] Tablet mode responsive behavior

## Troubleshooting

### Charging stations not showing

1. Ensure "Laadpalen (EV)" toggle is enabled
2. Check that you're in car mode
3. Verify internet connection is active
4. Try refreshing the page/app

### Wrong distance calculations

- Ensure destination is correctly set
- Distance is calculated from destination to each station (as crow flies, not driving distance)

### Slow loading

- First load fetches 500+ stations; this may take a few seconds
- Subsequent loads should be instant due to browser caching

## Support

For issues or questions about the EV charging feature:

1. Check the troubleshooting section above
2. Review the implementation files for detailed code comments
3. Check browser console for error messages
4. Verify API endpoint is accessible: https://data.stad.gent/api/explore/v2.1/catalog/datasets/laadpalen-gent/records

## License

This feature is part of the City Portal Gent project and follows the same license terms.

## Version History

- **v1.0.0** - Initial release
  - Basic charging station display
  - Real-time availability status
  - Nearest station detection
  - Web and mobile support
