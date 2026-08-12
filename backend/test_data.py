import os
os.environ['FIRMS_API_KEY'] = ''

from data_sources import get_fires, get_hurricanes, get_co2, get_sea_ice

print('=== FIRES ===')
fires = get_fires(2)
print(f'Source: {fires.get("source")}')
print(f'Count: {fires.get("count")}')
print(f'Live: {fires.get("live")}')
if fires.get('fires'):
    print(f'First fire: {fires["fires"][0]}')

print()
print('=== HURRICANES ===')
hurricanes = get_hurricanes()
print(f'Source: {hurricanes.get("source")}')
print(f'Active: {hurricanes.get("active")}')
print(f'Count: {len(hurricanes.get("storms", []))}')
for s in hurricanes.get('storms', [])[:3]:
    print(f'  Storm: {s.get("title")}, coords: {s.get("coordinates")}')

print()
print('=== CO2 ===')
co2 = get_co2()
print(f'Source: {co2.get("source")}')
print(f'Latest: {co2.get("latest")}')

print()
print('=== SEA ICE ===')
ice = get_sea_ice()
print(f'Source: {ice.get("source")}')
print(f'Latest extent: {ice.get("latest")}')
print(f'Anomaly: {ice.get("anomaly")}')