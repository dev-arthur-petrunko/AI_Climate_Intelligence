import os
os.environ['FIRMS_API_KEY'] = ''

from data_sources import get_fires, get_hurricanes, nearest_place

print('=== EVENTS ENDPOINT SIMULATION ===')

# Simulate /api/events logic
events = []

# Fires
fires_data = get_fires(2)
fires = fires_data.get("fires", [])
if len(fires) > 24:
    step = max(1, len(fires) // 24)
    sampled = fires[::step][:24]
else:
    sampled = fires

for fire in sampled:
    coords = fire.get("coordinates")
    if coords:
        frp = fire.get("frp")
        place = nearest_place(coords[1], coords[0])
        events.append({
            "event_type": "Wildfire",
            "location": place or f"≈ {coords[1]:.1f}°, {coords[0]:.1f}°",
            "time": fire.get("acq_date", "recent"),
            "severity": "high" if (frp or 0) > 100 else "medium",
            "coordinates": (coords[0], coords[1]),
            "frp": round(float(frp), 1) if frp is not None else None,
            "confidence": fire.get("confidence"),
            "satellite": fire.get("satellite"),
        })

print(f'Fires added: {len([e for e in events if e["event_type"] == "Wildfire"])}')

# Cyclones
storms = get_hurricanes().get("storms", [])
for storm in storms[:6]:
    coords = storm.get("coordinates")
    if coords:
        events.append({
            "event_type": "Cyclone",
            "location": storm.get("title", "Tropical Cyclone"),
            "time": "active",
            "severity": "high",
            "coordinates": (coords[0], coords[1]),
        })
    else:
        print(f'Storm without coords: {storm.get("title")}')

print(f'Cyclones added: {len([e for e in events if e["event_type"] == "Cyclone"])}')
print(f'Total events: {len(events)}')
for e in events[:5]:
    print(f'  {e["event_type"]}: {e["location"]} @ {e["coordinates"]}')