import os
os.environ['FIRMS_API_KEY'] = ''

from data_sources import get_fires, get_hurricanes, get_co2, get_sea_ice, get_weather, get_marine, get_air_quality, get_gistemp, get_ocean_heat, get_ocean_ph, get_sea_ice_south, get_sea_level
import asyncio

async def test_overview():
    print('=== OVERVIEW DATA ===')
    
    # Simulate what overview does
    weather_data = get_weather(50.45, 30.52)
    marine_data = get_marine(50.45, 30.52)
    aq_data = get_air_quality(50.45, 30.52)
    gistemp_data = get_gistemp()
    co2_data = get_co2()
    ice_data = get_sea_ice()
    storm_data = get_hurricanes()
    fire_data = get_fires(1)
    
    print(f'Weather current: {weather_data.get("current", {}).get("temperature_2m")}')
    print(f'Marine SST: {marine_data.get("hourly", {}).get("sea_surface_temperature", [])[:3]}')
    print(f'AQI: {aq_data.get("current", {}).get("us_aqi")}')
    print(f'GISTEMP latest: {gistemp_data.get("latest")}')
    print(f'CO2 latest: {co2_data.get("latest")}')
    print(f'Sea ice latest: {ice_data.get("latest")}')
    print(f'Sea ice anomaly: {ice_data.get("anomaly")}')
    print(f'Storms active: {storm_data.get("active")}, count: {len(storm_data.get("storms", []))}')
    print(f'Fires count: {fire_data.get("count")}, live: {fire_data.get("live")}')
    
    sea_level_data = get_sea_level()
    ocean_heat_data = get_ocean_heat()
    ocean_ph_data = get_ocean_ph()
    antarctic_ice_data = get_sea_ice_south()
    
    print(f'Sea level latest: {sea_level_data.get("latest")}')
    print(f'Ocean heat latest: {ocean_heat_data.get("latest")}')
    print(f'Ocean pH latest: {ocean_ph_data.get("latest")}')
    print(f'Antarctic ice latest: {antarctic_ice_data.get("latest")}')

asyncio.run(test_overview())