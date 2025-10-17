
import json

with open('/home/bender/classwork/Thesis/backend/app/data/rss_sources.json', 'r') as f:
    rss_data = json.load(f)

filtered_sources = {}
for source, data in rss_data.items():
    # Remove sources with category "Apartment Therapy| Saving the world, one room at a time"
    if data.get("category") == "Apartment Therapy| Saving the world, one room at a time":
        continue

    # Remove sources with "comment on" in the name
    if "comment on" in source.lower():
        continue

    # Remove sources with "budgets are sexy" in the name
    if "budgets are sexy" in source.lower():
        continue

    filtered_sources[source] = data

with open('/home/bender/classwork/Thesis/backend/app/data/rss_sources.json', 'w') as f:
    json.dump(filtered_sources, f, indent=2)
