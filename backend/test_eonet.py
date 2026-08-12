import os
os.environ['FIRMS_API_KEY'] = ''

from data_sources import get_eonet

print('=== EONET EVENTS ===')
eonet = get_eonet(14)
print(f'Source: {eonet.get("source")}')
print(f'Count: {eonet.get("count")}')
for e in eonet.get('events', [])[:10]:
    print(f'  {e["event_type"]}: {e["title"]} @ {e["coordinates"]} time: {e["time"]}')